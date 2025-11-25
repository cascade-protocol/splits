/**
 * High-level @solana/web3.js adapter for Cascade Splits
 * Uses 100-share mental model — SDK handles basis point conversion
 */

import {
	Connection,
	PublicKey,
	VersionedTransaction,
	TransactionMessage,
	ComputeBudgetProgram,
	Keypair,
} from "@solana/web3.js";
import {
	validateAndTransformCreate,
	validateAndTransformUpdate,
} from "../core/business-logic.js";
import type { CreateSplitInput, UpdateSplitInput } from "../core/schemas.js";
import type { DistributionPreview, SplitConfig } from "../core/types.js";
import {
	PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
} from "../core/constants.js";
import { deriveSplitConfig, deriveVault, deriveAta } from "../pda.js";
import {
	buildCreateSplitConfigInstruction,
	buildExecuteSplitInstruction,
	buildUpdateSplitConfigInstruction,
	buildCloseSplitConfigInstruction,
} from "./instructions.js";
import * as read from "./read.js";
import {
	NonEmptyVaultError,
	UnclaimedAmountsError,
	ProtocolUnclaimedError,
} from "../errors.js";

/**
 * Options for transaction building
 */
export interface TransactionOptions {
	/** Priority fee in microlamports (for ComputeBudgetProgram.setComputeUnitPrice) */
	priorityFee?: number;
	/** Compute unit limit (for ComputeBudgetProgram.setComputeUnitLimit) */
	computeUnits?: number;
}

/**
 * Result of creating a split
 */
export interface CreateSplitResult {
	splitConfig: string;
	vault: string;
	transaction: VersionedTransaction;
}

/**
 * High-level SDK for Cascade Splits using @solana/web3.js
 */
export class CascadeSplits {
	private readonly programId: PublicKey;
	private readonly ataProgramId: PublicKey;

	constructor(
		private readonly connection: Connection,
		programId?: string,
	) {
		this.programId = new PublicKey(programId ?? PROGRAM_ID);
		this.ataProgramId = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
	}

	/**
	 * Create SDK instance for mainnet
	 */
	static mainnet(): CascadeSplits {
		return new CascadeSplits(
			new Connection("https://api.mainnet-beta.solana.com", "confirmed"),
		);
	}

	/**
	 * Create SDK instance for devnet
	 */
	static devnet(): CascadeSplits {
		return new CascadeSplits(
			new Connection("https://api.devnet.solana.com", "confirmed"),
		);
	}

	/**
	 * Build transaction to create a new split configuration.
	 * Uses 100-share mental model - shares are automatically converted to basis points.
	 *
	 * @param authority - Authority that can update/close the split
	 * @param params - Split parameters (recipients with shares that sum to 100)
	 * @param options - Transaction options (priority fee, compute units)
	 * @returns Split addresses and unsigned transaction
	 *
	 * @example
	 * ```ts
	 * const result = await sdk.buildCreateSplit(
	 *   authority,
	 *   {
	 *     recipients: [
	 *       { address: "alice.sol", share: 60 },
	 *       { address: "bob.sol", share: 40 }
	 *     ],
	 *     token: USDC_MINT // optional, defaults to USDC
	 *   },
	 *   { priorityFee: 100_000 }
	 * );
	 *
	 * // Sign and send
	 * transaction.sign([authorityKeypair]);
	 * const sig = await connection.sendTransaction(transaction);
	 * ```
	 */
	async buildCreateSplit(
		authority: PublicKey,
		params: CreateSplitInput,
		options?: TransactionOptions,
	): Promise<CreateSplitResult> {
		// Validate and transform to protocol format
		const processed = validateAndTransformCreate(params);

		// Generate unique ID for this split
		const uniqueId = Keypair.generate().publicKey;

		const mint = new PublicKey(processed.token);
		const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);

		// Derive PDAs
		const { address: splitConfig } = deriveSplitConfig(
			authority.toBase58(),
			mint.toBase58(),
			uniqueId.toBase58(),
		);
		const vault = deriveVault(
			splitConfig,
			mint.toBase58(),
			tokenProgram.toBase58(),
		);

		// Build instructions
		const instructions = [];

