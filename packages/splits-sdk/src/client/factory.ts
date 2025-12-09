/**
 * Cascade Splits Client Factory
 *
 * High-level client for interacting with Cascade Splits.
 * Kit-native with no @solana/web3.js imports.
 *
 * @example
 * ```typescript
 * import { createSplitsClient } from "@cascade-fyi/splits-sdk/solana/client";
 * import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes } from "@solana/kit";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
 * const signer = await createKeyPairSignerFromBytes(secretKey);
 *
 * const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });
 * ```
 */

import type {
  Rpc,
  SolanaRpcApi,
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
  TransactionSigner,
  Address,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { USDC_MINT } from "../constants.js";
import type {
  SplitsWallet,
  SplitsClientConfig,
  EnsureParams,
  UpdateParams,
  CloseParams,
  ExecuteOptions,
  EnsureResult,
  UpdateResult,
  CloseResult,
  ExecuteResult,
} from "./types.js";
import { ensureSplitImpl } from "./ensure.js";
import { updateImpl } from "./update.js";
import { closeImpl } from "./close.js";
import { executeImpl } from "./execute.js";
import { createKitWallet } from "./shared.js";

/**
 * Options for createSplitsClient.
 */
export interface SplitsClientOptions extends SplitsClientConfig {
  /** Solana RPC client */
  rpc: Rpc<SolanaRpcApi>;
  /** Solana RPC subscriptions for WebSocket confirmation */
  rpcSubscriptions: RpcSubscriptions<
    SignatureNotificationsApi & SlotNotificationsApi
  >;
  /** Transaction signer (from createKeyPairSignerFromBytes, generateKeyPairSigner, etc.) */
  signer: TransactionSigner;
}

/**
 * Create a Splits client using @solana/kit primitives.
 *
 * @param options - RPC, subscriptions, signer, and optional config
 * @returns SplitsClient object with methods for split operations
 *
 * @example
 * ```typescript
 * import { createSplitsClient } from "@cascade-fyi/splits-sdk/solana/client";
 * import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes } from "@solana/kit";
 *
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com");
 * const signer = await createKeyPairSignerFromBytes(secretKey);
 *
 * const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });
 *
 * // Create or get existing split (idempotent)
 * const result = await splits.ensureSplit({
 *   recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
 * });
 *
 * if (result.status === 'created') {
 *   console.log(`Created split! Vault: ${result.vault}`);
 * }
 *
 * // Execute distribution
 * await splits.execute(result.splitConfig);
 * ```
 */
export function createSplitsClient(options: SplitsClientOptions) {
  const { rpc, rpcSubscriptions, signer, ...config } = options;
  const wallet = createKitWallet(signer, rpc, rpcSubscriptions);
  return createClientImpl(rpc, wallet, config);
}

/**
 * Create a Splits client with a custom wallet adapter.
 *
 * Use this for browser wallet-adapter integration via `fromWalletAdapter`.
 *
 * @param rpc - Solana RPC client
 * @param wallet - Wallet adapter (from fromWalletAdapter)
 * @param config - Optional client configuration
 * @returns SplitsClient object
 *
 * @example
 * ```typescript
 * import { createSplitsClientWithWallet } from "@cascade-fyi/splits-sdk/solana/client";
 * import { fromWalletAdapter } from "@cascade-fyi/splits-sdk/solana/web3-compat";
 *
 * const splits = createSplitsClientWithWallet(
 *   rpc,
 *   fromWalletAdapter(walletAdapter, connection),
 * );
 * ```
 */
export function createSplitsClientWithWallet(
  rpc: Rpc<SolanaRpcApi>,
  wallet: SplitsWallet,
  config: SplitsClientConfig = {},
) {
  return createClientImpl(rpc, wallet, config);
}

/**
 * Internal: Shared client implementation.
 */
function createClientImpl(
  rpc: Rpc<SolanaRpcApi>,
  wallet: SplitsWallet,
  config: SplitsClientConfig,
) {
  return {
    /**
     * Create or update a split configuration (idempotent).
     *
     * - If split doesn't exist: creates it, returns `created`
     * - If split exists with same recipients: returns `no_change`
     * - If split exists with different recipients: updates if possible, or returns `blocked`
     *
     * @param params - Split parameters (recipients, mint, seed/label)
     * @returns EnsureResult with status and relevant data
     */
    ensureSplit: (params: EnsureParams): Promise<EnsureResult> =>
      ensureSplitImpl(
        rpc,
        wallet,
        {
          ...params,
          mint: params.mint ?? USDC_MINT,
          uniqueId: params.uniqueId ?? SYSTEM_PROGRAM_ADDRESS,
        },
        config,
      ),

    /**
     * Update recipients of an existing split.
     *
     * - If recipients match: returns `no_change`
     * - If vault has balance or unclaimed: auto-executes first, then updates
     * - Otherwise: updates recipients, returns `updated`
     *
     * Missing ATAs are created automatically by default. Set `createMissingAtas: false`
     * to return `blocked` instead.
     *
     * @param splitConfig - Split config PDA address
     * @param params - New recipients and options
     * @returns UpdateResult with status
     */
    update: (
      splitConfig: Address,
      params: UpdateParams,
    ): Promise<UpdateResult> =>
      updateImpl(rpc, wallet, splitConfig, params, config),

    /**
     * Close a split and recover rent.
     *
     * - If already closed: returns `already_closed`
     * - If vault has balance or unclaimed: auto-executes first, then closes
     * - Otherwise: closes and returns rent recovered
     *
     * Missing ATAs are created automatically by default. Set `createMissingAtas: false`
     * to return `blocked` instead.
     *
     * Rent is automatically returned to the original payer.
     *
     * @param splitConfig - Split config PDA address
     * @param params - Optional close params
     * @returns CloseResult with status and rent recovered
     */
    close: (
      splitConfig: Address,
      params: CloseParams = {},
    ): Promise<CloseResult> =>
      closeImpl(rpc, wallet, splitConfig, params, config),

    /**
     * Execute a split distribution.
     *
     * Distributes all tokens in the vault to recipients according to their shares.
     * Permissionless - anyone can execute.
     *
     * @param splitConfig - Split config PDA address
     * @param options - Optional execution options
     * @returns ExecuteResult with status
     */
    execute: (
      splitConfig: Address,
      options?: ExecuteOptions,
    ): Promise<ExecuteResult> =>
      executeImpl(rpc, wallet, splitConfig, { ...config, ...options }),

    /**
     * Get the wallet address.
     */
    get address(): Address {
      return wallet.address;
    },
  };
}

/**
 * Type of the SplitsClient returned by createSplitsClient.
 */
export type SplitsClient = ReturnType<typeof createSplitsClient>;
