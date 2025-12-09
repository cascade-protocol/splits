/**
 * Idempotent split update with pre-validation
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
import type { Recipient } from "./recipients.js";
import { createKitWallet } from "./client/shared.js";
import { updateImpl } from "./client/update.js";
import type {
  UpdateResult,
  UpdateOptions,
  BlockedReason,
} from "./client/types.js";

// Re-export types
export type { UpdateResult, UpdateOptions };
export type UpdateBlockedReason = BlockedReason;

/**
 * Update split recipients with pre-validation.
 *
 * This is an idempotent operation - safe to call multiple times:
 * - If recipients match (set equality): returns no_change (no transaction)
 * - If recipients differ and updatable: updates and returns signature
 * - If recipients differ but not updatable: returns blocked with reason
 *
 * If vault has balance or unclaimed amounts exist, auto-executes first
 * to clear them (creating recipient ATAs if needed), then updates.
 *
 * Recipients are compared using set equality (order-independent).
 *
 * @example
 * ```typescript
 * const result = await updateSplit({
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   splitConfig,
 *   recipients: [
 *     { address: newRecipient, share: 70 },
 *     { address: bob, share: 29 },
 *   ],
 * });
 *
 * switch (result.status) {
 *   case 'updated':
 *     console.log(`Updated! Tx: ${result.signature}`);
 *     if (result.atasCreated) {
 *       console.log(`Created ${result.atasCreated.length} ATAs`);
 *     }
 *     break;
 *   case 'no_change':
 *     console.log('Recipients already match.');
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
export async function updateSplit(input: {
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
  /** New recipients with share (1-100) or percentageBps (1-9900) */
  recipients: Recipient[];
  /**
   * Auto-create missing recipient ATAs (default: true).
   * Set to false to return blocked status instead of auto-creating.
   */
  createMissingAtas?: boolean;
  /** Commitment level for confirmation (default: 'confirmed') */
  commitment?: UpdateOptions["commitment"];
  /** Priority fee in microlamports per compute unit */
  computeUnitPrice?: UpdateOptions["computeUnitPrice"];
}): Promise<UpdateResult> {
  const {
    rpc,
    rpcSubscriptions,
    signer,
    splitConfig,
    recipients,
    createMissingAtas,
    commitment,
    computeUnitPrice,
  } = input;

  const wallet = createKitWallet(signer, rpc, rpcSubscriptions);

  return updateImpl(
    rpc,
    wallet,
    splitConfig,
    {
      recipients,
      ...(createMissingAtas !== undefined && { createMissingAtas }),
    },
    {
      ...(commitment && { commitment }),
      ...(computeUnitPrice && { computeUnitPrice }),
    },
  );
}
