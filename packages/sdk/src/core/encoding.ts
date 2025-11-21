/**
 * Encoding utilities for Solana addresses
 */

import bs58 from "bs58";

/**
 * Decode a base58-encoded Solana address to bytes
 */
export function decodeAddress(address: string): Uint8Array {
	return bs58.decode(address);
}

/**
 * Encode bytes to a base58-encoded Solana address
 */
export function encodeAddress(bytes: Uint8Array): string {
	return bs58.encode(bytes);
}
