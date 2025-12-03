import type { Address, PublicClient, WalletClient } from "viem";
import { splitFactoryAbi } from "./abi.js";
import type {
	EvmEnsureParams,
	EvmEnsureResult,
	EvmRecipient,
} from "./types.js";
import {
	predictSplitAddress,
	toEvmRecipients,
	getDefaultToken,
} from "./helpers.js";

/**
 * Idempotent split creation.
 *
 * - If split doesn't exist: creates it and returns CREATED
 * - If split exists with same params: returns NO_CHANGE
 * - If creation fails: returns FAILED with details
 *
 * Note: Unlike Solana, EVM splits are immutable (cannot update recipients).
 *
 * @example
 * ```typescript
 * const result = await ensureSplit(publicClient, walletClient, factoryAddress, {
 *   token: '0xUSDC...',
 *   uniqueId: '0x...',
 *   recipients: [
 *     { address: '0xAlice...', share: 60 },
 *     { address: '0xBob...', share: 40 }
 *   ]
 * });
 *
 * if (result.status === 'CREATED') {
 *   console.log('Split created at', result.split);
 * }
 * ```
 */
export async function ensureSplit(
	publicClient: PublicClient,
	walletClient: WalletClient,
	factoryAddress: Address,
	params: EvmEnsureParams,
): Promise<EvmEnsureResult> {
	// Get wallet account
	const account = walletClient.account;
	if (!account) {
		return {
			status: "FAILED",
			reason: "wallet_disconnected",
			message: "Wallet account not connected",
		};
	}

	// Resolve authority (default to wallet address)
	const authority = params.authority ?? account.address;

	// Resolve token (default to USDC on connected chain)
	const chainId = await publicClient.getChainId();
	const token = params.token ?? getDefaultToken(chainId);

	// Convert recipients to on-chain format
	const evmRecipients: EvmRecipient[] = toEvmRecipients(params.recipients);

	// Validate recipients sum to 9900 bps
	const totalBps = evmRecipients.reduce((sum, r) => sum + r.percentageBps, 0);
	if (totalBps !== 9900) {
		return {
			status: "FAILED",
			reason: "transaction_failed",
			message: `Recipients must sum to 9900 bps (99%), got ${totalBps}`,
		};
	}

	try {
		// Predict deterministic address
		const predictedAddress = await predictSplitAddress(
			publicClient,
			factoryAddress,
			{
				authority,
				token,
				uniqueId: params.uniqueId,
				recipients: evmRecipients,
			},
		);

		// Check if already deployed
		const code = await publicClient.getBytecode({ address: predictedAddress });
		if (code && code.length > 0) {
			return { status: "NO_CHANGE", split: predictedAddress };
		}

		// Create the split
		// Cast recipients to viem's expected type (from const ABI inference)
		const hash = await walletClient.writeContract({
			address: factoryAddress,
			abi: splitFactoryAbi,
			functionName: "createSplitConfig",
			args: [
				authority,
				token,
				params.uniqueId,
				evmRecipients as readonly { addr: Address; percentageBps: number }[],
			],
			account,
			chain: publicClient.chain,
		});

		// Wait for confirmation
		await publicClient.waitForTransactionReceipt({ hash });

		return {
			status: "CREATED",
			split: predictedAddress,
			signature: hash,
		};
	} catch (error) {
		// Classify error
		const message = error instanceof Error ? error.message : String(error);

		// Check for user rejection
		if (
			message.includes("rejected") ||
			message.includes("denied") ||
			message.includes("cancelled")
		) {
			return {
				status: "FAILED",
				reason: "wallet_rejected",
				message: "Transaction rejected by user",
				error: error instanceof Error ? error : undefined,
			};
		}

		// Check for revert
		if (message.includes("revert") || message.includes("execution reverted")) {
			return {
				status: "FAILED",
				reason: "transaction_reverted",
				message,
				error: error instanceof Error ? error : undefined,
			};
		}

		// Check for gas issues
		if (message.includes("gas") || message.includes("insufficient funds")) {
			return {
				status: "FAILED",
				reason: "insufficient_gas",
				message,
				error: error instanceof Error ? error : undefined,
			};
		}

		// Generic failure
		return {
			status: "FAILED",
			reason: "transaction_failed",
			message,
			error: error instanceof Error ? error : undefined,
		};
	}
}
