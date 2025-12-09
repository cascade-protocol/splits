/**
 * Framework-kit hooks for Cascade Splits
 *
 * Query hooks for reading data + client hook for mutations via SDK.
 */

import { useState, useEffect, useMemo } from "react";
import {
	useSolanaClient,
	useWalletSession,
	useProgramAccounts,
} from "@solana/react-hooks";
import {
	type Address,
	type Rpc,
	type SolanaRpcApi,
	type Base58EncodedBytes,
	type Signature,
	type Commitment,
	getBase58Decoder,
	getAddressEncoder,
} from "@solana/kit";

// SDK imports
import {
	PROGRAM_ID,
	percentageBpsToShares,
	getVaultBalance,
	createSplitsClientWithWallet,
	type SplitConfig,
	type SplitRecipient,
	type UnclaimedAmount,
	type SplitsClient,
	type SplitsWallet,
	type TransactionMessage,
} from "@cascade-fyi/splits-sdk";
import {
	SPLIT_CONFIG_DISCRIMINATOR,
	getSplitConfigDecoder,
} from "@cascade-fyi/splits-sdk/generated";

// =============================================================================
// Constants (stable references to prevent infinite re-renders)
// =============================================================================

const EMPTY_SPLITS: SplitConfig[] = [];
const EMPTY_VAULTS: Address[] = [];

// =============================================================================
// Types
// =============================================================================

/** SplitConfig with vault balance and creation timestamp for dashboard display */
export interface SplitWithBalance extends SplitConfig {
	vaultBalance: bigint;
	createdAt: bigint | null;
}

// =============================================================================
// Transaction Confirmation
// =============================================================================

const CONFIRMATION_POLL_INTERVAL_MS = 500;
const MAX_CONFIRMATION_ATTEMPTS = 60; // 30 seconds max

/**
 * Poll for transaction confirmation.
 * Framework-kit's prepareAndSend doesn't wait for confirmation.
 */
async function waitForConfirmation(
	rpc: Rpc<SolanaRpcApi>,
	signature: Signature,
	commitment: Commitment = "confirmed",
): Promise<void> {
	for (let attempt = 0; attempt < MAX_CONFIRMATION_ATTEMPTS; attempt++) {
		const response = await rpc.getSignatureStatuses([signature]).send();

		const status = response.value[0];
		if (status !== null) {
			if (status.err) {
				throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
			}
			// Check if confirmation level is met
			const confirmationStatus = status.confirmationStatus;
			if (
				confirmationStatus === commitment ||
				confirmationStatus === "confirmed"
			) {
				return;
			}
		}

		await new Promise((resolve) =>
			setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS),
		);
	}

	throw new Error("Transaction confirmation timeout");
}

// =============================================================================
// Constants
// =============================================================================

const AUTHORITY_OFFSET = 9;
const base58Decoder = getBase58Decoder();
const addressEncoder = getAddressEncoder();
const splitConfigDecoder = getSplitConfigDecoder();

/**
 * Decode base64 account data to Uint8Array
 */
function decodeBase64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// =============================================================================
// Vault Balance Watching
// =============================================================================

/**
 * Watch multiple vault balances via WebSocket subscriptions.
 * Returns a Map of vault address -> balance that updates in real-time.
 */
