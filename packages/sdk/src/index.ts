/**
 * Cascade Splits SDK
 *
 * Modern TypeScript SDK with 100-share mental model
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
export {
	PROGRAM_ID,
	MAX_RECIPIENTS,
	PROTOCOL_FEE_BPS,
	ADDRESS_SIZE,
	U16_SIZE,
	U32_SIZE,
	U64_SIZE,
	DISCRIMINATOR_SIZE,
	RECIPIENT_SIZE,
	PROTOCOL_CONFIG_SEED,
	SPLIT_CONFIG_SEED,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	SYSTEM_PROGRAM_ID,
	USDC_MINT,
} from "./core/constants.js";
export * from "./core/schemas.js";
export type {
	ProcessedCreateSplit,
	ProcessedUpdateSplit,
	RecipientDistribution,
} from "./core/business-logic.js";
export {
	validateAndTransformCreate,
	validateAndTransformUpdate,
	calculateDistribution,
	previewDistribution,
	sharesToBasisPoints,
	basisPointsToShares,
} from "./core/business-logic.js";

// Shared types (internal representations)
export type {
	Recipient,
	UnclaimedAmount,
	ProtocolConfig,
	SplitConfig,
	SplitWithBalance,
	DistributionPreview,
} from "./core/types.js";

// Discriminators
export * from "./discriminators.js";

// Errors
export * from "./errors.js";

// PDA derivation (framework-agnostic, string-based)
export {
	deriveProtocolConfig,
	deriveSplitConfig,
	deriveVault,
	deriveAta,
	deriveProgramData,
	deriveCreateSplitConfigAddresses,
} from "./pda.js";
export type { CreateSplitConfigResult } from "./pda.js";

// Encoding utilities (base58)
export { encodeAddress, decodeAddress } from "./core/encoding.js";

// Deserialization utilities (use getSplit() for split config with shares)
export { deserializeProtocolConfig } from "./core/deserialization.js";

// Account sizes (for memcmp filters)
export {
	SPLIT_CONFIG_SIZE,
	PROTOCOL_CONFIG_SIZE,
} from "./core/deserialization.js";

// Layout offsets (for getProgramAccounts filters)
export { LAYOUT_OFFSETS } from "./core/constants.js";

// State inspection helpers
export {
	hasUnclaimedAmounts,
	getTotalUnclaimed,
	canUpdateOrClose,
} from "./core/helpers.js";

// IDL export
import IDL_JSON from "../idl.json" with { type: "json" };
export const IDL = IDL_JSON;
export type CascadeSplitsIDL = typeof IDL_JSON;
