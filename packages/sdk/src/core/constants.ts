/**
 * Core constants for Cascade Splits SDK
 */

// Program ID
export const PROGRAM_ID = "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB";

// Protocol constants
export const MAX_RECIPIENTS = 20;
export const PROTOCOL_FEE_BPS = 100; // 1%
export const TOTAL_RECIPIENT_BPS = 9900; // 99%

// Serialization sizes
export const ADDRESS_SIZE = 32;
export const U16_SIZE = 2;
export const U32_SIZE = 4;
export const U64_SIZE = 8;
export const DISCRIMINATOR_SIZE = 8;
export const RECIPIENT_SIZE = ADDRESS_SIZE + U16_SIZE; // 34 bytes

// Seeds
export const PROTOCOL_CONFIG_SEED = "protocol_config";
export const SPLIT_CONFIG_SEED = "split_config";

// Token programs
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID =
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID =
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

// Default token mint (USDC)
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Layout offsets for SplitConfig account data.
 * Useful for building getProgramAccounts memcmp filters.
 *
 * Layout: discriminator(8) + version(1) + authority(32) + mint(32) + vault(32) + unique_id(32)
 */
export const LAYOUT_OFFSETS = {
	/** Authority pubkey offset: discriminator(8) + version(1) = 9 */
	AUTHORITY: 9,
	/** Mint pubkey offset: + authority(32) = 41 */
	MINT: 41,
	/** Vault pubkey offset: + mint(32) = 73 */
	VAULT: 73,
	/** Unique ID pubkey offset: + vault(32) = 105 */
	UNIQUE_ID: 105,
} as const;
