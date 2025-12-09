/**
 * High-level Cascade Splits client.
 *
 * @example
 * ```typescript
 * import { createSplitsClient } from "@cascade-fyi/splits-sdk";
 * import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes } from "@solana/kit";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
 * const signer = await createKeyPairSignerFromBytes(secretKey);
 *
 * const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });
 * ```
 */

export {
  createSplitsClient,
  createSplitsClientWithWallet,
  type SplitsClient,
  type SplitsClientOptions,
} from "./factory.js";

// Re-export high-level functions for direct use
export {
  ensureSplitConfig,
  type EnsureResult,
  type EnsureBlockedReason,
  type EnsureOptions,
} from "../ensureSplitConfig.js";

export {
  executeAndConfirmSplit,
  type ExecuteResult,
  type ExecuteOptions,
  type ExecuteAndConfirmOptions,
  type SkippedReason,
  type FailedReason,
} from "../execute.js";

export {
  updateSplit,
  type UpdateResult,
  type UpdateBlockedReason,
  type UpdateOptions,
} from "../updateSplit.js";

export {
  closeSplit,
  type CloseResult,
  type CloseBlockedReason,
  type CloseOptions,
} from "../closeSplit.js";

// Client types (for wallet adapter implementations)
export type {
  SplitsWallet,
  SplitsClientConfig,
  TransactionMessage,
  EnsureParams,
  UpdateParams,
} from "./types.js";

// Re-export types for convenience
export type { SplitRecipient } from "../helpers.js";
