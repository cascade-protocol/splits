/**
 * Rent estimation for split configuration
 *
 * Pure function that returns rent costs before committing.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { USDC_MINT, SYSTEM_PROGRAM_ADDRESS } from "./constants.js";
import type { Recipient } from "./recipients.js";
import { SplitConfigNotFoundError } from "./errors.js";
import {
  deriveSplitConfig,
  deriveVault,
  getSplitConfig,
  detectTokenProgram,
  type SplitRecipient,
} from "./helpers.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of estimateSplitRent
 */
export interface EstimateResult {
  /** Total rent required in lamports (~0.017 SOL) */
  rentRequired: bigint;
  /** Rent for SplitConfig account (~0.015 SOL, 1832 bytes) */
  splitConfigRent: bigint;
  /** Rent for vault ATA (~0.002 SOL, 165 bytes) */
  vaultRent: bigint;
  /** Derived vault address (deterministic) */
  vault: Address;
  /** Derived splitConfig PDA address */
  splitConfig: Address;
  /** True if split already exists on-chain */
  existsOnChain: boolean;
  /** Current recipients if split exists (undefined if not exists) */
  currentRecipients: SplitRecipient[] | undefined;
}

// =============================================================================
// Default Seed
// =============================================================================

const DEFAULT_SEED = SYSTEM_PROGRAM_ADDRESS;

// =============================================================================
// Main Function
// =============================================================================

/**
 * Estimate rent costs for a split configuration.
 *
 * This is a pure read operation - no transactions are sent.
 * Use this to show costs to users before they commit.
 *
 * @example
 * ```typescript
 * const estimate = await estimateSplitRent(rpc, {
 *   authority: wallet.address,
 *   recipients: [
 *     { address: alice, share: 70 },
 *     { address: bob, share: 29 },
 *   ],
 * });
 *
 * console.log(`Rent required: ${estimate.rentRequired} lamports`);
 * console.log(`Vault will be: ${estimate.vault}`);
 * console.log(`Already exists: ${estimate.existsOnChain}`);
 *
 * if (estimate.existsOnChain) {
 *   console.log(`Current recipients: ${estimate.currentRecipients?.length}`);
 * }
 * ```
 */
export async function estimateSplitRent(
  rpc: Rpc<SolanaRpcApi>,
  params: {
    /** Authority address for the split */
    authority: Address;
    /** Recipients (used only for context, not validation) */
    recipients: Recipient[];
    /** Token mint (defaults to USDC) */
    mint?: Address;
    /** Unique ID for PDA derivation (defaults to System Program ID) */
    uniqueId?: Address;
  },
): Promise<EstimateResult> {
  const { authority, mint = USDC_MINT, uniqueId = DEFAULT_SEED } = params;

  // 1. Derive addresses
  const splitConfigAddress = await deriveSplitConfig(authority, mint, uniqueId);
  const tokenProgram = await detectTokenProgram(rpc, mint);
  const vaultAddress = await deriveVault(
    splitConfigAddress,
    mint,
    tokenProgram,
  );

  // 2. Get rent amounts
  // SplitConfig = 1832 bytes, Vault ATA = 165 bytes
  const splitConfigRent = await rpc
    .getMinimumBalanceForRentExemption(BigInt(1832))
    .send();
  const vaultRent = await rpc
    .getMinimumBalanceForRentExemption(BigInt(165))
    .send();
  const rentRequired = splitConfigRent + vaultRent;

  // 3. Check if exists
  let existsOnChain = false;
  let currentRecipients: SplitRecipient[] | undefined;

  try {
    const config = await getSplitConfig(rpc, splitConfigAddress);
    existsOnChain = true;
    currentRecipients = config.recipients;
  } catch (e) {
    if (!(e instanceof SplitConfigNotFoundError)) throw e;
    // Doesn't exist, that's fine
  }

  return {
    rentRequired,
    splitConfigRent,
    vaultRent,
    vault: vaultAddress,
    splitConfig: splitConfigAddress,
    existsOnChain,
    currentRecipients,
  };
}
