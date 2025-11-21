/**
 * Internal types for Cascade Splits SDK
 * User-facing types are exported from schemas.ts
 */

/**
 * On-chain recipient data (internal representation)
 */
export interface Recipient {
	address: string;
	percentageBps: number;
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
 * Split configuration account (deserialized)
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