export function useVaultBalances(vaults: Address[]) {
	const client = useSolanaClient();
	const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		// Extract rpc inside effect to avoid unstable reference in deps
		const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;

		if (vaults.length === 0) {
			setBalances(new Map());
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		const abortControllers: Array<{ abort: () => void }> = [];

		// Fetch initial balances and set up watchers for each vault
		for (const vault of vaults) {
			const vaultKey = vault.toString();

			// Fetch initial balance using SDK's proven function
			getVaultBalance(rpc, vault)
				.then((balance) => {
					setBalances((prev) => {
						const next = new Map(prev);
						next.set(vaultKey, balance);
						return next;
					});
				})
				.catch(() => {
					// Vault may not exist yet
					setBalances((prev) => {
						const next = new Map(prev);
						next.set(vaultKey, 0n);
						return next;
					});
				});

			// Set up watcher for real-time updates
			const subscription = client.watchers.watchAccount(
				{ address: vault },
				() => {
					// On any account change, re-fetch balance using SDK
					getVaultBalance(rpc, vault)
						.then((balance) => {
							setBalances((prev) => {
								const next = new Map(prev);
								next.set(vaultKey, balance);
								return next;
							});
						})
						.catch(() => {
							// Ignore errors on updates
						});
				},
			);

			abortControllers.push(subscription);
		}

		// Mark loading complete after setup
		setIsLoading(false);

		// Cleanup: abort all subscriptions
		return () => {
			for (const controller of abortControllers) {
				controller.abort();
			}
		};
	}, [client, vaults]);

	return { balances, isLoading };
}

// =============================================================================
// Query Hook
// =============================================================================

export function useSplits() {
	const session = useWalletSession();
	const authority = session?.account.address;

	// Encode filter bytes (memoized to avoid recreating on every render)
	const filterConfig = useMemo(() => {
		if (!authority) return null;

		const discriminatorBase58 = base58Decoder.decode(
			SPLIT_CONFIG_DISCRIMINATOR,
		) as Base58EncodedBytes;
		const authorityBytes = addressEncoder.encode(authority);
		const authorityBase58 = base58Decoder.decode(
			authorityBytes,
		) as Base58EncodedBytes;

		return {
			encoding: "base64" as const,
			filters: [
				{
					memcmp: {
						offset: 0n,
						bytes: discriminatorBase58,
						encoding: "base58" as const,
					},
				},
				{
					memcmp: {
						offset: BigInt(AUTHORITY_OFFSET),
						bytes: authorityBase58,
						encoding: "base58" as const,
					},
				},
			],
		};
	}, [authority]);

	// Use framework-kit's useProgramAccounts for SWR caching
	const query = useProgramAccounts(PROGRAM_ID, {
		config: filterConfig ?? undefined,
		disabled: !authority || !filterConfig,
	});

	// Process accounts synchronously (balances come from useVaultBalances)
	const data = useMemo<SplitConfig[]>(() => {
		if (!query.accounts || query.accounts.length === 0) {
			return EMPTY_SPLITS;
		}

		return query.accounts.map(({ pubkey, account }) => {
			const bytes = decodeBase64ToBytes(account.data[0]);
			const decoded = splitConfigDecoder.decode(bytes);

			const recipients: SplitRecipient[] = decoded.recipients
				.slice(0, decoded.recipientCount)
				.map((r) => ({
					address: r.address,
					percentageBps: r.percentageBps,
					share: percentageBpsToShares(r.percentageBps),
				}));

			const unclaimedAmounts: UnclaimedAmount[] = decoded.unclaimedAmounts
				.filter((u) => u.amount > 0n)
				.map((u) => ({
					recipient: u.recipient,
					amount: u.amount,
					timestamp: u.timestamp,
				}));

			return {
				address: pubkey,
				version: decoded.version,
				authority: decoded.authority,
				mint: decoded.mint,
				vault: decoded.vault,
				uniqueId: decoded.uniqueId,
				bump: decoded.bump,
				recipients,
				unclaimedAmounts,
				protocolUnclaimed: decoded.protocolUnclaimed,
				lastActivity: decoded.lastActivity,
				rentPayer: decoded.rentPayer,
			};
		});
	}, [query.accounts]);

	return {
		data,
		error: query.error,
		isLoading: query.isLoading,
		refetch: query.refresh,
	};
}

/**
 * Combines useSplits with useVaultBalances for real-time balance updates.
 * Drop-in replacement for useSplits that includes live vault balances and creation timestamps.
 */
