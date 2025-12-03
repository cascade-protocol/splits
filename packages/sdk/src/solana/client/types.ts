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
import type { Recipient } from "../../index.js";

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
 * Adapters convert specific wallet types to this interface:
 * - `fromKeypair(keypair, connection)` - for Node.js with Keypair (in web3-compat)
 * - `fromWalletAdapter(wallet, connection)` - for browser wallets (in web3-compat)
 * - `fromKitSigner(signer, rpc, rpcSubscriptions)` - for kit-native signing
 *
 * @example
 * ```typescript
 * // Kit-native (no web3.js bundled)
 * import { createSplitsClient, fromKitSigner } from '@cascade-fyi/splits-sdk/solana/client';
 * const splits = createSplitsClient(rpc, fromKitSigner(signer, rpc, rpcSubs));
 *
 * // Web3.js (wallet-adapter users)
 * import { createSplitsClient } from '@cascade-fyi/splits-sdk/solana/client';
 * import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/solana/web3-compat';
 * const splits = createSplitsClient(rpc, fromWalletAdapter(wallet, connection));
 * ```
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
 * Options for ensureSplitConfig() direct function
 */
export interface EnsureOptions {
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: Commitment;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
}

/**
 * Options for closeSplit() direct function
 */
export interface CloseOptions {
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: Commitment;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
}

/**
 * Options for updateSplit() direct function
 */
export interface UpdateOptions {
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: Commitment;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
}

/**
 * Options for executeAndConfirmSplit() direct function
 */
export interface ExecuteAndConfirmOptions {
	/** Only execute if vault balance >= this amount (in token base units) */
	minBalance?: bigint;
	/** Commitment level for confirmation (default: 'confirmed') */
	commitment?: Commitment;
	/** Priority fee in microlamports per compute unit */
	computeUnitPrice?: bigint;
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
	 * Seed for split derivation. Can be:
	 * - Human-readable label (max 27 chars): "my-split"
	 * - Raw Address: for multiple splits per authority/mint
	 * - Omitted: one split per authority/mint pair
	 */
	seed?: string | Address;
	/** Payer for rent (defaults to signer, useful for sponsored rent) */
	payer?: Address;
}

/**
 * Parameters for update()
 */
export interface UpdateParams {
	/** New recipients with shares (1-100) or percentageBps (1-9900) */
	recipients: Recipient[];
}

/**
 * Options for execute()
 */
export interface ExecuteOptions {
	/** Only execute if vault balance >= this amount (in token base units) */
	minBalance?: bigint;
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
			status: "CREATED";
			vault: Address;
			splitConfig: Address;
			signature: string;
			rentPaid: bigint;
	  }
	| {
			status: "NO_CHANGE";
			vault: Address;
			splitConfig: Address;
	  }
	| {
			status: "UPDATED";
			vault: Address;
			splitConfig: Address;
			signature: string;
	  }
	| {
			status: "BLOCKED";
			reason: BlockedReason;
			message: string;
	  }
	| {
			status: "FAILED";
			reason: FailedReason;
			message: string;
			error?: Error;
	  };

/**
 * Result of update() - idempotent recipient update
 */
export type UpdateResult =
	| { status: "UPDATED"; signature: string }
	| { status: "NO_CHANGE" }
	| { status: "BLOCKED"; reason: BlockedReason; message: string }
	| { status: "FAILED"; reason: FailedReason; message: string; error?: Error };

/**
 * Result of close() - idempotent split closure
 */
export type CloseResult =
	| { status: "CLOSED"; signature: string; rentRecovered: bigint }
	| { status: "ALREADY_CLOSED" }
	| { status: "BLOCKED"; reason: BlockedReason; message: string }
	| { status: "FAILED"; reason: FailedReason; message: string; error?: Error };

/**
 * Result of execute() - split distribution execution
 */
export type ExecuteResult =
	| { status: "EXECUTED"; signature: string }
	| { status: "SKIPPED"; reason: SkippedReason }
	| { status: "FAILED"; reason: FailedReason; message: string; error?: Error };

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
export type SkippedReason = "not_found" | "not_a_split" | "below_threshold";

/**
 * Reasons why an operation failed (errors)
 */
export type FailedReason =
	| "wallet_rejected"
	| "wallet_disconnected"
	| "network_error"
	| "transaction_expired"
	| "program_error";
