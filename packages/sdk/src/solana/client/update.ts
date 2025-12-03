/**
 * update implementation for the Splits client
 *
 * Idempotent recipient update with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { VaultNotFoundError } from "../../errors.js";
import {
	getSplitConfigFromVault,
	getVaultBalance,
	recipientsEqual,
	checkRecipientAtas,
	detectTokenProgram,
	type SplitConfig,
} from "../helpers.js";
import { updateSplitConfig } from "../instructions.js";
import { buildTransaction } from "./buildTransaction.js";
import {
	vaultNotEmptyMessage,
	unclaimedPendingMessage,
	notAuthorityMessage,
	recipientAtasMissingMessage,
} from "./messages.js";
import type {
	SplitsWallet,
	SplitsClientConfig,
	UpdateParams,
	UpdateResult,
} from "./types.js";
import { handleTransactionError } from "./errors.js";

// Default token decimals for USDC
const USDC_DECIMALS = 6;

/**
 * Update recipients of an existing split.
 *
 * @internal
 */
export async function updateImpl(
	rpc: Rpc<SolanaRpcApi>,
	wallet: SplitsWallet,
	vault: Address,
	params: UpdateParams,
	config: SplitsClientConfig,
): Promise<UpdateResult> {
	const { recipients } = params;
	const { commitment = "confirmed", computeUnitPrice } = config;

	// 1. Fetch existing config
	let existingConfig: SplitConfig;
	try {
		existingConfig = await getSplitConfigFromVault(rpc, vault);
	} catch (e) {
		if (e instanceof VaultNotFoundError) {
			return {
				status: "BLOCKED",
				reason: "not_authority", // Closest reason - vault doesn't exist
				message: `Split not found at vault ${vault.slice(0, 8)}...${vault.slice(-4)}. It may not exist or has been closed.`,
			};
		}
		throw e;
	}

	// 2. Validate authority
	if (existingConfig.authority !== wallet.address) {
		return {
			status: "BLOCKED",
			reason: "not_authority",
			message: notAuthorityMessage(existingConfig.authority, wallet.address),
		};
	}

	// 3. Check if recipients match (NO_CHANGE)
	if (recipientsEqual(recipients, existingConfig.recipients)) {
		return { status: "NO_CHANGE" };
	}

	// 4. Check blockers
	const vaultBalance = await getVaultBalance(rpc, vault);
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

	// 5. Check recipient ATAs
	const missingAtas = await checkRecipientAtas(
		rpc,
		recipients,
		existingConfig.mint,
	);
	if (missingAtas.length > 0) {
		const missingAddresses = missingAtas.map((m) => m.recipient);
		return {
			status: "BLOCKED",
			reason: "recipient_atas_missing",
			message: recipientAtasMissingMessage(missingAddresses),
		};
	}

	// 6. Build and send update
	const tokenProgram = await detectTokenProgram(rpc, existingConfig.mint);
	const instruction = await updateSplitConfig(rpc, {
		vault,
		authority: wallet.address,
		recipients,
		tokenProgram,
	});

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
			signature,
		};
	} catch (e) {
		return handleTransactionError(e);
	}
}
