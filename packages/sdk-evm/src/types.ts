import type { Address, Hash } from "viem";

/**
 * Recipient structure as stored on-chain.
 */
export interface EvmRecipient {
	addr: Address;
	percentageBps: number;
}

/**
 * Split configuration as returned from the contract.
 */
export interface EvmSplitConfig {
	/** The split contract address (EIP-1167 clone) */
	address: Address;
	/** The factory that created this split */
	factory: Address;
	/** The authority (owner) of this split */
	authority: Address;
	/** The ERC20 token being split */
	token: Address;
	/** Unique identifier used for deterministic addressing */
	uniqueId: Hash;
	/** Recipients with their percentage allocations */
	recipients: EvmRecipient[];
}

/**
 * Preview of what will happen when executeSplit is called.
 */
export interface EvmExecutionPreview {
	/** Amounts each recipient will receive from new funds */
	recipientAmounts: bigint[];
	/** Protocol fee from new funds */
	protocolFee: bigint;
	/** Total new funds available for distribution */
	available: bigint;
	/** Unclaimed amounts per recipient that will be retried */
	pendingRecipientAmounts: bigint[];
	/** Unclaimed protocol fee that will be retried */
	pendingProtocolAmount: bigint;
}

// ============================================================================
// Result Types (Discriminated Unions)
// ============================================================================

export type EvmEnsureStatus = "CREATED" | "NO_CHANGE" | "FAILED";
export type EvmExecuteStatus = "EXECUTED" | "SKIPPED" | "FAILED";

export type EvmFailedReason =
	| "wallet_rejected"
	| "wallet_disconnected"
	| "network_error"
	| "transaction_failed"
	| "transaction_reverted"
	| "insufficient_gas";

export type EvmSkippedReason =
	| "not_found"
	| "not_a_split"
	| "below_threshold"
	| "no_pending_funds";

/**
 * Result of ensureSplit operation.
 */
export type EvmEnsureResult =
	| {
			status: "CREATED";
			split: Address;
			signature: Hash;
	  }
	| {
			status: "NO_CHANGE";
			split: Address;
	  }
	| {
			status: "FAILED";
			reason: EvmFailedReason;
			message: string;
			error?: Error | undefined;
	  };

/**
 * Result of executeSplit operation.
 */
export type EvmExecuteResult =
	| {
			status: "EXECUTED";
			signature: Hash;
	  }
	| {
			status: "SKIPPED";
			reason: EvmSkippedReason;
	  }
	| {
			status: "FAILED";
			reason: EvmFailedReason;
			message: string;
			error?: Error | undefined;
	  };

// ============================================================================
// Input Types
// ============================================================================

/**
 * Parameters for creating a split.
 */
export interface EvmEnsureParams {
	/** Authority (owner) of the split. Defaults to wallet address. */
	authority?: Address | undefined;
	/** ERC20 token to split. Defaults to USDC on the connected chain. */
	token?: Address | undefined;
	/** Unique identifier for deterministic addressing. */
	uniqueId: Hash;
	/** Recipients with shares or basis points. */
	recipients: EvmRecipientInput[];
}

/**
 * Recipient input - accepts either share (1-100) or percentageBps (1-9900).
 */
export interface EvmRecipientInput {
	/** Recipient address */
	address: Address;
	/** Share (1-100, will be converted to bps) */
	share?: number;
	/** Basis points (1-9900, advanced usage) */
	percentageBps?: number;
}

/**
 * Options for execute operation.
 */
export interface EvmExecuteOptions {
	/** Minimum balance required to execute (skip if below) */
	minBalance?: bigint;
}
