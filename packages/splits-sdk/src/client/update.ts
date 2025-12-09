/**
 * update implementation for the Splits client
 *
 * Idempotent recipient update with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi, Instruction } from "@solana/kit";
import { SplitConfigNotFoundError } from "../errors.js";
import {
  getSplitConfig,
  recipientsEqual,
  checkRecipientAtas,
  getCreateAtaInstructions,
  detectTokenProgram,
  type SplitConfig,
  type MissingAta,
} from "../helpers.js";
import { updateSplitConfig } from "../instructions.js";
import { buildTransaction } from "./buildTransaction.js";
import { prepareExecutionIfNeeded, deduplicateAtas } from "./shared.js";
import {
  notAuthorityMessage,
  recipientAtasMissingMessage,
  truncateAddress,
} from "./messages.js";
import type {
  SplitsWallet,
  SplitsClientConfig,
  UpdateParams,
  UpdateResult,
} from "./types.js";
import { handleTransactionError } from "./errors.js";

/**
 * Update recipients of an existing split.
 *
 * If vault has balance or unclaimed amounts exist, auto-executes first
 * to clear them (creating recipient ATAs if needed), then updates.
 *
 * @internal
 */
export async function updateImpl(
  rpc: Rpc<SolanaRpcApi>,
  wallet: SplitsWallet,
  splitConfig: Address,
  params: UpdateParams,
  config: SplitsClientConfig,
): Promise<UpdateResult> {
  const { recipients, createMissingAtas = true } = params;
  const { commitment = "confirmed", computeUnitPrice } = config;

  // 1. Fetch existing config
  let existingConfig: SplitConfig;
  try {
    existingConfig = await getSplitConfig(rpc, splitConfig);
  } catch (e) {
    if (e instanceof SplitConfigNotFoundError) {
      return {
        status: "blocked",
        reason: "not_authority",
        message: `Split not found at ${truncateAddress(splitConfig)}. It may not exist or has been closed.`,
      };
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

  // 3. Check if recipients match (no_change)
  if (recipientsEqual(recipients, existingConfig.recipients)) {
    return { status: "no_change" };
  }

  // 4. Detect token program (needed for ATAs and instructions)
  const tokenProgram = await detectTokenProgram(rpc, existingConfig.mint);

  // 5. Check if vault has balance OR unclaimed - prepare execution if needed
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

  // 6. Check NEW recipient ATAs (deduplicated with current ATAs)
  const newMissingAtas = await checkRecipientAtas(
    rpc,
    recipients,
    existingConfig.mint,
  );

  if (newMissingAtas.length > 0) {
    if (!createMissingAtas) {
      return {
        status: "blocked",
        reason: "recipient_atas_missing",
        message: recipientAtasMissingMessage(
          newMissingAtas.map((m) => m.recipient),
        ),
      };
    }
    // Deduplicate - don't add ATAs we're already creating
    allAtasToCreate.push(...deduplicateAtas(allAtasToCreate, newMissingAtas));
  }

  // 7. Build ATA creation instructions
  const ataInstructions =
    allAtasToCreate.length > 0
      ? getCreateAtaInstructions({
          payer: wallet.address,
          missingAtas: allAtasToCreate,
          mint: existingConfig.mint,
          tokenProgram,
        })
      : [];

  // 8. Build update instruction
  const updateInstruction = await updateSplitConfig({
    rpc,
    splitConfig,
    authority: wallet.address,
    recipients,
    tokenProgram,
  });

  // 9. Bundle and send: [ATAs] + [execute?] + [update]
  const allInstructions: Instruction[] = [
    ...ataInstructions,
    ...(executeInstruction ? [executeInstruction] : []),
    updateInstruction,
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
      status: "updated",
      signature,
      ...(allAtasToCreate.length > 0 && {
        atasCreated: allAtasToCreate.map((a) => a.ata),
      }),
    };
  } catch (e) {
    return handleTransactionError(e);
  }
}
