/**
 * Mutation hooks for split operations.
 * Require @tanstack/react-query and @solana/wallet-adapter-react as peer dependencies.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { useSplitsContext } from "../context.js";
import { splitsQueryKeys } from "../query-keys.js";
import type { CreateSplitInput, UpdateSplitInput } from "../../web3/index.js";
import {
	WalletNotConnectedError,
	TransactionFailedError,
	parseProgramError,
} from "../../errors.js";

/**
 * Configuration options for mutation hooks.
 * Pass these to customize transaction parameters for different networks.
 *
 * @example
 * ```tsx
 * // Mainnet config with priority fees
 * const config: MutationConfig = {
 *   priorityFee: 50_000,  // 50k microlamports
 *   computeUnits: 200_000
 * };
 *
 * const { mutate } = useCreateSplit(config);
 * ```
 */
export interface MutationConfig {
	/** Priority fee in microlamports (default: 0) */
	priorityFee?: number;
	/** Compute units to allocate */
	computeUnits?: number;
}

/**
 * Build transaction options from config, filtering out undefined values.
 * This is needed because exactOptionalPropertyTypes doesn't allow { key: undefined }.
 */
function buildOptions(config?: MutationConfig) {
	if (!config) return undefined;
	const options: { priorityFee?: number; computeUnits?: number } = {};
	if (config.priorityFee !== undefined)
		options.priorityFee = config.priorityFee;
	if (config.computeUnits !== undefined)
		options.computeUnits = config.computeUnits;
	return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * Send and confirm a transaction with program error parsing.
 * Wraps wallet adapter's sendTransaction with proper error handling.
 */
async function sendAndConfirm(
	transaction: VersionedTransaction,
	connection: Connection,
	blockhash: string,
	lastValidBlockHeight: number,
	sendTransaction: (
		tx: VersionedTransaction,
		conn: Connection,
	) => Promise<string>,
): Promise<string> {
	let signature: string;
	try {
		signature = await sendTransaction(transaction, connection);
	} catch (err) {
		const programError = parseProgramError(err);
		if (programError) throw programError;
		throw new TransactionFailedError(
			undefined,
			err instanceof Error ? err : undefined,
		);
	}

	try {
		await connection.confirmTransaction({
			signature,
			blockhash,
			lastValidBlockHeight,
		});
	} catch (err) {
		const programError = parseProgramError(err);
		if (programError) throw programError;
		throw new TransactionFailedError(
			signature,
			err instanceof Error ? err : undefined,
		);
	}

	return signature;
}

/**
 * Create a new split.
 *
 * @param config - Optional configuration for priority fees and compute units
 *
 * @example
 * ```tsx
 * function CreateSplitButton() {
 *   // With default settings (no priority fee)
 *   const { mutate: createSplit, isPending } = useCreateSplit();
 *
 *   // Or with mainnet config
 *   const { mutate: createSplit, isPending } = useCreateSplit({
 *     priorityFee: 50_000,
 *     computeUnits: 200_000
 *   });
 *
 *   const handleCreate = () => {
 *     createSplit({
 *       token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *       recipients: [
 *         { address: 'alice...', share: 60 },
 *         { address: 'bob...', share: 40 },
 *       ],
 *     });
 *   };
 *
 *   return <button onClick={handleCreate} disabled={isPending}>Create</button>;
 * }
 * ```
 */
export function useCreateSplit(config?: MutationConfig) {
	const sdk = useSplitsContext();
	const { publicKey, sendTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: CreateSplitInput) => {
			if (!publicKey) throw new WalletNotConnectedError();

			const result = await sdk.buildCreateSplit(
				publicKey,
				input,
				buildOptions(config),
			);

			const signature = await sendAndConfirm(
				result.transaction,
				sdk.connection,
				result.blockhash,
				result.lastValidBlockHeight,
				sendTransaction,
			);

			// Capture authority for reliable cache invalidation
			const authority = publicKey.toBase58();

			return { ...result, signature, authority };
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({
				queryKey: splitsQueryKeys.byAuthority(data.authority),
			});
		},
	});
}

