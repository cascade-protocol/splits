/**
 * Internal types for Cascade Splits SDK
 * User-facing types are exported from schemas.ts
 */

/**
 * Raw on-chain recipient data (internal, used by deserialization)
 */
export interface RawRecipient {
	address: string;
	percentageBps: number;
}

/**
 * User-facing recipient with share (1-100)
 */
export interface Recipient {
	address: string;
	share: number;
}

/**
 * Unclaimed amount for a recipient
 */
export interface UnclaimedAmount {
	recipient: string;
	amount: bigint;
	timestamp: bigint;
}

/**
 * Protocol configuration account (deserialized)
 */
export interface ProtocolConfig {
	authority: string;
	pendingAuthority: string;
	feeWallet: string;
	bump: number;
}

/**
 * Raw split configuration (internal, from deserialization)
 */
export interface RawSplitConfig {
	version: number;
	authority: string;
	mint: string;
	vault: string;
	uniqueId: string;
	bump: number;
	recipientCount: number;
	recipients: RawRecipient[];
	unclaimedAmounts: UnclaimedAmount[];
	protocolUnclaimed: bigint;
	lastActivity: bigint;
	rentPayer: string;
}

/**
 * User-facing split configuration with shares (1-100)
 */
export interface SplitConfig {
	version: number;
	authority: string;
	mint: string;
	vault: string;
	uniqueId: string;
	bump: number;
	recipientCount: number;
	recipients: Recipient[];
	unclaimedAmounts: UnclaimedAmount[];
	protocolUnclaimed: bigint;
	lastActivity: bigint;
	rentPayer: string;
}

/**
 * Distribution preview result
 */
export interface DistributionPreview {
	vault: string;
	currentBalance: bigint;
	distributions: Array<{
		address: string;
		amount: bigint;
		share: number;
	}>;
	protocolFee: bigint;
	ready: boolean;
}

/**
 * Split configuration with vault balance (for list queries)
 */
export interface SplitWithBalance extends SplitConfig {
	vaultBalance: bigint;
}