		// Add compute budget if specified
		if (options?.priorityFee) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: options.priorityFee,
				}),
			);
		}

		if (options?.computeUnits) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitLimit({
					units: options.computeUnits,
				}),
			);
		}

		// Add create split instruction
		instructions.push(
			buildCreateSplitConfigInstruction(
				this.programId,
				this.ataProgramId,
				authority,
				mint,
				uniqueId,
				processed.recipients,
				tokenProgram,
				authority, // payer defaults to authority
			),
		);

		// Build V0 transaction
		const { blockhash } = await this.connection.getLatestBlockhash();

		const message = new TransactionMessage({
			payerKey: authority,
			recentBlockhash: blockhash,
			instructions,
		}).compileToV0Message();

		const transaction = new VersionedTransaction(message);

		return {
			splitConfig,
			vault,
			transaction,
		};
	}

	/**
	 * Build transaction to execute a split (distribute vault balance).
	 * Permissionless - anyone can call this.
	 *
	 * @param vault - Vault address of the split
	 * @param executor - Account that will execute (typically the signer)
	 * @param options - Transaction options
	 * @returns Unsigned transaction
	 *
	 * @example
	 * ```ts
	 * const tx = await sdk.buildExecuteSplit(vault, executor.publicKey);
	 * tx.sign([executor]);
	 * const sig = await connection.sendTransaction(tx);
	 * ```
	 */
	async buildExecuteSplit(
		vault: string,
		executor: PublicKey,
		options?: TransactionOptions,
	): Promise<VersionedTransaction> {
		// 1. Parse vault string and fetch split config
		const vaultPubkey = new PublicKey(vault);
		const split = await read.getSplit(this.connection, vaultPubkey);

		// 2. Derive splitConfig address
		const { address: splitConfig } = deriveSplitConfig(
			split.authority,
			split.mint,
			split.uniqueId,
		);

		// 3. Derive recipient ATAs
		const mint = new PublicKey(split.mint);
		const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
		const recipientAtas: PublicKey[] = split.recipients.map(
			(r) => new PublicKey(deriveAta(r.address, split.mint, TOKEN_PROGRAM_ID)),
		);

		// 4. Fetch protocol config to get fee_wallet
		const protocolConfig = await read.getProtocolConfig(this.connection);

		// 5. Derive protocol ATA using fee_wallet
		const protocolAta = new PublicKey(
			deriveAta(protocolConfig.feeWallet, split.mint, TOKEN_PROGRAM_ID),
		);

		// 6. Build instruction
		const executeInstruction = buildExecuteSplitInstruction(
			this.programId,
			new PublicKey(splitConfig),
			vaultPubkey,
			mint,
			executor,
			recipientAtas,
			protocolAta,
			tokenProgram,
		);

		// 7. Add compute budget instructions if provided
		const instructions = [];
		if (options?.priorityFee) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: options.priorityFee,
				}),
			);
		}
		if (options?.computeUnits) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitLimit({
					units: options.computeUnits,
				}),
			);
		}
		instructions.push(executeInstruction);

		// 8. Build V0 transaction
		const { blockhash } = await this.connection.getLatestBlockhash();
		const message = new TransactionMessage({
			payerKey: executor,
			recentBlockhash: blockhash,
			instructions,
		}).compileToV0Message();

		return new VersionedTransaction(message);
	}

	/**
	 * Build transaction to update a split's recipients.
	 * Requires vault to be empty and all unclaimed amounts to be zero.
	 *
	 * @param authority - Current authority (must sign)
	 * @param params - Update parameters (vault address and new recipients)
	 * @param options - Transaction options
	 * @returns Unsigned transaction
	 */
	async buildUpdateSplit(
		authority: PublicKey,
		params: UpdateSplitInput,
		options?: TransactionOptions,
	): Promise<VersionedTransaction> {
		// 1. Validate and transform to protocol format
		const processed = validateAndTransformUpdate(params);

		// 2. Parse vault string and fetch split config
		const vaultPubkey = new PublicKey(processed.vault);
		const split = await read.getSplit(this.connection, vaultPubkey);

		// 3. Validate vault is empty and no unclaimed amounts
		const balance = await read.getVaultBalance(this.connection, vaultPubkey);
		if (balance > 0n) {
			throw new NonEmptyVaultError(balance);
		}
		if (split.unclaimedAmounts.length > 0) {
			throw new UnclaimedAmountsError(split.unclaimedAmounts.length);
		}
		if (split.protocolUnclaimed > 0n) {
			throw new ProtocolUnclaimedError(split.protocolUnclaimed);
		}

		// 4. Derive splitConfig address
		const { address: splitConfig } = deriveSplitConfig(
			split.authority,
			split.mint,
			split.uniqueId,
		);

		// 5. Get mint and token program
		const mint = new PublicKey(split.mint);
		const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);

		// 6. Build instruction with processed.recipients (already in protocol format)
		const updateInstruction = buildUpdateSplitConfigInstruction(
			this.programId,
			new PublicKey(splitConfig),
			vaultPubkey,
			mint,
			authority,
			processed.recipients,
			tokenProgram,
		);

		// 7. Add compute budget instructions if provided
		const instructions = [];
		if (options?.priorityFee) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: options.priorityFee,
				}),
			);
		}
		if (options?.computeUnits) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitLimit({
					units: options.computeUnits,
				}),
			);
		}
		instructions.push(updateInstruction);

		// 8. Build V0 transaction
		const { blockhash } = await this.connection.getLatestBlockhash();
		const message = new TransactionMessage({
			payerKey: authority,
			recentBlockhash: blockhash,
			instructions,
		}).compileToV0Message();

		return new VersionedTransaction(message);
	}

	/**
	 * Build transaction to close a split and recover rent.
	 * Requires vault to be empty and all unclaimed amounts to be zero.
	 *
	 * @param vault - Vault address
	 * @param authority - Authority (must sign)
	 * @param rentReceiver - Account to receive rent refund (defaults to authority)
	 * @param options - Transaction options
	 * @returns Unsigned transaction
	 */
	async buildCloseSplit(
		vault: string,
		authority: PublicKey,
		rentReceiver?: PublicKey,
		options?: TransactionOptions,
	): Promise<VersionedTransaction> {
		// 1. Parse vault and fetch split config
		const vaultPubkey = new PublicKey(vault);
		const split = await read.getSplit(this.connection, vaultPubkey);

		// 2. Validate vault is empty and no unclaimed amounts
		const balance = await read.getVaultBalance(this.connection, vaultPubkey);
		if (balance > 0n) {
			throw new NonEmptyVaultError(balance);
		}
		if (split.unclaimedAmounts.length > 0) {
			throw new UnclaimedAmountsError(split.unclaimedAmounts.length);
		}
		if (split.protocolUnclaimed > 0n) {
			throw new ProtocolUnclaimedError(split.protocolUnclaimed);
		}

		// 3. Derive splitConfig address
		const { address: splitConfig } = deriveSplitConfig(
			split.authority,
			split.mint,
			split.uniqueId,
		);

		// 4. Get token program
		const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);

		// 5. Default rent receiver to authority if not provided
		const actualRentReceiver = rentReceiver ?? authority;

		// 6. Build instruction
		const closeInstruction = buildCloseSplitConfigInstruction(
			this.programId,
			new PublicKey(splitConfig),
			vaultPubkey,
			authority,
			actualRentReceiver,
			tokenProgram,
		);

		// 7. Add compute budget instructions if provided
		const instructions = [];
		if (options?.priorityFee) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: options.priorityFee,
				}),
			);
		}
		if (options?.computeUnits) {
			instructions.push(
				ComputeBudgetProgram.setComputeUnitLimit({
					units: options.computeUnits,
				}),
			);
		}
		instructions.push(closeInstruction);

		// 8. Build V0 transaction
		const { blockhash } = await this.connection.getLatestBlockhash();
		const message = new TransactionMessage({
			payerKey: authority,
			recentBlockhash: blockhash,
			instructions,
		}).compileToV0Message();

		return new VersionedTransaction(message);
	}

	/**
	 * Fetch and decode a split configuration (read-only).
	 * Returns split with recipients converted back to 100-share format.
	 *
	 * @param vault - Vault address
	 * @returns Decoded split config with shares
	 */
	async getSplit(vault: string): Promise<SplitConfig> {
		const vaultPubkey = new PublicKey(vault);
		return read.getSplit(this.connection, vaultPubkey);
	}

	/**
	 * Get current vault balance (read-only).
	 *
	 * @param vault - Vault address
	 * @returns Token balance as bigint
	 */
	async getVaultBalance(vault: string): Promise<bigint> {
		const vaultPubkey = new PublicKey(vault);
		const accountInfo = await this.connection.getAccountInfo(vaultPubkey);

		if (!accountInfo) {
			return 0n;
		}

		// Parse token account (offset 64 = amount as u64 LE)
		if (accountInfo.data.length < 72) {
			throw new Error("Invalid token account data");
		}

		const amount = accountInfo.data.readBigUInt64LE(64);
		return amount;
	}

	/**
	 * Preview what would happen if execute was called now (read-only).
	 * Calculates distribution using current vault balance.
	 *
	 * @param vault - Vault address
	 * @returns Preview of distribution amounts
	 */
	async previewExecution(vault: string): Promise<DistributionPreview> {
		const vaultPubkey = new PublicKey(vault);
		return read.previewExecution(this.connection, vaultPubkey);
	}
}

// Re-export types for convenience
export type {
	ShareRecipient,
	CreateSplitInput,
	UpdateSplitInput,
} from "../core/schemas.js";
export type { DistributionPreview, SplitConfig } from "../core/types.js";
