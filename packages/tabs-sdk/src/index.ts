/**
 * Cascade Tabs SDK
 *
 * TypeScript SDK for Squads Smart Account Program integration.
 *
 * @example
 * ```typescript
 * import {
 *   // Generated instructions
 *   getCreateSmartAccountInstruction,
 *   getAddSpendingLimitAsAuthorityInstruction,
 *   fetchMaybeSettings,
 *
 *   // PDA derivation
 *   deriveSettings,
 *   deriveSmartAccount,
 *   deriveSpendingLimit,
 *
 *   // Account discovery
 *   fetchSmartAccountStateByOwner,
 *
 *   // Constants
 *   PERMISSION_ALL,
 * } from "@cascade-fyi/tabs-sdk";
 * ```
 */

// =============================================================================
// Generated (Codama)
// =============================================================================

export * from "./generated/index.js";

// =============================================================================
// Constants
// =============================================================================

export * from "./constants.js";

// =============================================================================
// Helpers (PDA derivation, sync message compilation)
// =============================================================================

export {
	// PDA derivation
	deriveProgramConfig,
	deriveSettings,
	deriveSmartAccount,
	deriveSpendingLimit,
	deriveAta,
	// Sync message compilation
	compileToSynchronousMessage,
	type SyncAccountMeta,
	type SyncMessageResult,
	// Instruction builders (Address-accepting)
	buildCreateSmartAccountInstruction,
	buildAddSpendingLimitInstruction,
	buildRemoveSpendingLimitInstruction,
	type CreateSmartAccountInput,
	type CreateSmartAccountResult,
	type AddSpendingLimitInput,
	type AddSpendingLimitResult,
	type RemoveSpendingLimitInput,
	// Utilities
	decodeBase64,
	readBigUInt64LE,
	base58Decode,
	// API Key encoding/decoding
	decodeTabsApiKey,
	encodeTabsApiKey,
	type TabsApiKeyPayload,
	type EncodeTabsApiKeyInput,
} from "./helpers.js";

// =============================================================================
// Discovery (Account fetching)
// =============================================================================

export {
	// State fetching
	fetchSmartAccountStateByOwner,
	hasSmartAccount,
	// Types
	type SmartAccountState,
	type SpendingLimitConfig,
} from "./discovery.js";

// =============================================================================
// tabsFetch - x402 Payment Client
// =============================================================================

export {
	tabsFetch,
	TabsPaymentError,
	type TabsFetchOptions,
	type PaymentRequirements,
} from "./tabsFetch.js";
