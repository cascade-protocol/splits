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
  type Base64EncodedWireTransaction,
  address,
  createSolanaRpc,
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
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import {
  getUseSpendingLimitInstruction,
  deriveSmartAccount,
  fetchMaybeSpendingLimit,
  decodeTabsApiKey,
  base58Decode,
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

// =============================================================================
// Constants
// =============================================================================

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const USDC_DECIMALS = 6;

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

// =============================================================================
// Hono App
// =============================================================================

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// Health check
app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

// Echo resource - returns 402, accepts payment, then refunds (for testing)
const ECHO_PRICE = "10000"; // 0.01 USDC

app.all("/api/echo/resource", async (c) => {
  if (!c.env.HELIUS_RPC_URL || !c.env.EXECUTOR_KEY) {
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const rpcUrl = c.env.HELIUS_RPC_URL as string;
  const executorKey = c.env.EXECUTOR_KEY as string;

  // Decode executor keypair
  const executorBytes = base58Decode(executorKey);
  const executorSigner = await createKeyPairSignerFromBytes(executorBytes);
  const executorAddress = executorSigner.address;

  const paymentHeader = c.req.header("X-PAYMENT");

  // No payment - return 402
  if (!paymentHeader) {
    return c.json(
      {
        x402Version: 1,
        error: "Payment required",
        accepts: [
          {
            scheme: "exact",
            network: "solana",
            maxAmountRequired: ECHO_PRICE,
            resource: "https://tabs.cascade.fyi/api/echo/resource",
            description: "Echo test resource - payment will be refunded",
            payTo: executorAddress,
            asset: USDC_MINT,
            maxTimeoutSeconds: 60,
            extra: { feePayer: executorAddress },
          },
        ],
      },
      402,
    );
  }

  // Parse X-PAYMENT header
  try {
    const decoded = JSON.parse(atob(paymentHeader)) as {
      x402Version: number;
      scheme: string;
      network: string;
      payload: { transaction?: string; tabsApiKey?: string };
    };

    if (!decoded.payload?.transaction) {
      return c.json({ error: "Missing transaction in payload" }, 400);
    }

    if (!decoded.payload?.tabsApiKey) {
      return c.json({ error: "Missing tabsApiKey in payload" }, 400);
    }

    // Decode API key to get vault address for refund
    const apiKeyPayload = decodeTabsApiKey(decoded.payload.tabsApiKey);
    if (!apiKeyPayload) {
      return c.json({ error: "Invalid tabsApiKey" }, 400);
    }

    const rpc = createSolanaRpc(rpcUrl);

    // 1. Submit the spending limit transaction (executor receives USDC)
    const paymentSignature = await rpc
      .sendTransaction(
        decoded.payload.transaction as Base64EncodedWireTransaction,
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          encoding: "base64",
        },
      )
      .send();

    console.log("Payment submitted:", paymentSignature);

    // Wait for payment confirmation before refund
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
      const { value: statuses } = await rpc
        .getSignatureStatuses([paymentSignature])
        .send();
      const status = statuses[0];
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        confirmed = true;
        console.log("Payment confirmed:", paymentSignature);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!confirmed) {
      console.log("Payment not confirmed in time, skipping refund");
      return c.json({
        success: true,
        message: "Payment submitted but not confirmed in time. Refund skipped.",
        data: {
          paymentSignature,
          network: "solana",
        },
      });
    }

    // 2. Derive vault ATA for refund
    const settingsAddress = address(apiKeyPayload.settingsPda);
    const smartAccountAddress = await deriveSmartAccount(settingsAddress, 0);

    const [vaultAta] = await findAssociatedTokenPda({
      owner: smartAccountAddress,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [executorAta] = await findAssociatedTokenPda({
      owner: executorAddress,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    // 3. Build refund transaction (executor → vault)
    const refundIx = getTransferCheckedInstruction({
      source: executorAta,
      mint: USDC_MINT,
      destination: vaultAta,
      authority: executorSigner,
      amount: BigInt(ECHO_PRICE),
      decimals: USDC_DECIMALS,
    });

    const priorityFee = await getPriorityFeeEstimate(rpcUrl);
    const computeBudgetIx = getSetComputeUnitPriceInstruction({
      microLamports: priorityFee,
    });

    const { value: blockhash } = await rpc.getLatestBlockhash().send();

    const refundMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(executorAddress, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(blockhash, msg),
      (msg) =>
        appendTransactionMessageInstructions([computeBudgetIx, refundIx], msg),
    );

    const compiledRefundTx = compileTransaction(refundMessage);
    const signedRefundTx = await partiallySignTransaction(
      [executorSigner.keyPair],
      compiledRefundTx,
    );
    const refundTxBase64 = getBase64EncodedWireTransaction(signedRefundTx);

    // 4. Submit refund
    const refundSignature = await rpc
      .sendTransaction(refundTxBase64, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        encoding: "base64",
      })
      .send();

    console.log("Refund submitted:", refundSignature);

    // Return echo response
    return c.json({
      success: true,
      message: "Echo! Payment received and refunded.",
      data: {
        paymentSignature,
        refundSignature,
        amount: ECHO_PRICE,
        network: "solana",
        vault: smartAccountAddress,
      },
    });
  } catch (error) {
    console.error("Echo resource error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Payment verification failed",
      },
      400,
    );
  }
});

// Verify endpoint - check if payment is possible
app.post("/api/verify", async (c) => {
  const { apiKey, amount: amountStr } = await c.req.json<VerifyRequest>();

  const payload = decodeTabsApiKey(apiKey);
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
  try {
    const {
      apiKey,
      payTo,
      amount: amountStr,
    } = await c.req.json<SettleRequest>();

    const payload = decodeTabsApiKey(apiKey);
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

    if (!c.env.HELIUS_RPC_URL || !c.env.EXECUTOR_KEY) {
      return c.json({ success: false, error: "Server misconfigured" }, 500);
    }

    const rpcUrl = c.env.HELIUS_RPC_URL as string;
    const executorKey = c.env.EXECUTOR_KEY as string;
    const rpc = createSolanaRpc(rpcUrl);

    // Decode executor keypair from base58 (64-byte secret key)
    const executorBytes = base58Decode(executorKey);
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

    // Create ATA if it doesn't exist (idempotent)
    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: executorSigner,
      owner: destinationAddress,
      mint: USDC_MINT,
      ata: destinationAta,
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
    const priorityFee = await getPriorityFeeEstimate(rpcUrl);

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
          [computeBudgetIx, createAtaIx, useSpendingLimitIx],
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

    // Return the signed transaction for the client to pass to the resource's facilitator
    // The resource's facilitator will submit and verify the payment
    return c.json({
      success: true,
      transaction: txBase64,
    });
  } catch (error) {
    console.error("Settle error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export default app;
