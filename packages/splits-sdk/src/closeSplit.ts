/**
 * Idempotent split closure with pre-validation
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
import { createKitWallet } from "./client/shared.js";
import { closeImpl } from "./client/close.js";
import type {
  CloseResult,
  CloseOptions,
  BlockedReason,
} from "./client/types.js";

// Re-export types
export type { CloseResult, CloseOptions };
export type CloseBlockedReason = BlockedReason;

/**
 * Close a split configuration and recover rent.
 *
 * This is an idempotent operation - safe to call multiple times:
 * - If split doesn't exist: returns already_closed
 * - If split exists and closeable: closes and returns rent recovered
 * - If split exists but not closeable: returns blocked with reason
 *
 * If vault has balance or unclaimed amounts exist, auto-executes first
 * to clear them (creating recipient ATAs if needed), then closes.
 *
 * Rent is automatically sent to the original rent payer.
 *
 * @example
 * ```typescript
 * const result = await closeSplit({ rpc, rpcSubscriptions, signer, splitConfig });
 *
 * switch (result.status) {
 *   case 'closed':
 *     console.log(`Recovered ${result.rentRecovered} lamports`);
 *     if (result.atasCreated) {
 *       console.log(`Created ${result.atasCreated.length} ATAs`);
 *     }
 *     break;
 *   case 'already_closed':
 *     console.log('Already closed (idempotent)');
 *     break;
 *   case 'blocked':
 *     console.log(`Cannot close: ${result.reason} - ${result.message}`);
 *     break;
 *   case 'failed':
 *     console.log(`Transaction failed: ${result.message}`);
 *     break;
 * }
 * ```
 */
export async function closeSplit(input: {
  /** RPC client */
  rpc: Rpc<SolanaRpcApi>;
  /** RPC subscriptions for transaction confirmation */
  rpcSubscriptions: RpcSubscriptions<
    SignatureNotificationsApi & SlotNotificationsApi
  >;
  /** Transaction signer (must be split authority) */
  signer: TransactionSigner;
  /** SplitConfig PDA address */
  splitConfig: Address;
  /**
   * Auto-create missing recipient ATAs (default: true).
   * Set to false to return blocked status instead of auto-creating.
   */
  createMissingAtas?: boolean;
  /** Commitment level for confirmation (default: 'confirmed') */
  commitment?: CloseOptions["commitment"];
  /** Priority fee in microlamports per compute unit */
  computeUnitPrice?: CloseOptions["computeUnitPrice"];
}): Promise<CloseResult> {
  const {
    rpc,
    rpcSubscriptions,
    signer,
    splitConfig,
    createMissingAtas,
    commitment,
    computeUnitPrice,
  } = input;

  const wallet = createKitWallet(signer, rpc, rpcSubscriptions);

  return closeImpl(
    rpc,
    wallet,
    splitConfig,
    { ...(createMissingAtas !== undefined && { createMissingAtas }) },
    {
      ...(commitment && { commitment }),
      ...(computeUnitPrice && { computeUnitPrice }),
    },
  );
}
