import type { Address, Chain, Hash } from "viem";
import type {
  EvmEnsureResult,
  EvmExecuteResult,
  EvmSplitConfig,
  EvmExecutionPreview,
  EvmExecuteOptions,
  EvmRecipientInput,
} from "../types.js";

/**
 * Parameters for creating a split via the client.
 */
export interface ClientEnsureParams {
  /** Authority (owner) of the split. Defaults to wallet address. */
  authority?: Address;
  /** ERC20 token to split. Defaults to USDC on the connected chain. */
  token?: Address;
  /** Unique identifier for deterministic addressing. */
  uniqueId: Hash;
  /** Recipients with shares or basis points. */
  recipients: EvmRecipientInput[];
}

/**
 * Configuration for creating an EVM splits client.
 */
export interface EvmSplitsClientConfig {
  /** Override the factory address (uses deployed address by default) */
  factoryAddress?: Address;
}

/**
 * High-level client for interacting with Cascade Splits on EVM chains.
 *
 * @example
 * ```typescript
 * import { createEvmSplitsClient } from '@cascade-fyi/splits-sdk/evm/client';
 * import { base } from 'viem/chains';
 * import { privateKeyToAccount } from 'viem/accounts';
 *
 * const client = createEvmSplitsClient(base, {
 *   account: privateKeyToAccount('0x...')
 * });
 *
 * const result = await client.ensureSplit({
 *   uniqueId: '0x...',
 *   recipients: [
 *     { address: '0xAlice...', share: 60 },
 *     { address: '0xBob...', share: 40 }
 *   ]
 * });
 * ```
 */
export interface EvmSplitsClient {
  /** The wallet address */
  readonly address: Address;

  /** The connected chain */
  readonly chain: Chain;

  /** The factory address being used */
  readonly factoryAddress: Address;

  /**
   * Create a split (idempotent).
   * Returns NO_CHANGE if split already exists with same parameters.
   */
  ensureSplit(params: ClientEnsureParams): Promise<EvmEnsureResult>;

  /**
   * Execute split distribution.
   * Anyone can call this - it's permissionless.
   */
  execute(
    splitAddress: Address,
    options?: EvmExecuteOptions,
  ): Promise<EvmExecuteResult>;

  /**
   * Get split configuration from an address.
   * Returns null if not a valid split.
   */
  getSplit(splitAddress: Address): Promise<EvmSplitConfig | null>;

  /**
   * Get the token balance of a split.
   */
  getBalance(splitAddress: Address): Promise<bigint>;

  /**
   * Check if an address is a Cascade Split.
   */
  isCascadeSplit(address: Address): Promise<boolean>;

  /**
   * Preview what will happen when executeSplit is called.
   */
  previewExecution(splitAddress: Address): Promise<EvmExecutionPreview>;

  /**
   * Predict the address of a split before creation.
   */
  predictSplitAddress(params: ClientEnsureParams): Promise<Address>;
}
