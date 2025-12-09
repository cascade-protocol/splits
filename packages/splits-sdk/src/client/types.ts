/**
 * Client types for Cascade Splits SDK
 *
 * Defines the wallet interface, configuration, and result types
 * for the high-level client API.
 *
 * All types use @solana/kit - no @solana/web3.js imports.
 * Adapters in web3-compat handle conversion when needed.
 */

import type {
	Address,
	Commitment,
	Signature,
	Instruction,
	Blockhash,
} from "@solana/kit";
import type { Recipient } from "../index.js";

// =============================================================================
// Transaction Message Type
// =============================================================================

/**
 * Kit transaction message structure (result of pipe() with transaction builders).
 *
 * This represents the unsigned transaction message built using @solana/kit's
 * functional pipeline. The actual kit type is deeply nested generics,
 * so we use a simplified interface for the properties we need.
 */
export interface TransactionMessage {
	/** Fee payer address */
	readonly feePayer: Address;
	/** Transaction instructions */
	readonly instructions: readonly Instruction[];
	/** Blockhash lifetime constraint */
	readonly lifetimeConstraint: {
		readonly blockhash: Blockhash;
		readonly lastValidBlockHeight: bigint;
	};
}

// =============================================================================
// Wallet Interface
// =============================================================================

/**
 * Minimal wallet interface for signing and sending transactions.
 *
 * Used internally by the client. For most use cases, use `createSplitsClient`
 * which accepts kit primitives directly.
 *
 * For browser wallet-adapter integration, use `createSplitsClientWithWallet`
 * with `fromWalletAdapter` from `@cascade-fyi/splits-sdk/solana/web3-compat`.
 */
export interface SplitsWallet {
	/** The wallet's public key as an Address */
	readonly address: Address;

	/**
	 * Sign and send a transaction message, returning the signature.
	 *
	 * The adapter is responsible for:
	 * 1. Converting the message to the appropriate format (if needed)
	 * 2. Signing the transaction
	 * 3. Sending to the network
	 * 4. Confirming with the specified commitment
	 */
	signAndSend(
		message: TransactionMessage,
		options?: { commitment?: Commitment; abortSignal?: AbortSignal },
	): Promise<Signature>;
}

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Configuration for the SplitsClient.
 */
export interface SplitsClientConfig {
	/** Default commitment level for confirmations (default: 'confirmed') */
	commitment?: Commitment;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
}

// =============================================================================
// Operation Options (for direct function API)
// =============================================================================

/**
 * Base options shared by all client operations
 */
export interface BaseClientOptions {
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: Commitment;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
}

/** Options for ensureSplitConfig() direct function */
export type EnsureOptions = BaseClientOptions;

/** Options for closeSplit() direct function */
export type CloseOptions = BaseClientOptions;

/** Options for updateSplit() direct function */
export type UpdateOptions = BaseClientOptions;

/**
 * Options for executeAndConfirmSplit() direct function
 */
export interface ExecuteAndConfirmOptions extends BaseClientOptions {
	/** Compute unit limit (lets runtime determine if not set) */
	computeUnitLimit?: number;
	/** Abort signal for timeout/cancellation support */
	abortSignal?: AbortSignal;
}

// =============================================================================
// Method Parameters
// =============================================================================

/**
 * Parameters for ensureSplit()
 */
export interface EnsureParams {
	/** Recipients with shares (1-100) or percentageBps (1-9900) */
	recipients: Recipient[];
	/** Token mint address (default: USDC) */
	mint?: Address;
	/**
	 * Unique ID for deterministic PDA derivation.
	 *
	 * The split address is derived from: `[authority, mint, uniqueId]`
	 *
	 * **Idempotency**: Same `uniqueId` + same authority + same mint = same split address.
	 * This enables safe retries and "ensure" semantics.
	 *
	 * **Options:**
	 * - Omit → one split per authority/mint (simplest, most common)
	 * - `labelToSeed("revenue")` → deterministic by label (multiple named splits)
	 * - `generateUniqueId()` → random (caller must store the result)
	 *
	 * @example
	 * ```ts
	 * // Default: one split per authority/mint
	 * ensureSplit({ recipients })
	 *
	 * // Multiple named splits
	 * ensureSplit({ recipients, uniqueId: labelToSeed("product-a") })
	 * ensureSplit({ recipients, uniqueId: labelToSeed("product-b") })
	 * ```
	 */
	uniqueId?: Address;
	/** Payer for rent (defaults to signer, useful for sponsored rent) */
	payer?: Address;
	/**
	 * Auto-create missing recipient ATAs (default: true).
	 * Set to false to return blocked status instead.
	 */
	createMissingAtas?: boolean;
}

