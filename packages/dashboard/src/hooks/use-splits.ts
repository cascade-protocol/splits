/**
 * TanStack Query hooks for Cascade Splits
 *
 * Uses SDK instruction builders + generated decoders
 * web3.js for RPC calls and transaction submission
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Address } from "@solana/kit";

// Generated SDK imports for decoding
import {
	SPLIT_CONFIG_DISCRIMINATOR,
	getSplitConfigDecoder,
	type SplitConfig,
	getProtocolConfigDecoder,
} from "@cascade-fyi/splits-sdk/solana/generated";

// SDK instruction builders (handle remaining accounts correctly)
import {
	createSplitConfig,
	deriveProtocolConfig,
	deriveAta,
} from "@cascade-fyi/splits-sdk/solana";

// web3.js compat
import { toWeb3Instruction } from "@cascade-fyi/splits-sdk/solana/web3-compat";

// SDK types and constants
import {
	PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	toPercentageBps,
	type Recipient,
} from "@cascade-fyi/splits-sdk";

// Instruction data encoders for manual instruction building
import {
	getExecuteSplitInstructionDataEncoder,
	getUpdateSplitConfigInstructionDataEncoder,
	getCloseSplitConfigInstructionDataEncoder,
} from "@cascade-fyi/splits-sdk/solana/generated";

// =============================================================================
// Types
// =============================================================================

/** SplitConfig with vault balance for dashboard display */
export interface SplitWithBalance extends SplitConfig {
	/** The splitConfig PDA address */
	address: string;
	/** Current vault token balance */
	vaultBalance: bigint;
}

// =============================================================================
// Constants
// =============================================================================

const SPLITS_QUERY_KEY = ["splits"] as const;
const PROTOCOL_CONFIG_QUERY_KEY = ["protocol-config"] as const;
const DEFAULT_PRIORITY_FEE = 50_000; // microlamports
const DEFAULT_COMPUTE_UNITS = 200_000;
const EXECUTE_COMPUTE_UNITS = 300_000; // more CUs for multiple transfers

// Layout offset for authority field (discriminator + version = 9 bytes)
const AUTHORITY_OFFSET = 9;

// Account roles for manual instruction building
const SIGNER = 2;
const WRITABLE = 1;
const READONLY = 0;

// =============================================================================
// Decoders
// =============================================================================

const splitConfigDecoder = getSplitConfigDecoder();
const protocolConfigDecoder = getProtocolConfigDecoder();

// =============================================================================
// Protocol Config Hook
// =============================================================================

function useProtocolConfig() {
	const { connection } = useConnection();

	return useQuery({
		queryKey: PROTOCOL_CONFIG_QUERY_KEY,
		queryFn: async () => {
			const address = await deriveProtocolConfig();
			const accountInfo = await connection.getAccountInfo(
				new PublicKey(address),
			);
			if (!accountInfo) {
				throw new Error("Protocol config not found");
			}
			return {
				...protocolConfigDecoder.decode(accountInfo.data),
				address,
			};
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
}

// =============================================================================
// Helpers
// =============================================================================

function addComputeBudget(tx: Transaction, computeUnits: number): void {
	tx.add(
		ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
		ComputeBudgetProgram.setComputeUnitPrice({
			microLamports: DEFAULT_PRIORITY_FEE,
		}),
	);
}

// =============================================================================
// Query Hook
// =============================================================================

export function useSplits() {
	const { connection } = useConnection();
	const { publicKey } = useWallet();

	return useQuery({
		queryKey: [...SPLITS_QUERY_KEY, publicKey?.toBase58()],
		queryFn: async (): Promise<SplitWithBalance[]> => {
			if (!publicKey) return [];

			const accounts = await connection.getProgramAccounts(
				new PublicKey(PROGRAM_ID),
				{
					filters: [
						{
							memcmp: {
								offset: 0,
								bytes: bs58.encode(SPLIT_CONFIG_DISCRIMINATOR),
							},
						},
						{
							memcmp: {
								offset: AUTHORITY_OFFSET,
								bytes: publicKey.toBase58(),
							},
						},
					],
				},
			);

			const results: SplitWithBalance[] = [];

			for (const { pubkey, account } of accounts) {
				const decoded = splitConfigDecoder.decode(account.data);

				let vaultBalance = 0n;
				try {
					const balance = await connection.getTokenAccountBalance(
						new PublicKey(decoded.vault),
					);
					vaultBalance = BigInt(balance.value.amount);
				} catch {
					// Vault may not exist yet
				}

				results.push({
					...decoded,
					address: pubkey.toBase58(),
					vaultBalance,
				});
			}

			return results;
		},
		enabled: !!publicKey,
		staleTime: 30_000,
	});
}

// =============================================================================
// Mutation Hooks
// =============================================================================

interface MutationResult {
	signature: string;
	vault?: string;
}

export function useCreateSplit() {
	const { connection } = useConnection();
	const { publicKey, signTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation<
		MutationResult,
		Error,
		{ recipients: Recipient[]; token: string }
	>({
		mutationFn: async ({ recipients, token }) => {
			if (!publicKey || !signTransaction) {
				throw new Error("Wallet not connected");
			}

			// Use SDK's createSplitConfig which handles everything
			const { instruction, vault } = await createSplitConfig({
				authority: publicKey.toBase58() as Address,
				recipients,
				mint: token as Address,
			});

			const tx = new Transaction();
			addComputeBudget(tx, DEFAULT_COMPUTE_UNITS);
			tx.add(toWeb3Instruction(instruction));

			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash();
			tx.recentBlockhash = blockhash;
			tx.feePayer = publicKey;

			const signed = await signTransaction(tx);
			const signature = await connection.sendRawTransaction(signed.serialize());
			await connection.confirmTransaction({
				signature,
				blockhash,
				lastValidBlockHeight,
			});

			return { signature, vault };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY });
		},
	});
}

export function useExecuteSplit() {
	const { connection } = useConnection();
	const { publicKey, signTransaction } = useWallet();
	const queryClient = useQueryClient();
	const { data: protocolConfig } = useProtocolConfig();

	return useMutation<MutationResult, Error, SplitWithBalance>({
		mutationFn: async (split) => {
			if (!publicKey || !signTransaction) {
				throw new Error("Wallet not connected");
			}
			if (!protocolConfig) {
				throw new Error("Protocol config not loaded");
			}

			const executor = publicKey.toBase58() as Address;

			// Derive recipient ATAs + protocol ATA
			const recipientAtas = await Promise.all(
				split.recipients
					.slice(0, split.recipientCount)
					.map((r) => deriveAta(r.address, split.mint)),
			);
			const protocolAta = await deriveAta(protocolConfig.feeWallet, split.mint);

			// Build instruction manually (protocol ATA must be last in remaining accounts)
			const data = getExecuteSplitInstructionDataEncoder().encode({});

			const instruction = {
				programAddress: PROGRAM_ID,
				accounts: [
					{ address: split.address as Address, role: WRITABLE },
					{ address: split.vault, role: WRITABLE },
					{ address: split.mint, role: READONLY },
					{ address: protocolConfig.address, role: READONLY },
					{ address: executor, role: READONLY },
					{ address: TOKEN_PROGRAM_ID, role: READONLY },
					// Remaining accounts: recipient ATAs + protocol ATA (last)
					...recipientAtas.map((ata) => ({ address: ata, role: WRITABLE })),
					{ address: protocolAta, role: WRITABLE },
				],
				data,
			};

			const tx = new Transaction();
			addComputeBudget(tx, EXECUTE_COMPUTE_UNITS);
			tx.add(toWeb3Instruction(instruction));

			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash();
			tx.recentBlockhash = blockhash;
			tx.feePayer = publicKey;

			const signed = await signTransaction(tx);
			const signature = await connection.sendRawTransaction(signed.serialize());
			await connection.confirmTransaction({
				signature,
				blockhash,
				lastValidBlockHeight,
			});

			return { signature };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY });
		},
	});
}

