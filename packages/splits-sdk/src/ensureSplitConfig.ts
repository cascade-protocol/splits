/**
 * Idempotent split configuration management
 *
 * Thin wrapper around the core client implementation for direct function API.
 */

import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { USDC_MINT } from "./constants.js";
import type { Recipient } from "./recipients.js";
import { createKitWallet } from "./client/shared.js";
import { ensureSplitImpl } from "./client/ensure.js";
import type {
  EnsureResult,
  EnsureOptions,
  BlockedReason,
} from "./client/types.js";

// Re-export types
export type { EnsureResult, EnsureOptions };
export type EnsureBlockedReason = BlockedReason;

/**
 * Ensure a split configuration exists with the specified recipients.
 *
 * This is an idempotent operation - safe to call multiple times:
 * - If split doesn't exist: creates it (created)
 * - If split exists with same recipients: returns no_change (no transaction)
 * - If split exists with different recipients: updates if possible (updated), or returns blocked
 *
 * By default, missing recipient ATAs are auto-created. Pass `createMissingAtas: false` to opt out.
 *
 * @example
 * ```typescript
 * const result = await ensureSplitConfig({
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   recipients: [
 *     { address: alice, share: 70 },
 *     { address: bob, share: 29 },
 *   ],
 * });
 *
 * switch (result.status) {
 *   case 'created':
 *     console.log(`Created! Vault: ${result.vault}, Rent: ${result.rentPaid}`);
 *     break;
 *   case 'no_change':
 *     console.log('Already configured correctly.');
 *     break;
 *   case 'updated':
 *     console.log(`Updated recipients. Tx: ${result.signature}`);
 *     break;
 *   case 'blocked':
 *     console.log(`Cannot update: ${result.reason} - ${result.message}`);
 *     break;
 *   case 'failed':
 *     console.log(`Transaction failed: ${result.message}`);
 *     break;
 * }
 * ```
 */
export async function ensureSplitConfig(input: {
  /** RPC client */
  rpc: Rpc<SolanaRpcApi>;
  /** RPC subscriptions for transaction confirmation */
  rpcSubscriptions: RpcSubscriptions<
    SignatureNotificationsApi & SlotNotificationsApi
  >;
  /** Transaction signer */
  signer: TransactionSigner;
  /** Recipients with share (1-100) or percentageBps (1-9900) */
  recipients: Recipient[];
  /** Token mint (defaults to USDC) */
  mint?: Address;
  /**
   * Unique ID for deterministic PDA derivation.
   *
   * Split address = `[signer.address, mint, uniqueId]`
   *
   * **Idempotency**: Same inputs = same address. Safe to call multiple times.
   *
   * - Omit → one split per signer/mint (simplest)
   * - `labelToSeed("name")` → multiple named splits
   * - `generateUniqueId()` → random (must store result)
   */
  uniqueId?: Address;
  /** Payer for rent (defaults to signer) */
  payer?: TransactionSigner;
  /** Auto-create missing recipient ATAs (default: true) */
  createMissingAtas?: boolean;
  /** Commitment level for confirmation (default: 'confirmed') */
  commitment?: EnsureOptions["commitment"];
  /** Priority fee in microlamports per compute unit */
  computeUnitPrice?: EnsureOptions["computeUnitPrice"];
}): Promise<EnsureResult> {
  const {
    rpc,
    rpcSubscriptions,
    signer,
    recipients,
    mint,
    uniqueId,
    payer,
    createMissingAtas,
    commitment,
    computeUnitPrice,
  } = input;

  const wallet = createKitWallet(signer, rpc, rpcSubscriptions);

  return ensureSplitImpl(
    rpc,
    wallet,
    {
      recipients,
      mint: mint ?? USDC_MINT,
      uniqueId: uniqueId ?? SYSTEM_PROGRAM_ADDRESS,
      ...(payer && { payer: payer.address }),
      ...(createMissingAtas !== undefined && { createMissingAtas }),
    },
    {
      ...(commitment && { commitment }),
      ...(computeUnitPrice && { computeUnitPrice }),
    },
  );
}