/**
 * Execute a split (distribute funds to recipients).
 * Permissionless - any wallet can execute.
 *
 * @param config - Optional configuration for priority fees and compute units
 *
 * @example
 * ```tsx
 * function ExecuteButton({ vault }: { vault: string }) {
 *   const { mutate: execute, isPending } = useExecuteSplit({
 *     priorityFee: 50_000,
 *     computeUnits: 300_000  // Execute needs more CUs for transfers
 *   });
 *   return <button onClick={() => execute(vault)} disabled={isPending}>Distribute</button>;
 * }
 * ```
 */
export function useExecuteSplit(config?: MutationConfig) {
	const sdk = useSplitsContext();
	const { publicKey, sendTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (vault: string) => {
			if (!publicKey) throw new WalletNotConnectedError();

			const result = await sdk.buildExecuteSplit(
				vault,
				publicKey,
				buildOptions(config),
			);

			const signature = await sendAndConfirm(
				result.transaction,
				sdk.connection,
				result.blockhash,
				result.lastValidBlockHeight,
				sendTransaction,
			);

			// Capture executor for reliable cache invalidation
			const executor = publicKey.toBase58();

			return { vault, signature, executor };
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({
				queryKey: splitsQueryKeys.byAuthority(data.executor),
			});
		},
	});
}

/**
 * Update split recipients.
 * Requires authority signature.
 *
 * @param config - Optional configuration for priority fees and compute units
 *
 * @example
 * ```tsx
 * function UpdateButton({ vault }: { vault: string }) {
 *   const { mutate: update, isPending } = useUpdateSplit({
 *     priorityFee: 50_000,
 *     computeUnits: 200_000
 *   });
 *
 *   const handleUpdate = () => {
 *     update({
 *       vault,
 *       recipients: [
 *         { address: 'alice...', share: 70 },
 *         { address: 'bob...', share: 30 },
 *       ],
 *     });
 *   };
 *
 *   return <button onClick={handleUpdate} disabled={isPending}>Update</button>;
 * }
 * ```
 */
export function useUpdateSplit(config?: MutationConfig) {
	const sdk = useSplitsContext();
	const { publicKey, sendTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: UpdateSplitInput) => {
			if (!publicKey) throw new WalletNotConnectedError();

			const result = await sdk.buildUpdateSplit(
				publicKey,
				input,
				buildOptions(config),
			);

			const signature = await sendAndConfirm(
				result.transaction,
				sdk.connection,
				result.blockhash,
				result.lastValidBlockHeight,
				sendTransaction,
			);

			// Capture authority for reliable cache invalidation
			const authority = publicKey.toBase58();

			return { vault: input.vault, signature, authority };
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({
				queryKey: splitsQueryKeys.single(data.vault),
			});
			queryClient.invalidateQueries({
				queryKey: splitsQueryKeys.byAuthority(data.authority),
			});
		},
	});
}

/**
 * Close a split and reclaim rent.
 * Requires authority signature. Rent is returned to authority by default.
 *
 * @param config - Optional configuration for priority fees and compute units
 *
 * @example
 * ```tsx
 * function CloseButton({ vault }: { vault: string }) {
 *   const { mutate: closeSplit, isPending } = useCloseSplit({
 *     priorityFee: 50_000
 *   });
 *   return <button onClick={() => closeSplit(vault)} disabled={isPending}>Close</button>;
 * }
 * ```
 */
export function useCloseSplit(config?: MutationConfig) {
	const sdk = useSplitsContext();
	const { publicKey, sendTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (vault: string) => {
			if (!publicKey) throw new WalletNotConnectedError();

			const result = await sdk.buildCloseSplit(
				vault,
				publicKey,
				undefined, // rentReceiver - defaults to authority
				buildOptions(config),
			);

			const signature = await sendAndConfirm(
				result.transaction,
				sdk.connection,
				result.blockhash,
				result.lastValidBlockHeight,
				sendTransaction,
			);

			// Capture authority for reliable cache invalidation
			const authority = publicKey.toBase58();

			return { vault, signature, authority };
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({
				queryKey: splitsQueryKeys.byAuthority(data.authority),
			});
		},
	});
}
