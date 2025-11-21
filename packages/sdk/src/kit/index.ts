/**
 * Functional @solana/kit v5 adapter for Cascade Splits
 * Uses 100-share mental model (hides protocol fee internally)
 */

export type { Address, Rpc } from "@solana/kit";

// Re-export instruction builders
export {
	buildCreateSplitInstruction,
	buildExecuteSplitInstruction,
	buildUpdateSplitInstruction,
	buildCloseSplitInstruction,
} from "./instructions.js";

// Re-export read functions
export {
	getSplit,
	getVaultBalance,
	getProtocolConfig,
	previewExecution,
	deserializeSplitConfig,
	deserializeProtocolConfig,
} from "./read.js";

// Re-export types for convenience
export type {
	ShareRecipient,
	CreateSplitInput,
	UpdateSplitInput,
} from "../core/schemas.js";
export type { DistributionPreview, SplitConfig } from "../core/types.js";
