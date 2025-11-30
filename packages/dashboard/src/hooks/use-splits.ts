/**
 * Framework-kit hooks for Cascade Splits
 *
 * Uses SDK instruction builders + @solana/react-hooks for wallet/transaction management
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
	useSolanaClient,
	useWalletSession,
	useTransactionPool,
	useProgramAccounts,
} from "@solana/react-hooks";
import {
	type Address,
	type Rpc,
	type SolanaRpcApi,
	type Base58EncodedBytes,
	type Signature,
	getBase58Decoder,
	getAddressEncoder,
} from "@solana/kit";

// SDK imports
import {
	createSplitConfig,
	executeSplit,
	updateSplitConfig,
	closeSplitConfig,
	getVaultBalance,
	type SplitConfig,
	type SplitRecipient,
	type UnclaimedAmount,
} from "@cascade-fyi/splits-sdk/solana";
import {
	SPLIT_CONFIG_DISCRIMINATOR,
	getSplitConfigDecoder,
} from "@cascade-fyi/splits-sdk/solana/generated";
import {
	PROGRAM_ID,
	bpsToShares,
	type Recipient,
} from "@cascade-fyi/splits-sdk";

// =============================================================================
// Types
// =============================================================================

/** SplitConfig with vault balance for dashboard display */
export interface SplitWithBalance extends SplitConfig {
	vaultBalance: bigint;
}

// =============================================================================
// Constants
// =============================================================================

const AUTHORITY_OFFSET = 9;
const base58Decoder = getBase58Decoder();
const addressEncoder = getAddressEncoder();
const splitConfigDecoder = getSplitConfigDecoder();

// Confirmation polling settings
const CONFIRMATION_POLL_INTERVAL_MS = 1000;
const CONFIRMATION_MAX_RETRIES = 60; // 60 seconds max

type ConfirmationCommitment = "processed" | "confirmed" | "finalized";

/**
 * Wait for transaction confirmation by polling getSignatureStatuses.
 * Mirrors framework-kit's useWaitForSignature behavior.
 */
async function waitForConfirmation(
	rpc: Rpc<SolanaRpcApi>,
	signature: Signature,
	commitment: ConfirmationCommitment = "confirmed",
): Promise<void> {
	const commitmentPriority: Record<ConfirmationCommitment, number> = {
		processed: 0,
		confirmed: 1,
		finalized: 2,
	};
	const targetPriority = commitmentPriority[commitment];

	for (let i = 0; i < CONFIRMATION_MAX_RETRIES; i++) {
		const result = await rpc.getSignatureStatuses([signature]).send();
		const status = result.value[0];

		if (status?.confirmationStatus) {
			const statusPriority =
				commitmentPriority[
					status.confirmationStatus as ConfirmationCommitment
				] ?? -1;
			if (statusPriority >= targetPriority) {
				return;
			}
		}

		await new Promise((r) => setTimeout(r, CONFIRMATION_POLL_INTERVAL_MS));
	}

	throw new Error("Transaction confirmation timeout");
}

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
	const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;
	const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
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
	}, [client, rpc, vaults]);

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
			return [];
		}

		return query.accounts.map(({ pubkey, account }) => {
			const bytes = decodeBase64ToBytes(account.data[0]);
			const decoded = splitConfigDecoder.decode(bytes);

			const recipients: SplitRecipient[] = decoded.recipients
				.slice(0, decoded.recipientCount)
				.map((r) => ({
					address: r.address,
					percentageBps: r.percentageBps,
					share: bpsToShares(r.percentageBps),
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
 * Drop-in replacement for useSplits that includes live vault balances.
 */
export function useSplitsWithBalances() {
	const {
		data: splits,
		error,
		isLoading: splitsLoading,
		refetch,
	} = useSplits();

	// Extract vault addresses for balance watching
	const vaults = useMemo(() => splits.map((s) => s.vault), [splits]);

	const { balances, isLoading: balancesLoading } = useVaultBalances(vaults);

	// Combine splits with their watched balances
	const data = useMemo<SplitWithBalance[]>(
		() =>
			splits.map((split) => ({
				...split,
				vaultBalance: balances.get(split.vault.toString()) ?? 0n,
			})),
		[splits, balances],
	);

	return {
		data,
		error,
		isLoading: splitsLoading || balancesLoading,
		refetch,
	};
}

// =============================================================================
// Mutation Hooks
// =============================================================================

export function useCreateSplit() {
	const client = useSolanaClient();
	const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;
	const session = useWalletSession();
	const { addInstruction, prepareAndSend, isSending, clearInstructions } =
		useTransactionPool();

	const mutate = useCallback(
		async (recipients: Recipient[], mint: Address) => {
			if (!session) throw new Error("Wallet not connected");

			const { instruction, vault } = await createSplitConfig({
				authority: session.account.address,
				recipients,
				mint,
			});

			clearInstructions();
			addInstruction(instruction);
			const sig = await prepareAndSend({ authority: session });

			// Wait for confirmation before returning
			await waitForConfirmation(rpc, sig);

			return { signature: sig, vault };
		},
		[rpc, session, addInstruction, prepareAndSend, clearInstructions],
	);

	return { mutate, isPending: isSending };
}

export function useExecuteSplit() {
	const client = useSolanaClient();
	const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;
	const session = useWalletSession();
	const { addInstruction, prepareAndSend, isSending, clearInstructions } =
		useTransactionPool();

	const mutate = useCallback(
		async (split: SplitWithBalance) => {
			if (!session) throw new Error("Wallet not connected");

			const result = await executeSplit(
				rpc,
				split.vault,
				session.account.address,
			);
			if (!result.ok) throw new Error(result.reason);

			clearInstructions();
			addInstruction(result.instruction);
			const sig = await prepareAndSend({ authority: session });

			// Wait for confirmation before returning
			await waitForConfirmation(rpc, sig);

			return { signature: sig };
		},
		[rpc, session, addInstruction, prepareAndSend, clearInstructions],
	);

	return { mutate, isPending: isSending };
}

export function useUpdateSplit() {
	const client = useSolanaClient();
	const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;
	const session = useWalletSession();
	const { addInstruction, prepareAndSend, isSending, clearInstructions } =
		useTransactionPool();

	const mutate = useCallback(
		async (split: SplitWithBalance, recipients: Recipient[]) => {
			if (!session) throw new Error("Wallet not connected");

			const instruction = await updateSplitConfig(rpc, {
				vault: split.vault,
				authority: session.account.address,
				recipients,
			});

			clearInstructions();
			addInstruction(instruction);
			const sig = await prepareAndSend({ authority: session });

			// Wait for confirmation before returning
			await waitForConfirmation(rpc, sig);

			return { signature: sig };
		},
		[rpc, session, addInstruction, prepareAndSend, clearInstructions],
	);

	return { mutate, isPending: isSending };
}

export function useCloseSplit() {
	const client = useSolanaClient();
	const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;
	const session = useWalletSession();
	const { addInstruction, prepareAndSend, isSending, clearInstructions } =
		useTransactionPool();

	const mutate = useCallback(
		async (split: SplitWithBalance) => {
			if (!session) throw new Error("Wallet not connected");

			const instruction = await closeSplitConfig(rpc, {
				vault: split.vault,
				authority: session.account.address,
			});

			clearInstructions();
			addInstruction(instruction);
			const sig = await prepareAndSend({ authority: session });

			// Wait for confirmation before returning
			await waitForConfirmation(rpc, sig);

			return { signature: sig };
		},
		[rpc, session, addInstruction, prepareAndSend, clearInstructions],
	);

	return { mutate, isPending: isSending };
}
