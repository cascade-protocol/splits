/**
 * Mock data for Cascade Splits dashboard
 * Delete this file when switching to real on-chain data
 */

import type { SplitConfig } from "@cascade-fyi/splits-sdk";

// USDC Mainnet address
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Timestamp helpers
const now = Math.floor(Date.now() / 1000);
const oneDayAgo = now - 24 * 60 * 60;
const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

/**
 * Mock split configurations covering edge cases:
 * 1. Single recipient, clean, recent
 * 2. 20 recipients, clean, recent
 * 3. 5 recipients (uneven), with unclaimed, recent
 * 4. 3 recipients (even), clean, old
 * 5. 8 recipients (mixed), with unclaimed, old
 * 6. 2 recipients, with unclaimed, recent
 */
export const mockSplits: SplitConfig[] = [
	// 1. Single recipient, clean, recent
	{
		version: 1,
		authority: "MockAuthority1111111111111111111111111",
		mint: USDC_MINT,
		vault: "MockVault11111111111111111111111111111111",
		uniqueId: "MockId111111111111111111111111111111111",
		bump: 255,
		recipientCount: 1,
		recipients: [
			{
				address: "MockRecipient11111111111111111111111111",
				share: 100,
			},
		],
		unclaimedAmounts: [],
		protocolUnclaimed: 0n,
		lastActivity: BigInt(now),
		rentPayer: "MockAuthority1111111111111111111111111",
	},

	// 2. 20 recipients (5% each), clean, recent
	{
		version: 1,
		authority: "MockAuthority2222222222222222222222222",
		mint: USDC_MINT,
		vault: "MockVault22222222222222222222222222222222",
		uniqueId: "MockId222222222222222222222222222222222",
		bump: 254,
		recipientCount: 20,
		recipients: Array.from({ length: 20 }, (_, i) => ({
			address: `MockRecipient${String(i + 1).padStart(2, "0")}11111111111111111`,
			share: 5,
		})),
		unclaimedAmounts: [],
		protocolUnclaimed: 0n,
		lastActivity: BigInt(now),
		rentPayer: "MockAuthority2222222222222222222222222",
	},

	// 3. 5 recipients (uneven: 40/30/15/10/5), with unclaimed, recent
	{
		version: 1,
		authority: "MockAuthority3333333333333333333333333",
		mint: USDC_MINT,
		vault: "MockVault33333333333333333333333333333333",
		uniqueId: "MockId333333333333333333333333333333333",
		bump: 253,
		recipientCount: 5,
		recipients: [
			{
				address: "MockRecipientA1111111111111111111111111",
				share: 40,
			},
			{
				address: "MockRecipientB1111111111111111111111111",
				share: 30,
			},
			{
				address: "MockRecipientC1111111111111111111111111",
				share: 15,
			},
			{
				address: "MockRecipientD1111111111111111111111111",
				share: 10,
			},
			{
				address: "MockRecipientE1111111111111111111111111",
				share: 5,
			},
		],
		unclaimedAmounts: [
			{
				recipient: "MockRecipientC1111111111111111111111111",
				amount: 150000000n, // 150 USDC (6 decimals)
				timestamp: BigInt(oneDayAgo),
			},
			{
				recipient: "MockRecipientE1111111111111111111111111",
				amount: 50000000n, // 50 USDC
				timestamp: BigInt(oneDayAgo),
			},
		],
		protocolUnclaimed: 0n,
		lastActivity: BigInt(oneDayAgo),
		rentPayer: "MockAuthority3333333333333333333333333",
	},

	// 4. 3 recipients (even: 33/33/34), clean, old
	{
		version: 1,
		authority: "MockAuthority4444444444444444444444444",
		mint: USDC_MINT,
		vault: "MockVault44444444444444444444444444444444",
		uniqueId: "MockId444444444444444444444444444444444",
		bump: 252,
		recipientCount: 3,
		recipients: [
			{
				address: "MockRecipientX1111111111111111111111111",
				share: 33,
			},
			{
				address: "MockRecipientY1111111111111111111111111",
				share: 33,
			},
			{
				address: "MockRecipientZ1111111111111111111111111",
				share: 34,
			},
		],
		unclaimedAmounts: [],
		protocolUnclaimed: 0n,
		lastActivity: BigInt(thirtyDaysAgo),
		rentPayer: "MockAuthority4444444444444444444444444",
	},

	// 5. 8 recipients (mixed: 25/20/15/12/10/8/6/4), with unclaimed, old
	{
		version: 1,
		authority: "MockAuthority5555555555555555555555555",
		mint: USDC_MINT,
		vault: "MockVault55555555555555555555555555555555",
		uniqueId: "MockId555555555555555555555555555555555",
		bump: 251,
		recipientCount: 8,
		recipients: [
			{
				address: "MockRecipient1A111111111111111111111111",
				share: 25,
			},
			{
				address: "MockRecipient2A111111111111111111111111",
				share: 20,
			},
			{
				address: "MockRecipient3A111111111111111111111111",
				share: 15,
			},
			{
				address: "MockRecipient4A111111111111111111111111",
				share: 12,
			},
			{
				address: "MockRecipient5A111111111111111111111111",
				share: 10,
			},
			{
				address: "MockRecipient6A111111111111111111111111",
				share: 8,
			},
			{
				address: "MockRecipient7A111111111111111111111111",
				share: 6,
			},
			{
				address: "MockRecipient8A111111111111111111111111",
				share: 4,
			},
		],
		unclaimedAmounts: [
			{
				recipient: "MockRecipient1A111111111111111111111111",
				amount: 500000000n, // 500 USDC
				timestamp: BigInt(thirtyDaysAgo),
			},
			{
				recipient: "MockRecipient4A111111111111111111111111",
				amount: 240000000n, // 240 USDC
				timestamp: BigInt(thirtyDaysAgo),
			},
			{
				recipient: "MockRecipient8A111111111111111111111111",
				amount: 80000000n, // 80 USDC
				timestamp: BigInt(thirtyDaysAgo),
			},
		],
		protocolUnclaimed: 8000000n, // 8 USDC stuck protocol fee
		lastActivity: BigInt(thirtyDaysAgo),
		rentPayer: "MockAuthority5555555555555555555555555",
	},

	// 6. 2 recipients (60/40), with unclaimed, recent
	{
		version: 1,
		authority: "MockAuthority6666666666666666666666666",
		mint: USDC_MINT,
		vault: "MockVault66666666666666666666666666666666",
		uniqueId: "MockId666666666666666666666666666666666",
		bump: 250,
		recipientCount: 2,
		recipients: [
			{
				address: "MockRecipientAlpha111111111111111111111",
				share: 60,
			},
			{
				address: "MockRecipientBeta1111111111111111111111",
				share: 40,
			},
		],
		unclaimedAmounts: [
			{
				recipient: "MockRecipientBeta1111111111111111111111",
				amount: 400000000n, // 400 USDC
				timestamp: BigInt(oneDayAgo),
			},
		],
		protocolUnclaimed: 0n,
		lastActivity: BigInt(oneDayAgo),
		rentPayer: "MockAuthority6666666666666666666666666",
	},
];

/**
 * Helper: Check if a split has any unclaimed amounts
 */
export function hasUnclaimedAmounts(split: SplitConfig): boolean {
	return split.unclaimedAmounts.length > 0 || split.protocolUnclaimed > 0n;
}

/**
 * Helper: Get total unclaimed amount in base units
 */
export function getTotalUnclaimed(split: SplitConfig): bigint {
	const recipientUnclaimed = split.unclaimedAmounts.reduce(
		(sum, item) => sum + item.amount,
		0n,
	);
	return recipientUnclaimed + split.protocolUnclaimed;
}

/**
 * Helper: Format timestamp to relative time string
 */
export function formatRelativeTime(timestamp: bigint): string {
	const now = Math.floor(Date.now() / 1000);
	const secondsAgo = now - Number(timestamp);

	if (secondsAgo < 60) return "just now";
	if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
	if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
	if (secondsAgo < 2592000) return `${Math.floor(secondsAgo / 86400)}d ago`;
	return `${Math.floor(secondsAgo / 2592000)}mo ago`;
}
