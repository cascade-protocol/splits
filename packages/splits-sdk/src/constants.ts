/**
 * SDK Constants
 *
 * Cascade Splits protocol-specific constants.
 * Internal files should import from here to avoid circular dependencies with index.ts.
 */

import type { Address } from "@solana/kit";

// =============================================================================
// Protocol Constants
// =============================================================================

/** Program ID for Cascade Splits */
export const PROGRAM_ID: Address =
  "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address;

/** Maximum recipients per split (protocol limit) */
export const MAX_RECIPIENTS = 20;

/** Protocol fee in basis points (1% = 100 bps) */
export const PROTOCOL_FEE_BPS = 100;

/** Total basis points for all recipients (99% = 9900 bps) */
export const TOTAL_RECIPIENT_BPS = 9900;

/** Default USDC mint (mainnet) */
export const USDC_MINT: Address =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;

// PDA Seeds
export const PROTOCOL_CONFIG_SEED = "protocol_config";
export const SPLIT_CONFIG_SEED = "split_config";

// =============================================================================
// Solana Program Addresses (inlined to avoid @solana-program/token dependency)
// =============================================================================

/** SPL Token Program */
export const TOKEN_PROGRAM_ADDRESS: Address =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/** SPL Token-2022 Program */
export const TOKEN_2022_PROGRAM_ADDRESS: Address =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;

/** Associated Token Program */
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS: Address =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

/** System Program */
export const SYSTEM_PROGRAM_ADDRESS: Address =
  "11111111111111111111111111111111" as Address;