/**
 * Parameters for update()
 */
export interface UpdateParams {
	/** New recipients with shares (1-100) or percentageBps (1-9900) */
	recipients: Recipient[];
	/**
	 * Auto-create missing recipient ATAs (default: true).
	 *
	 * When vault has balance or unclaimed amounts exist, update will
	 * auto-execute first to clear them. This requires ATAs for current
	 * recipients. Additionally, new recipients may need ATAs.
	 *
	 * Set to false to return blocked status instead of auto-creating.
	 */
	createMissingAtas?: boolean;
}

/**
 * Parameters for close()
 */
export interface CloseParams {
	/**
	 * Auto-create missing recipient ATAs (default: true).
	 *
	 * When vault has balance or unclaimed amounts exist, close will
	 * auto-execute first to clear them. This requires ATAs for current
	 * recipients.
	 *
	 * Set to false to return blocked status instead of auto-creating.
	 */
	createMissingAtas?: boolean;
}

/**
 * Options for execute()
 */
export interface ExecuteOptions {
	/** Compute unit limit (lets runtime determine if not set) */
	computeUnitLimit?: number;
	/** Abort signal for timeout/cancellation support */
	abortSignal?: AbortSignal;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of ensureSplit() - idempotent split creation/update
 */
export type EnsureResult =
	| {
			status: "created";
			vault: Address;
			splitConfig: Address;
			signature: Signature;
			rentPaid: bigint;
			/** ATAs created in this transaction (if any) */
			atasCreated?: Address[];
	  }
	| {
			status: "no_change";
			vault: Address;
			splitConfig: Address;
	  }
	| {
			status: "updated";
			vault: Address;
			splitConfig: Address;
			signature: Signature;
			/** ATAs created in this transaction (if any) */
			atasCreated?: Address[];
	  }
	| {
			status: "blocked";
			reason: BlockedReason;
			message: string;
	  }
	| {
			status: "failed";
			reason: FailedReason;
			message: string;
			error?: Error;
	  };

/**
 * Result of update() - idempotent recipient update
 */
export type UpdateResult =
	| {
			status: "updated";
			signature: Signature;
			/** ATAs created in this transaction (if any) */
			atasCreated?: Address[];
	  }
	| { status: "no_change" }
	| { status: "blocked"; reason: BlockedReason; message: string }
	| { status: "failed"; reason: FailedReason; message: string; error?: Error };

/**
 * Result of close() - idempotent split closure
 */
export type CloseResult =
	| {
			status: "closed";
			signature: Signature;
			rentRecovered: bigint;
			/** ATAs created in this transaction (if any) */
			atasCreated?: Address[];
	  }
	| { status: "already_closed" }
	| { status: "blocked"; reason: BlockedReason; message: string }
	| { status: "failed"; reason: FailedReason; message: string; error?: Error };

/**
 * Result of execute() - split distribution execution
 */
export type ExecuteResult =
	| { status: "executed"; signature: Signature }
	| { status: "skipped"; reason: SkippedReason; message: string }
	| { status: "failed"; reason: FailedReason; message: string; error?: Error };

// =============================================================================
// Reason Types
// =============================================================================

/**
 * Reasons why an operation is blocked (requires user action)
 */
export type BlockedReason =
	| "vault_not_empty"
	| "unclaimed_pending"
	| "not_authority"
	| "recipient_atas_missing";

/**
 * Reasons why execute was skipped (expected conditions)
 */
export type SkippedReason = "not_found" | "not_a_split";

/**
 * Reasons why an operation failed (errors)
 */
export type FailedReason =
	| "wallet_rejected"
	| "wallet_disconnected"
	| "network_error"
	| "transaction_expired"
	| "program_error";
