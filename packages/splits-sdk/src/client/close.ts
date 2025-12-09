/**
 * close implementation for the Splits client
 *
 * Idempotent split closure with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi, Instruction } from "@solana/kit";
import { SplitConfigNotFoundError } from "../errors.js";
import {
	getSplitConfig,
	getCreateAtaInstructions,
	detectTokenProgram,
	type SplitConfig,
	type MissingAta,
} from "../helpers.js";
import { closeSplitConfig } from "../instructions.js";
import { buildTransaction } from "./buildTransaction.js";
import { prepareExecutionIfNeeded, calculateTotalRent } from "./shared.js";
import { notAuthorityMessage } from "./messages.js";
import type {
	SplitsWallet,
	SplitsClientConfig,
	CloseParams,
	CloseResult,
} from "./types.js";
import { handleTransactionError } from "./errors.js";

/**
 * Close a split and recover rent.
 *
 * If vault has balance or unclaimed amounts exist, auto-executes first
 * to clear them (creating recipient ATAs if needed), then closes.
 *
 * @internal
 */
export async function closeImpl(
	rpc: Rpc<SolanaRpcApi>,
	wallet: SplitsWallet,
	splitConfig: Address,
	params: CloseParams,
	config: SplitsClientConfig,
): Promise<CloseResult> {
	const { createMissingAtas = true } = params;
	const { commitment = "confirmed", computeUnitPrice } = config;

	// 1. Check if config exists
	let existingConfig: SplitConfig;
	try {
		existingConfig = await getSplitConfig(rpc, splitConfig);
	} catch (e) {
		if (e instanceof SplitConfigNotFoundError) {
			return { status: "already_closed" };
		}
		throw e;
	}

	// 2. Validate authority
	if (existingConfig.authority !== wallet.address) {
		return {
			status: "blocked",
			reason: "not_authority",
			message: notAuthorityMessage(existingConfig.authority, wallet.address),
		};
	}

	// 3. Detect token program (needed for ATAs and instructions)
	const tokenProgram = await detectTokenProgram(rpc, existingConfig.mint);

	// 4. Check if vault has balance OR unclaimed - prepare execution if needed
	const execPrep = await prepareExecutionIfNeeded({
		rpc,
		splitConfig,
		wallet,
		existingConfig,
		tokenProgram,
		createMissingAtas,
	});

	if ("blocked" in execPrep) {
		return {
			status: "blocked",
			reason: execPrep.reason,
			message: execPrep.message,
		};
	}

	const allAtasToCreate: MissingAta[] = execPrep.needed
		? [...execPrep.atasToCreate]
		: [];
	const executeInstruction: Instruction | null = execPrep.needed
		? execPrep.executeInstruction
		: null;

	// 5. Build ATA creation instructions
	const ataInstructions =
		allAtasToCreate.length > 0
			? getCreateAtaInstructions({
					payer: wallet.address,
					missingAtas: allAtasToCreate,
					mint: existingConfig.mint,
					tokenProgram,
				})
			: [];

	// 6. Build close instruction (rent goes to original rent payer)
	const closeInstruction = await closeSplitConfig({
		rpc,
		splitConfig,
		authority: wallet.address,
		rentReceiver: existingConfig.rentPayer,
		tokenProgram,
	});

	// 7. Calculate rent to report
	const rentRecovered = await calculateTotalRent(rpc);

	// 8. Bundle and send: [ATAs] + [execute?] + [close]
	const allInstructions: Instruction[] = [
		...ataInstructions,
		...(executeInstruction ? [executeInstruction] : []),
		closeInstruction,
	];

	try {
		const message = await buildTransaction(
			rpc,
			wallet.address,
			allInstructions,
			computeUnitPrice !== undefined ? { computeUnitPrice } : undefined,
		);

		const signature = await wallet.signAndSend(message, { commitment });

		return {
			status: "closed",
			signature,
			rentRecovered,
			...(allAtasToCreate.length > 0 && {
				atasCreated: allAtasToCreate.map((a) => a.ata),
			}),
		};
	} catch (e) {
		return handleTransactionError(e);
	}
}
