/**
 * ensureSplit implementation for the Splits client
 *
 * Idempotent split creation/update with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { SplitConfigNotFoundError } from "../errors.js";
import {
	deriveSplitConfig,
	deriveVault,
	getSplitConfig,
	getVaultBalance,
	recipientsEqual,
	checkRecipientAtas,
	getCreateAtaInstructions,
	detectTokenProgram,
	type SplitConfig,
} from "../helpers.js";
import { createSplitConfig, updateSplitConfig } from "../instructions.js";
import { buildTransaction } from "./buildTransaction.js";
import {
	checkUnclaimedAmounts,
	getPendingClaimantCount,
	calculateTotalRent,
} from "./shared.js";
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
	const {
		recipients,
		mint,
		uniqueId,
		payer = wallet.address,
		createMissingAtas = true,
	} = params as EnsureParams & { mint: Address; uniqueId: Address };
	const { commitment = "confirmed", computeUnitPrice } = config;

	// 1. Derive addresses
	const splitConfigAddress = await deriveSplitConfig(
		wallet.address,
		mint,
		uniqueId,
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
		existingConfig = await getSplitConfig(rpc, splitConfigAddress);
	} catch (e) {
		if (!(e instanceof SplitConfigNotFoundError)) throw e;
		// Config doesn't exist, will create
	}

	// 3. Check recipient ATAs - auto-create if enabled
	const missingAtas = await checkRecipientAtas(rpc, recipients, mint);
	let ataInstructions: ReturnType<typeof getCreateAtaInstructions> = [];

	if (missingAtas.length > 0) {
		if (!createMissingAtas) {
			// Opt-out: return blocked
			const missingAddresses = missingAtas.map((m) => m.recipient);
			return {
				status: "blocked",
				reason: "recipient_atas_missing",
				message: recipientAtasMissingMessage(missingAddresses),
			};
		}
		// Default: create ATAs
		ataInstructions = getCreateAtaInstructions({
			payer: wallet.address,
			missingAtas,
			mint,
			tokenProgram,
		});
	}

	// 4. If exists, check for no_change or update
	if (existingConfig) {
		// Check set equality (order-independent)
		if (recipientsEqual(recipients, existingConfig.recipients)) {
			return {
				status: "no_change",
				vault: vaultAddress,
				splitConfig: splitConfigAddress,
			};
		}

		// Check if update is possible
		const vaultBalance = await getVaultBalance(rpc, vaultAddress);
		if (vaultBalance > 0n) {
			return {
				status: "blocked",
				reason: "vault_not_empty",
				message: vaultNotEmptyMessage(vaultBalance),
			};
		}

		const { totalUnclaimed } = checkUnclaimedAmounts(existingConfig);

		if (totalUnclaimed > 0n) {
			return {
				status: "blocked",
				reason: "unclaimed_pending",
				message: unclaimedPendingMessage(
					getPendingClaimantCount(existingConfig),
					totalUnclaimed,
				),
			};
		}

		// Build update instruction
		const instruction = await updateSplitConfig({
			rpc,
			splitConfig: splitConfigAddress,
			authority: wallet.address,
			recipients,
			tokenProgram,
		});

		// Build and send transaction (ATAs first, then update)
		try {
			const message = await buildTransaction(
				rpc,
				wallet.address,
				[...ataInstructions, instruction],
				computeUnitPrice !== undefined ? { computeUnitPrice } : undefined,
			);

			const signature = await wallet.signAndSend(message, { commitment });

			const result: EnsureResult = {
				status: "updated",
				vault: vaultAddress,
				splitConfig: splitConfigAddress,
				signature,
			};
			if (ataInstructions.length > 0) {
				result.atasCreated = missingAtas.map((m) => m.ata);
			}
			return result;
		} catch (e) {
			return handleTransactionError(e);
		}
	}

	// 5. Create new config
	const { instruction } = await createSplitConfig({
		authority: wallet.address,
		recipients,
		mint,
		uniqueId,
		tokenProgram,
		payer,
	});

	// Get rent amount for result
	const rentPaid = await calculateTotalRent(rpc);

	// Build and send transaction (ATAs first, then create)
	try {
		const message = await buildTransaction(
			rpc,
			wallet.address,
			[...ataInstructions, instruction],
			computeUnitPrice !== undefined ? { computeUnitPrice } : undefined,
		);

		const signature = await wallet.signAndSend(message, { commitment });

		const result: EnsureResult = {
			status: "created",
			vault: vaultAddress,
			splitConfig: splitConfigAddress,
			signature,
			rentPaid,
		};
		if (ataInstructions.length > 0) {
			result.atasCreated = missingAtas.map((m) => m.ata);
		}
		return result;
	} catch (e) {
		return handleTransactionError(e);
	}
}