export function useUpdateSplit() {
	const { connection } = useConnection();
	const { publicKey, signTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation<
		MutationResult,
		Error,
		{ split: SplitWithBalance; recipients: Recipient[] }
	>({
		mutationFn: async ({ split, recipients }) => {
			if (!publicKey || !signTransaction) {
				throw new Error("Wallet not connected");
			}

			const authority = publicKey.toBase58() as Address;

			// Convert recipients to on-chain format
			const onChainRecipients = recipients.map((r) => ({
				address: r.address as Address,
				percentageBps: toPercentageBps(r),
			}));

			// Derive recipient ATAs for validation
			const recipientAtas = await Promise.all(
				onChainRecipients.map((r) => deriveAta(r.address, split.mint)),
			);

			// Build instruction manually
			const data = getUpdateSplitConfigInstructionDataEncoder().encode({
				newRecipients: onChainRecipients,
			});

			const instruction = {
				programAddress: PROGRAM_ID,
				accounts: [
					{ address: split.address as Address, role: WRITABLE },
					{ address: split.vault, role: READONLY },
					{ address: split.mint, role: READONLY },
					{ address: authority, role: SIGNER },
					{ address: TOKEN_PROGRAM_ID, role: READONLY },
					// Remaining accounts: recipient ATAs for validation
					...recipientAtas.map((ata) => ({ address: ata, role: READONLY })),
				],
				data,
			};

			const tx = new Transaction();
			addComputeBudget(tx, DEFAULT_COMPUTE_UNITS);
			tx.add(toWeb3Instruction(instruction));

			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash();
			tx.recentBlockhash = blockhash;
			tx.feePayer = publicKey;

			const signed = await signTransaction(tx);
			const signature = await connection.sendRawTransaction(signed.serialize());
			await connection.confirmTransaction({
				signature,
				blockhash,
				lastValidBlockHeight,
			});

			return { signature };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY });
		},
	});
}

export function useCloseSplit() {
	const { connection } = useConnection();
	const { publicKey, signTransaction } = useWallet();
	const queryClient = useQueryClient();

	return useMutation<MutationResult, Error, SplitWithBalance>({
		mutationFn: async (split) => {
			if (!publicKey || !signTransaction) {
				throw new Error("Wallet not connected");
			}

			const authority = publicKey.toBase58() as Address;

			// Build instruction manually
			const data = getCloseSplitConfigInstructionDataEncoder().encode({});

			const instruction = {
				programAddress: PROGRAM_ID,
				accounts: [
					{ address: split.address as Address, role: WRITABLE },
					{ address: split.vault, role: WRITABLE },
					{ address: authority, role: SIGNER },
					{ address: authority, role: WRITABLE }, // rentDestination = authority
					{ address: TOKEN_PROGRAM_ID, role: READONLY },
				],
				data,
			};

			const tx = new Transaction();
			addComputeBudget(tx, DEFAULT_COMPUTE_UNITS);
			tx.add(toWeb3Instruction(instruction));

			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash();
			tx.recentBlockhash = blockhash;
			tx.feePayer = publicKey;

			const signed = await signTransaction(tx);
			const signature = await connection.sendRawTransaction(signed.serialize());
			await connection.confirmTransaction({
				signature,
				blockhash,
				lastValidBlockHeight,
			});

			return { signature };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY });
		},
	});
}
