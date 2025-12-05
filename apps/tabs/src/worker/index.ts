/**
 * Cascade Tabs Facilitator Worker
 *
 * Handles payment verification and settlement for x402-enabled APIs.
 * Uses Squads Smart Account spending limits for non-custodial payments.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
	type Address,
	type Signature,
	type Rpc,
	type SolanaRpcApi,
	address,
	createSolanaRpc,
	getBase58Encoder,
	pipe,
	createTransactionMessage,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	appendTransactionMessageInstructions,
	compileTransaction,
	getBase64EncodedWireTransaction,
	createKeyPairSignerFromBytes,
	partiallySignTransaction,
} from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import {
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
	getUseSpendingLimitInstruction,
	deriveSmartAccount,
	fetchMaybeSpendingLimit,
	SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
} from "@cascade-fyi/tabs-sdk";

// =============================================================================
// Types
// =============================================================================

interface VerifyRequest {
	apiKey: string;
	amount: string; // USDC in base units as string
}

interface SettleRequest {
	apiKey: string;
	payTo: string; // Destination address
	amount: string;
}

interface ApiKeyPayload {
	settingsPda: string;
	spendingLimitPda: string;
	perTxMax: bigint;
	version: number;
}

// =============================================================================
// Constants
// =============================================================================

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const USDC_DECIMALS = 6;
const API_KEY_PREFIX = "tabs_";

// =============================================================================
// Helpers
// =============================================================================

function decodeApiKey(key: string): ApiKeyPayload | null {
	if (!key.startsWith(API_KEY_PREFIX)) {
		return null;
	}

	try {
		const base64 = key
			.slice(API_KEY_PREFIX.length)
			.replace(/-/g, "+")
			.replace(/_/g, "/");

		const json = atob(base64);
		const parsed = JSON.parse(json);

		return {
			settingsPda: parsed.settingsPda,
			spendingLimitPda: parsed.spendingLimitPda,
			perTxMax: BigInt(parsed.perTxMax),
			version: parsed.version,
		};
	} catch {
		return null;
	}
}

async function getPriorityFeeEstimate(rpcUrl: string): Promise<bigint> {
	try {
		const response = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: "priority-fee",
				method: "getPriorityFeeEstimate",
				params: [
					{
						accountKeys: [],
						options: {
							priorityLevel: "Medium",
							recommended: true,
						},
					},
				],
			}),
		});

		const result = (await response.json()) as {
			result?: { priorityFeeEstimate?: number };
		};
		if (result.result?.priorityFeeEstimate) {
			return BigInt(Math.ceil(result.result.priorityFeeEstimate));
		}
	} catch (e) {
		console.error("Priority fee estimate failed:", e);
	}

	// Fallback: 50,000 microlamports
	return 50_000n;
}

async function pollConfirmation(
	rpc: Rpc<SolanaRpcApi>,
	signature: Signature,
	maxAttempts: number,
): Promise<boolean> {
	for (let i = 0; i < maxAttempts; i++) {
		const response = await rpc.getSignatureStatuses([signature]).send();
		const status = response.value[0];

		if (status !== null) {
			if (status.err) {
				throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
			}
			if (
				status.confirmationStatus === "confirmed" ||
				status.confirmationStatus === "finalized"
			) {
				return true;
			}
		}

		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

// =============================================================================
// Hono App
// =============================================================================

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// Health check
app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

// Verify endpoint - check if payment is possible
app.post("/api/verify", async (c) => {
	const { apiKey, amount: amountStr } = await c.req.json<VerifyRequest>();

	const payload = decodeApiKey(apiKey);
	if (!payload) {
		return c.json({ valid: false, error: "Invalid API key" }, 400);
	}

	const amount = BigInt(amountStr);

	// Check per-tx limit
	if (amount > payload.perTxMax) {
		return c.json(
			{
				valid: false,
				error: `Amount ${amount} exceeds per-tx limit ${payload.perTxMax}`,
			},
			400,
		);
	}

	// Fetch spending limit on-chain
	const rpc = createSolanaRpc(c.env.HELIUS_RPC_URL);
	const spendingLimit = await fetchMaybeSpendingLimit(
		rpc,
		payload.spendingLimitPda as Address,
	);

	if (!spendingLimit.exists) {
		return c.json({ valid: false, error: "Spending limit not found" }, 404);
	}

	// Check remaining allowance
	if (amount > spendingLimit.data.remainingAmount) {
		return c.json(
			{
				valid: false,
				error: `Insufficient remaining allowance: ${spendingLimit.data.remainingAmount}`,
			},
			400,
		);
	}

	return c.json({
		valid: true,
		remainingAllowance: spendingLimit.data.remainingAmount.toString(),
		perTxLimit: payload.perTxMax.toString(),
	});
});

// Settle endpoint - execute the payment
app.post("/api/settle", async (c) => {
	const {
		apiKey,
		payTo,
		amount: amountStr,
	} = await c.req.json<SettleRequest>();

	const payload = decodeApiKey(apiKey);
	if (!payload) {
		return c.json({ success: false, error: "Invalid API key" }, 400);
	}

	const amount = BigInt(amountStr);
	const destinationAddress = address(payTo);

	// Validate amount
	if (amount > payload.perTxMax) {
		return c.json(
			{
				success: false,
				error: "Amount exceeds per-tx limit",
			},
			400,
		);
	}

	const rpc = createSolanaRpc(c.env.HELIUS_RPC_URL);

	// Decode executor keypair from base58 (64-byte secret key)
	const base58Encoder = getBase58Encoder();
	const executorBytes = base58Encoder.encode(c.env.EXECUTOR_KEY);
	const executorSigner = await createKeyPairSignerFromBytes(executorBytes);

	// Derive PDAs
	const settingsAddress = address(payload.settingsPda);
	const spendingLimitAddress = address(payload.spendingLimitPda);
	const smartAccountAddress = await deriveSmartAccount(settingsAddress, 0);

	// Derive ATAs
	const [vaultAta] = await findAssociatedTokenPda({
		owner: smartAccountAddress,
		mint: USDC_MINT,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});
	const [destinationAta] = await findAssociatedTokenPda({
		owner: destinationAddress,
		mint: USDC_MINT,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	// Build useSpendingLimit instruction
	const useSpendingLimitIx = getUseSpendingLimitInstruction({
		settings: settingsAddress,
		signer: executorSigner,
		spendingLimit: spendingLimitAddress,
		smartAccount: smartAccountAddress,
		destination: destinationAddress,
		mint: USDC_MINT,
		smartAccountTokenAccount: vaultAta,
		destinationTokenAccount: destinationAta,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
		program: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
		amount,
		decimals: USDC_DECIMALS,
		memo: null,
	});

	// Get priority fee estimate from Helius
	const priorityFee = await getPriorityFeeEstimate(c.env.HELIUS_RPC_URL);

	// Add compute budget instruction
	const computeBudgetIx = getSetComputeUnitPriceInstruction({
		microLamports: priorityFee,
	});

	// Build transaction message
	const { value: blockhash } = await rpc.getLatestBlockhash().send();

	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(msg) => setTransactionMessageFeePayer(executorSigner.address, msg),
		(msg) => setTransactionMessageLifetimeUsingBlockhash(blockhash, msg),
		(msg) =>
			appendTransactionMessageInstructions(
				[computeBudgetIx, useSpendingLimitIx],
				msg,
			),
	);

	// Compile and sign transaction
	const compiledTx = compileTransaction(message);
	const signedTx = await partiallySignTransaction(
		[executorSigner.keyPair],
		compiledTx,
	);
	const txBase64 = getBase64EncodedWireTransaction(signedTx);

	// Send transaction
	const signature = await rpc
		.sendTransaction(txBase64, {
			skipPreflight: false,
			preflightCommitment: "confirmed",
			encoding: "base64",
		})
		.send();

	// Poll for confirmation (30 attempts = 15 seconds)
	const confirmed = await pollConfirmation(rpc, signature, 30);

	if (!confirmed) {
		return c.json(
			{
				success: false,
				error: "Transaction confirmation timeout",
				signature,
			},
			500,
		);
	}

	return c.json({
		success: true,
		signature,
	});
});

export default app;
