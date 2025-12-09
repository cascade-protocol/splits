import type { Address } from "viem";

/**
 * Deployed SplitFactory contract addresses per chain.
 * Deterministic addresses (same on ALL EVM chains via CREATE2).
 */
export const SPLIT_FACTORY_ADDRESSES: Record<number, Address> = {
  // Base mainnet (chain ID: 8453)
  8453: "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7",

  // Base Sepolia testnet (chain ID: 84532)
  84532: "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7",
};

/**
 * USDC contract addresses per chain.
 */
export const USDC_ADDRESSES: Record<number, Address> = {
  // Base mainnet
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",

  // Base Sepolia testnet
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/**
 * Get the SplitFactory address for a given chain ID.
 * @throws Error if chain is not supported
 */
export function getSplitFactoryAddress(chainId: number): Address {
  const address = SPLIT_FACTORY_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      `SplitFactory not deployed on chain ${chainId}. Supported chains: Base (8453), Base Sepolia (84532)`,
    );
  }
  return address;
}

/**
 * Get the USDC address for a given chain ID.
 * @throws Error if chain is not supported
 */
export function getUsdcAddress(chainId: number): Address {
  const address = USDC_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      `USDC not configured for chain ${chainId}. Supported chains: Base (8453), Base Sepolia (84532)`,
    );
  }
  return address;
}

/**
 * Check if a chain is supported.
 */
export function isSupportedChain(chainId: number): boolean {
  return chainId in SPLIT_FACTORY_ADDRESSES;
}

/**
 * Supported chain IDs.
 */
export const SUPPORTED_CHAIN_IDS = [8453, 84532] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
