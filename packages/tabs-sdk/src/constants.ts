/**
 * Constants for Squads Smart Account Program.
 *
 * PDA seeds, permission bitmasks, and common token addresses.
 */

// =============================================================================
// PDA Seeds
// =============================================================================

/**
 * Base prefix for all Squads PDAs.
 * All seeds start with "smart_account".
 */
export const SEED_PREFIX = "smart_account";

/** Seed for ProgramConfig PDA */
export const SEED_PROGRAM_CONFIG = "program_config";

/** Seed for Settings PDA */
export const SEED_SETTINGS = "settings";

/** Seed for SmartAccount (vault) PDA */
export const SEED_SMART_ACCOUNT = "smart_account";

/** Seed for SpendingLimit PDA */
export const SEED_SPENDING_LIMIT = "spending_limit";

// =============================================================================
// Permission Bitmask
// =============================================================================

/**
 * Permission bitmask values for SmartAccountSigner.
 *
 * Squads uses a u8 bitmask where each bit represents a permission:
 * - Bit 0 (1): Initiate - Can create proposals/transactions
 * - Bit 1 (2): Vote - Can approve/reject proposals
 * - Bit 2 (4): Execute - Can execute approved transactions
 * - Bit 3 (8): Reserved/Admin - Additional permission bit
 *
 * @example
 * ```typescript
 * // Full permissions (all 4 bits set)
 * const ownerSigner: SmartAccountSigner = {
 *   key: owner.address,
 *   permissions: { mask: PERMISSION_ALL },
 * };
 *
 * // Execute-only signer
 * const executor: SmartAccountSigner = {
 *   key: executor.address,
 *   permissions: { mask: PERMISSION_EXECUTE },
 * };
 * ```
 */
export const PERMISSION_INITIATE = 1; // 0b0001
export const PERMISSION_VOTE = 2; // 0b0010
export const PERMISSION_EXECUTE = 4; // 0b0100
export const PERMISSION_RESERVED = 8; // 0b1000

/**
 * Standard owner permissions (INITIATE | VOTE | EXECUTE).
 * Use this for owner/authority signers. Does not include reserved bit.
 */
export const PERMISSION_OWNER = 7; // 0b0111

/**
 * All permission bits including reserved.
 * WARNING: Some program versions may reject the reserved bit (0b1000).
 * Prefer PERMISSION_OWNER for compatibility.
 */
export const PERMISSION_ALL = 15; // 0b1111

// =============================================================================
// Token Addresses
// =============================================================================

/** SPL Token program ID */
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** SPL Token 2022 program ID */
export const TOKEN_2022_PROGRAM_ID =
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Associated Token Account program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID =
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
