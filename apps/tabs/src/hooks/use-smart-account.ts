/**
 * Smart Account hook for Cascade Tabs.
 *
 * Single hook that manages all smart account state and actions.
 * Uses TanStack Query for data fetching and caching.
 */

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWalletConnection } from "@solana/react-hooks";
import { toast } from "sonner";
import {
	type SmartAccountState,
	fetchSmartAccountState,
	encodeApiKey,
	buildCreateAccountTx,
	buildDepositTx,
	buildWithdrawTx,
	buildSetSpendingLimitTx,
	buildRevokeSpendingLimitTx,
} from "@/lib/squads";

const QUERY_KEY = ["smart-account"];

export interface UseSmartAccountReturn {
	/** Smart account state, null if no account exists */
	account: SmartAccountState | null;
	/** Generated API key, null if no spending limit set */
	apiKey: string | null;
	/** Whether the account data is loading */
	isLoading: boolean;
	/** Error if fetching failed */
	error: Error | null;
	/** Whether any mutation is in progress */
	isPending: boolean;

	// Actions
	/** Create a new smart account */
	createAccount: () => Promise<void>;
	/** Deposit USDC into the vault */
	deposit: (amount: bigint) => Promise<void>;
	/** Withdraw USDC from the vault */
	withdraw: (amount: bigint) => Promise<void>;
	/** Set or update spending limit */
	setSpendingLimit: (dailyLimit: bigint, perTxLimit: bigint) => Promise<void>;
	/** Revoke the current spending limit */
	revokeSpendingLimit: () => Promise<void>;
	/** Refresh account data */
	refresh: () => Promise<void>;
}

export function useSmartAccount(): UseSmartAccountReturn {
	const queryClient = useQueryClient();
	const { wallet, connected } = useWalletConnection();
	const ownerAddress = wallet?.account.address ?? null;

	// Fetch account state
	const {
		data: account,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: [...QUERY_KEY, ownerAddress],
		queryFn: () => {
			if (!ownerAddress) return null;
			return fetchSmartAccountState(ownerAddress);
		},
		enabled: connected && !!ownerAddress,
		staleTime: 30_000, // 30 seconds
		refetchInterval: 60_000, // 1 minute
	});

	// Derive API key from spending limit
	const apiKey = useMemo(() => {
		if (!account?.spendingLimit || !account.address) {
			return null;
		}
		return encodeApiKey({
			settingsPda: account.address,
			spendingLimitPda: account.spendingLimit.pda,
			perTxMax: account.spendingLimit.perTxLimit,
		});
	}, [account]);

	// Invalidate and refetch after mutations
	const invalidate = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: QUERY_KEY });
	}, [queryClient]);

	// Create account mutation
	const createAccountMutation = useMutation({
		mutationFn: async () => {
			if (!ownerAddress) throw new Error("Wallet not connected");
			const { tx, accountAddress } = await buildCreateAccountTx(ownerAddress);
			// TODO Phase 4: Sign and send transaction
			console.log("Would create account:", accountAddress, tx);
			throw new Error("Not implemented - Phase 4");
		},
		onSuccess: () => {
			toast.success("Smart Account created!");
			invalidate();
		},
		onError: (err) => {
			toast.error(`Failed to create account: ${err.message}`);
		},
	});

	// Deposit mutation
	const depositMutation = useMutation({
		mutationFn: async (amount: bigint) => {
			if (!ownerAddress || !account?.vaultAddress) {
				throw new Error("Wallet not connected or no account");
			}
			const tx = await buildDepositTx(
				ownerAddress,
				account.vaultAddress,
				amount,
			);
			// TODO Phase 4: Sign and send transaction
			console.log("Would deposit:", amount, tx);
			throw new Error("Not implemented - Phase 4");
		},
		onSuccess: () => {
			toast.success("Deposit successful!");
			invalidate();
		},
		onError: (err) => {
			toast.error(`Deposit failed: ${err.message}`);
		},
	});

	// Withdraw mutation
	const withdrawMutation = useMutation({
		mutationFn: async (amount: bigint) => {
			if (!ownerAddress || !account?.vaultAddress) {
				throw new Error("Wallet not connected or no account");
			}
			const tx = await buildWithdrawTx(
				ownerAddress,
				account.vaultAddress,
				amount,
			);
			// TODO Phase 4: Sign and send transaction
			console.log("Would withdraw:", amount, tx);
			throw new Error("Not implemented - Phase 4");
		},
		onSuccess: () => {
			toast.success("Withdrawal successful!");
			invalidate();
		},
		onError: (err) => {
			toast.error(`Withdrawal failed: ${err.message}`);
		},
	});

	// Set spending limit mutation
	const setSpendingLimitMutation = useMutation({
		mutationFn: async ({
			dailyLimit,
			perTxLimit,
		}: {
			dailyLimit: bigint;
			perTxLimit: bigint;
		}) => {
			if (!account?.address) {
				throw new Error("No smart account");
			}
			const tx = await buildSetSpendingLimitTx(
				account.address,
				dailyLimit,
				perTxLimit,
			);
			// TODO Phase 4: Sign and send transaction
			console.log("Would set spending limit:", { dailyLimit, perTxLimit }, tx);
			throw new Error("Not implemented - Phase 4");
		},
		onSuccess: () => {
			toast.success("Spending limit updated!");
			invalidate();
		},
		onError: (err) => {
			toast.error(`Failed to update spending limit: ${err.message}`);
		},
	});

	// Revoke spending limit mutation
	const revokeSpendingLimitMutation = useMutation({
		mutationFn: async () => {
			if (!account?.address || !account.spendingLimit?.pda) {
				throw new Error("No spending limit to revoke");
			}
			const tx = await buildRevokeSpendingLimitTx(
				account.address,
				account.spendingLimit.pda,
			);
			// TODO Phase 4: Sign and send transaction
			console.log("Would revoke spending limit:", tx);
			throw new Error("Not implemented - Phase 4");
		},
		onSuccess: () => {
			toast.success("Spending limit revoked!");
			invalidate();
		},
		onError: (err) => {
			toast.error(`Failed to revoke spending limit: ${err.message}`);
		},
	});

	// Check if any mutation is pending
	const isPending =
		createAccountMutation.isPending ||
		depositMutation.isPending ||
		withdrawMutation.isPending ||
		setSpendingLimitMutation.isPending ||
		revokeSpendingLimitMutation.isPending;

	return {
		account: account ?? null,
		apiKey,
		isLoading,
		error: error as Error | null,
		isPending,

		createAccount: useCallback(
			() => createAccountMutation.mutateAsync(),
			[createAccountMutation],
		),
		deposit: useCallback(
			(amount: bigint) => depositMutation.mutateAsync(amount),
			[depositMutation],
		),
		withdraw: useCallback(
			(amount: bigint) => withdrawMutation.mutateAsync(amount),
			[withdrawMutation],
		),
		setSpendingLimit: useCallback(
			(dailyLimit: bigint, perTxLimit: bigint) =>
				setSpendingLimitMutation.mutateAsync({ dailyLimit, perTxLimit }),
			[setSpendingLimitMutation],
		),
		revokeSpendingLimit: useCallback(
			() => revokeSpendingLimitMutation.mutateAsync(),
			[revokeSpendingLimitMutation],
		),
		refresh: useCallback(async () => {
			await refetch();
		}, [refetch]),
	};
}
