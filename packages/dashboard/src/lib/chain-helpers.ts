import { isAddress } from "viem";
import type { ActiveChain } from "@/contexts/chain-context";

// =============================================================================
// Address Validation
// =============================================================================

/**
 * Validates a Solana address (base58, 32-44 chars)
 */
export function isValidSolanaAddress(address: string): boolean {
	const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
	return base58Regex.test(address);
}

/**
 * Validates an EVM address (0x + 40 hex chars)
 */
export function isValidEvmAddress(address: string): boolean {
	return isAddress(address);
}

/**
 * Validates an address for the given chain.
 */
export function isValidAddress(address: string, chain: ActiveChain): boolean {
	if (chain === "solana") {
		return isValidSolanaAddress(address);
	}
	return isValidEvmAddress(address);
}

/**
 * Returns error message for invalid address, or null if valid.
 */
export function getAddressError(
	address: string,
	chain: ActiveChain,
): string | null {
	if (!address) return "Address is required";
	if (!isValidAddress(address, chain)) {
		return chain === "solana"
			? "Invalid Solana address"
			: "Invalid EVM address";
	}
	return null;
}

// =============================================================================
// Address Formatting
// =============================================================================

/**
 * Truncate address for display (e.g., "0x1234...5678" or "ABC1...XYZ9")
 */
export function formatAddress(
	address: string,
	prefixLen = 6,
	suffixLen = 4,
): string {
	if (address.length <= prefixLen + suffixLen) return address;
	return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// =============================================================================
// Explorer URLs
// =============================================================================

const EXPLORERS: Record<ActiveChain, { name: string; baseUrl: string }> = {
	solana: {
		name: "Solscan",
		baseUrl: "https://solscan.io",
	},
	base: {
		name: "Basescan",
		baseUrl: "https://basescan.org",
	},
};

/**
 * Get explorer name for a chain (e.g., "Solscan", "Basescan")
 */
export function getExplorerName(chain: ActiveChain): string {
	return EXPLORERS[chain].name;
}

/**
 * Get explorer URL for an address.
 */
export function getAddressExplorerUrl(
	address: string,
	chain: ActiveChain,
): string {
	const { baseUrl } = EXPLORERS[chain];
	return `${baseUrl}/address/${address}`;
}

/**
 * Get explorer URL for a transaction.
 */
export function getTxExplorerUrl(txHash: string, chain: ActiveChain): string {
	const { baseUrl } = EXPLORERS[chain];
	if (chain === "solana") {
		return `${baseUrl}/tx/${txHash}`;
	}
	return `${baseUrl}/tx/${txHash}`;
}

// =============================================================================
// Chain-specific Constants
// =============================================================================

/**
 * USDC decimals (same on both chains)
 */
export const USDC_DECIMALS = 6;

/**
 * Whether the chain supports updating/closing splits.
 * Solana splits are mutable, EVM splits are immutable.
 */
export function supportsUpdate(chain: ActiveChain): boolean {
	return chain === "solana";
}

/**
 * Whether the chain supports closing splits.
 */
export function supportsClose(chain: ActiveChain): boolean {
	return chain === "solana";
}