export function useSplitsWithBalances() {
	const client = useSolanaClient();

	const {
		data: splits,
		error,
		isLoading: splitsLoading,
		refetch,
	} = useSplits();

	// Extract vault addresses for balance watching (stable reference when empty)
	const vaults = useMemo(
		() => (splits.length === 0 ? EMPTY_VAULTS : splits.map((s) => s.vault)),
		[splits],
	);

	const { balances, isLoading: balancesLoading } = useVaultBalances(vaults);

	// Cache creation timestamps by split address (timestamps never change)
	const [timestamps, setTimestamps] = useState<Map<string, bigint | null>>(
		new Map(),
	);

	// Stable key - only changes when split addresses change
	const splitAddressesKey = useMemo(
		() => splits.map((s) => s.address as string).join(","),
		[splits],
	);

	// Fetch timestamps only for NEW splits not already in cache
	useEffect(() => {
		// Parse addresses from the stable key (no need for splits array)
		const addresses = splitAddressesKey.split(",").filter(Boolean);
		if (addresses.length === 0) return;

		// Extract rpc inside effect to avoid unstable reference in deps
		const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;

		// Use functional update to check cache without timestamps in deps
		setTimestamps((prev) => {
			const newAddresses = addresses.filter((addr) => !prev.has(addr));
			if (newAddresses.length === 0) return prev; // No change needed

			// Fetch timestamps for new addresses asynchronously
			Promise.all(
				newAddresses.map(async (addr) => {
					try {
						const sigs = await rpc
							.getSignaturesForAddress(addr as Address, { limit: 1 })
							.send();
						if (sigs.length === 0) return [addr, null] as const;
						const oldest = sigs[sigs.length - 1];
						return [
							addr,
							oldest.blockTime !== null ? BigInt(oldest.blockTime) : null,
						] as const;
					} catch {
						return [addr, null] as const;
					}
				}),
			).then((entries) => {
				setTimestamps((current) => new Map([...current, ...entries]));
			});

			// Return prev unchanged - updates come from Promise.then
			return prev;
		});
	}, [client, splitAddressesKey]);

	// Combine splits with balances and timestamps
	const data = useMemo<SplitWithBalance[]>(
		() =>
			splits.map((split) => ({
				...split,
				vaultBalance: balances.get(split.vault.toString()) ?? 0n,
				createdAt: timestamps.get(split.address as string) ?? null,
			})),
		[splits, balances, timestamps],
	);

	return {
		data,
		error,
		isLoading: splitsLoading || balancesLoading,
		refetch,
	};
}

// =============================================================================
// Client Hook
// =============================================================================

/**
 * Create a SplitsClient for mutations.
 *
 * @returns SplitsClient or null if wallet is not connected
 *
 * @example
 * ```typescript
 * const splits = useSplitsClient();
 *
 * const handleCreate = async () => {
 *   if (!splits) return;
 *   const result = await splits.ensureSplit({
 *     recipients: [{ address: alice, share: 70 }, { address: bob, share: 29 }],
 *   });
 *   if (result.status === 'created') {
 *     console.log('Created!', result.vault);
 *   }
 * };
 * ```
 */
export function useSplitsClient(): SplitsClient | null {
	const client = useSolanaClient();
	const session = useWalletSession();

	return useMemo(() => {
		if (!session) return null;

		const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;

		// Bridge framework-kit session to SDK's SplitsWallet interface
		const wallet: SplitsWallet = {
			address: session.account.address,

			signAndSend: async (
				message: TransactionMessage,
				options,
			): Promise<Signature> => {
				const commitment = options?.commitment ?? "confirmed";

				// Use framework-kit's transaction helper (sends but doesn't confirm)
				const signature = await client.helpers.transaction.prepareAndSend({
					authority: session,
					instructions: [...message.instructions],
					lifetime: message.lifetimeConstraint,
					commitment,
				});

				// Wait for confirmation before returning
				await waitForConfirmation(rpc, signature, commitment);

				return signature;
			},
		};

		return createSplitsClientWithWallet(rpc, wallet);
	}, [client, session]);
}
