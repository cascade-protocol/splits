/**
 * Cascade Splits SDK
 *
 * Modern TypeScript SDK with 100-share mental model (hides 1% protocol fee)
 * Supports both @solana/web3.js and @solana/kit
 *
 * @example
 * ```typescript
 * // For @solana/web3.js users
 * import { CascadeSplits } from '@cascade-fyi/splits-sdk/web3';
 *
 * const sdk = CascadeSplits.mainnet();
 * const result = await sdk.buildCreateSplit(authority, {
 *   recipients: [
 *     { address: "alice...", share: 60 },
 *     { address: "bob...", share: 40 }
 *   ]
 * });
 *
 * // For @solana/kit users
 * import { CascadeSplits } from '@cascade-fyi/splits-sdk/kit';
 * // (Kit adapter coming soon)
 *
 * // Shared utilities and types
 * import { PROGRAM_ID, deriveSplitConfig } from '@cascade-fyi/splits-sdk';
 * import type { ShareRecipient } from '@cascade-fyi/splits-sdk';
 * ```
 */

// Dual exports for framework-specific implementations
export * as web3 from "./web3/index.js";
export * as kit from "./kit/index.js";

// Core exports (schemas, business logic, constants)
export * from "./core/constants.js";
export * from "./core/schemas.js";
export type {
	ProtocolRecipient,
	ProcessedCreateSplit,
	ProcessedUpdateSplit,
	RecipientDistribution,
} from "./core/business-logic.js";
export {
	sharesToBasisPoints,
	basisPointsToShares,
	validateAndTransformCreate,
	validateAndTransformUpdate,
	calculateDistribution,
	previewDistribution,
} from "./core/business-logic.js";

// Shared types (internal representations)
export type {
	Recipient,
	UnclaimedAmount,
	ProtocolConfig,
	SplitConfig,
	DistributionPreview,
} from "./core/types.js";

// Discriminators
export * from "./discriminators.js";

// PDA derivation (framework-agnostic, string-based)
export {
	deriveProtocolConfig,
	deriveSplitConfig,
	deriveVault,
	deriveAta,
	deriveProgramData,
} from "./pda.js";

// Encoding utilities (base58)
export { encodeAddress, decodeAddress } from "./core/encoding.js";

// Deserialization utilities
export {
	deserializeSplitConfig,
	deserializeProtocolConfig,
} from "./core/deserialization.js";

// IDL export
import IDL_JSON from "../idl.json" with { type: "json" };
export const IDL = IDL_JSON;
export type CascadeSplitsIDL = typeof IDL_JSON;
