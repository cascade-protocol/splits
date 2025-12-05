/**
 * ensureSplit implementation for the Splits client
 *
 * Idempotent split creation/update with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { USDC_MINT, SYSTEM_PROGRAM_ID } from "../../index.js";
import { VaultNotFoundError } from "../../errors.js";
import {
	deriveSplitConfig,
	deriveVault,
	getSplitConfigFromVault,
	getVaultBalance,
	recipientsEqual,
	checkRecipientAtas,
	detectTokenProgram,
	labelToSeed,
	type SplitConfig,
} from "../helpers.js";
import { createSplitConfig, updateSplitConfig } from "../instructions.js";
import { buildTransaction } from "./buildTransaction.js";
import {
	vaultNotEmptyMessage,
	unclaimedPendingMessage,
	recipientAtasMissingMessage,
} from "./messages.js";
import type {
	SplitsWallet,
	SplitsClientConfig,
	EnsureParams,
	EnsureResult,
} from "./types.js";
import { handleTransactionError } from "./errors.js";

// Default token decimals for USDC
const USDC_DECIMALS = 6;

/**
 * Ensure a split exists with the specified configuration.
 *
 * @internal
 */
export async function ensureSplitImpl(
	rpc: Rpc<SolanaRpcApi>,
	wallet: SplitsWallet,
	params: EnsureParams,
	config: SplitsClientConfig,
): Promise<EnsureResult> {
	const { recipients, mint = USDC_MINT, payer = wallet.address } = params;
	const { commitment = "confirmed", computeUnitPrice } = config;

	// Handle seed parameter - can be label string or raw Address
	let seed: Address;
	if (params.seed === undefined) {
		seed = SYSTEM_PROGRAM_ID;
	} else if (isLabel(params.seed)) {
		seed = labelToSeed(params.seed);
	} else {
		seed = params.seed as Address;
	}

	// 1. Derive addresses
	const splitConfigAddress = await deriveSplitConfig(
		wallet.address,
		mint,
		seed,
	);
	const tokenProgram = await detectTokenProgram(rpc, mint);
	const vaultAddress = await deriveVault(
		splitConfigAddress,
		mint,
		tokenProgram,
	);

	// 2. Check if config exists
	let existingConfig: SplitConfig | null = null;
	try {
		existingConfig = await getSplitConfigFromVault(rpc, vaultAddress);
	} catch (e) {
		if (!(e instanceof VaultNotFoundError)) throw e;
		// Config doesn't exist, will create
	}

	// 3. Validate recipient ATAs exist
	const missingAtas = await checkRecipientAtas(rpc, recipients, mint);
	if (missingAtas.length > 0) {
		const missingAddresses = missingAtas.map((m) => m.recipient);
		if (existingConfig) {
			// On update, return BLOCKED with actionable message
			return {
				status: "BLOCKED",
				reason: "recipient_atas_missing",
				message: recipientAtasMissingMessage(missingAddresses),
			};
		}
		// On create, also return BLOCKED (changed from throwing)
		return {
			status: "BLOCKED",
			reason: "recipient_atas_missing",
			message: recipientAtasMissingMessage(missingAddresses),
		};
	}

	// 4. If exists, check for NO_CHANGE or UPDATE
	if (existingConfig) {
		// Check set equality (order-independent)
		if (recipientsEqual(recipients, existingConfig.recipients)) {
			return {
				status: "NO_CHANGE",
				vault: vaultAddress,
				splitConfig: splitConfigAddress,
			};
		}

		// Check if update is possible
		const vaultBalance = await getVaultBalance(rpc, vaultAddress);
		if (vaultBalance > 0n) {
			return {
				status: "BLOCKED",
				reason: "vault_not_empty",
				message: vaultNotEmptyMessage(vaultBalance, USDC_DECIMALS, "USDC"),
			};
		}

		const unclaimedCount = existingConfig.unclaimedAmounts.filter(
			(u) => u.amount > 0n,
		).length;
		const totalUnclaimed =
			existingConfig.unclaimedAmounts.reduce((sum, u) => sum + u.amount, 0n) +
			existingConfig.protocolUnclaimed;

		if (totalUnclaimed > 0n) {
			return {
				status: "BLOCKED",
				reason: "unclaimed_pending",
				message: unclaimedPendingMessage(
					unclaimedCount + (existingConfig.protocolUnclaimed > 0n ? 1 : 0),
					totalUnclaimed,
					USDC_DECIMALS,
					"USDC",
				),
			};
		}

		// Build update instruction
		const instruction = await updateSplitConfig(rpc, {
			vault: vaultAddress,
			authority: wallet.address,
			recipients,
			tokenProgram,
		});

		// Build and send transaction
		try {
			const message = await buildTransaction(
				rpc,
				wallet.address,
				[instruction],
				computeUnitPrice !== undefined ? { computeUnitPrice } : undefined,
			);

			const signature = await wallet.signAndSend(message, { commitment });

			return {
				status: "UPDATED",
				vault: vaultAddress,
				splitConfig: splitConfigAddress,
				signature,
			};
		} catch (e) {
			return handleTransactionError(e);
		}
	}

	// 5. Create new config
	const { instruction } = await createSplitConfig({
		authority: wallet.address,
		recipients,
		mint,
		uniqueId: seed,
		tokenProgram,
		payer,
	});

	// Get rent amount for result
	const splitConfigRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(1832))
		.send();
	const vaultRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(165))
		.send();
	const rentPaid = splitConfigRent + vaultRent;

	// Build and send transaction
	try {
		const message = await buildTransaction(
			rpc,
			wallet.address,
			[instruction],
			computeUnitPrice !== undefined ? { computeUnitPrice } : undefined,
		);

		const signature = await wallet.signAndSend(message, { commitment });

		return {
			status: "CREATED",
			vault: vaultAddress,
			splitConfig: splitConfigAddress,
			signature,
			rentPaid,
		};
	} catch (e) {
		return handleTransactionError(e);
	}
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a string is a human-readable label (not an Address).
 * Labels are shorter and don't look like base58 addresses.
 */
function isLabel(seed: string): boolean {
	// Addresses are 32-44 chars of base58
	// Labels are max 27 chars and usually contain readable text
	if (seed.length > 44) return false;
	if (seed.length <= 27 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(seed)) {
		return true;
	}
	return false;
}
