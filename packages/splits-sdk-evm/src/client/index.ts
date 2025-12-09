import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Transport,
} from "viem";
import { getSplitFactoryAddress } from "../addresses.js";
import { ensureSplit } from "../ensure.js";
import { executeSplit } from "../execute.js";
import {
  getSplitConfig,
  getSplitBalance,
  isCascadeSplit,
  previewExecution,
  predictSplitAddress,
  toEvmRecipients,
  getDefaultToken,
} from "../helpers.js";
import type {
  EvmSplitsClient,
  EvmSplitsClientConfig,
  ClientEnsureParams,
} from "./types.js";

export type { EvmSplitsClient, EvmSplitsClientConfig, ClientEnsureParams };

/**
 * Wallet configuration for creating a splits client.
 */
export interface WalletConfig {
  /** The account to use for signing */
  account: Account;
  /** Optional custom transport (defaults to http()) */
  transport?: Transport;
}

/**
 * Create a high-level EVM splits client.
 *
 * @param chain - The chain to connect to (e.g., base, baseSepolia)
 * @param wallet - Wallet configuration with account
 * @param config - Optional client configuration
 *
 * @example
 * ```typescript
 * import { createEvmSplitsClient } from '@cascade-fyi/splits-sdk-evm/client';
 * import { base } from 'viem/chains';
 * import { privateKeyToAccount } from 'viem/accounts';
 *
 * const client = createEvmSplitsClient(base, {
 *   account: privateKeyToAccount('0x...')
 * });
 *
 * // Create a split
 * const result = await client.ensureSplit({
 *   uniqueId: '0x0000000000000000000000000000000000000000000000000000000000000001',
 *   recipients: [
 *     { address: '0xAlice...', share: 60 },
 *     { address: '0xBob...', share: 40 }
 *   ]
 * });
 *
 * if (result.status === 'CREATED') {
 *   console.log('Split created at', result.split);
 *
 *   // Execute when funds arrive
 *   const execResult = await client.execute(result.split);
 * }
 * ```
 */
export function createEvmSplitsClient(
  chain: Chain,
  wallet: WalletConfig,
  config?: EvmSplitsClientConfig,
): EvmSplitsClient {
  const transport = wallet.transport ?? http();

  const publicClient = createPublicClient({
    chain,
    transport,
  });

  const walletClient = createWalletClient({
    chain,
    transport,
    account: wallet.account,
  });

  const factoryAddress =
    config?.factoryAddress ?? getSplitFactoryAddress(chain.id);

  return {
    get address(): Address {
      return wallet.account.address;
    },

    get chain(): Chain {
      return chain;
    },

    get factoryAddress(): Address {
      return factoryAddress;
    },

    async ensureSplit(params: ClientEnsureParams) {
      return ensureSplit(publicClient, walletClient, factoryAddress, {
        authority: params.authority,
        token: params.token,
        uniqueId: params.uniqueId,
        recipients: params.recipients,
      });
    },

    async execute(splitAddress, options) {
      return executeSplit(publicClient, walletClient, splitAddress, options);
    },

    async getSplit(splitAddress) {
      return getSplitConfig(publicClient, splitAddress);
    },

    async getBalance(splitAddress) {
      return getSplitBalance(publicClient, splitAddress);
    },

    async isCascadeSplit(address) {
      return isCascadeSplit(publicClient, address);
    },

    async previewExecution(splitAddress) {
      return previewExecution(publicClient, splitAddress);
    },

    async predictSplitAddress(params) {
      const authority = params.authority ?? wallet.account.address;
      const token = params.token ?? getDefaultToken(chain.id);
      const evmRecipients = toEvmRecipients(params.recipients);

      return predictSplitAddress(publicClient, factoryAddress, {
        authority,
        token,
        uniqueId: params.uniqueId,
        recipients: evmRecipients,
      });
    },
  };
}
