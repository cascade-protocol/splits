/**
 * Cascade Splits SDK - EVM
 *
 * Support for EVM chains (Base, etc.) using viem.
 *
 * @example
 * ```typescript
 * // Low-level functions
 * import { ensureSplit, executeSplit, isCascadeSplit } from '@cascade-fyi/splits-sdk-evm';
 *
 * // High-level client
 * import { createEvmSplitsClient } from '@cascade-fyi/splits-sdk-evm/client';
 * ```
 */

// ABIs
export { splitFactoryAbi, splitConfigImplAbi } from "./abi.js";

// Addresses
export {
  SPLIT_FACTORY_ADDRESSES,
  USDC_ADDRESSES,
  SUPPORTED_CHAIN_IDS,
  getSplitFactoryAddress,
  getUsdcAddress,
  isSupportedChain,
  type SupportedChainId,
} from "./addresses.js";

// Types
export type {
  EvmRecipient,
  EvmSplitConfig,
  EvmExecutionPreview,
  EvmEnsureStatus,
  EvmExecuteStatus,
  EvmFailedReason,
  EvmSkippedReason,
  EvmEnsureResult,
  EvmExecuteResult,
  EvmEnsureParams,
  EvmRecipientInput,
  EvmExecuteOptions,
} from "./types.js";

// Helpers
export {
  predictSplitAddress,
  isCascadeSplit,
  getSplitBalance,
  hasPendingFunds,
  getPendingAmount,
  getTotalUnclaimed,
  previewExecution,
  getSplitConfig,
  getDefaultToken,
  toEvmRecipient,
  toEvmRecipients,
} from "./helpers.js";

// Core operations
export { ensureSplit } from "./ensure.js";
export { executeSplit } from "./execute.js";
