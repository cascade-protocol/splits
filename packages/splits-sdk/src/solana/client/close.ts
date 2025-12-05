/**
 * close implementation for the Splits client
 *
 * Idempotent split closure with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { VaultNotFoundError } from "../../errors.js";
import {
	getSplitConfigFromVault,
	getVaultBalance,
	detectTokenProgram,
	type SplitConfig,
} from "../helpers.js";
import { closeSplitConfig } from "../instructions.js";
import { buildTransaction } from "./buildTransaction.js";
import {
	vaultNotEmptyMessage,
	unclaimedPendingMessage,
	notAuthorityMessage,
} from "./messages.js";
import type { SplitsWallet, SplitsClientConfig, CloseResult } from "./types.js";
import { handleTransactionError } from "./errors.js";

// Default token decimals for USDC
const USDC_DECIMALS = 6;

/**
 * Close a split and recover rent.
 *
 * @internal
 */
export async function closeImpl(
	rpc: Rpc<SolanaRpcApi>,
	wallet: SplitsWallet,
	vault: Address,
	config: SplitsClientConfig,
): Promise<CloseResult> {
	const { commitment = "confirmed", computeUnitPrice } = config;

	// 1. Check if config exists
	let existingConfig: SplitConfig;
	try {
		existingConfig = await getSplitConfigFromVault(rpc, vault);
	} catch (e) {
		if (e instanceof VaultNotFoundError) {
			return { status: "ALREADY_CLOSED" };
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

	// 3. Check vault empty
	const vaultBalance = await getVaultBalance(rpc, vault);
	if (vaultBalance > 0n) {
		return {
			status: "BLOCKED",
			reason: "vault_not_empty",
			message: vaultNotEmptyMessage(vaultBalance, USDC_DECIMALS, "USDC"),
		};
	}

	// 4. Check no unclaimed
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

	// 5. Detect token program
	const tokenProgram = await detectTokenProgram(rpc, existingConfig.mint);

	// 6. Build close instruction (rent goes to original rent payer)
	const instruction = await closeSplitConfig(rpc, {
		vault,
		authority: wallet.address,
		rentReceiver: existingConfig.rentPayer,
		tokenProgram,
	});

	// 7. Calculate rent to report
	const splitConfigRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(1832))
		.send();
	const vaultRent = await rpc
		.getMinimumBalanceForRentExemption(BigInt(165))
		.send();
	const rentRecovered = splitConfigRent + vaultRent;

	// 8. Build and send transaction
	try {
		const message = await buildTransaction(
			rpc,
			wallet.address,
			[instruction],
			computeUnitPrice !== undefined ? { computeUnitPrice } : undefined,
		);

		const signature = await wallet.signAndSend(message, { commitment });

		return {
			status: "CLOSED",
			signature,
			rentRecovered,
		};
	} catch (e) {
		return handleTransactionError(e);
	}
}
