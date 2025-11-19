/**
 * Cascade Splits SDK
 *
 * Dual-export library supporting both @solana/web3.js and @solana/kit
 *
 * @example
 * ```typescript
 * // For @solana/web3.js / @coral-xyz/anchor users
 * import { web3 } from '@cascade-labs/splits';
 * const ix = web3.buildExecuteSplitInstruction(splitConfig, vault, ...);
 *
 * // For @solana/kit users
 * import { kit } from '@cascade-labs/splits';
 * const ix = kit.buildExecuteSplitInstruction(splitConfig, vault, ...);
 *
 * // Shared types and utilities
 * import { PROGRAM_ID, RecipientInput, deriveSplitConfig } from '@cascade-labs/splits';
 * ```
 */

// Dual exports for framework-specific implementations
export * as web3 from "./web3";
export * as kit from "./kit";

// Shared exports
export * from "./types";
export * from "./discriminators";

// String-based PDA derivation (framework-agnostic)
export {
  deriveProtocolConfig,
  deriveSplitConfig,
  deriveVault,
  deriveAta,
  deriveProgramData,
  deriveCreateSplitConfigAddresses,
} from "./pda";

// IDL export
import IDL_JSON from "../idl.json";
export const IDL = IDL_JSON;
export type CascadeSplitsIDL = typeof IDL_JSON;
