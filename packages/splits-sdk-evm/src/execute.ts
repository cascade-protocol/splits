import type { Address, PublicClient, WalletClient } from "viem";
import { splitConfigImplAbi } from "./abi.js";
import type { EvmExecuteResult, EvmExecuteOptions } from "./types.js";
import { isCascadeSplit, getSplitBalance, hasPendingFunds } from "./helpers.js";

/**
 * Execute split distribution.
 *
 * - If split doesn't exist or isn't valid: returns SKIPPED
 * - If balance is below threshold: returns SKIPPED
 * - If no pending funds: returns SKIPPED
 * - On success: returns EXECUTED with transaction hash
 * - On failure: returns FAILED with details
 *
 * This is a permissionless operation - anyone can call it.
 *
 * @example
 * ```typescript
 * const result = await executeSplit(publicClient, walletClient, splitAddress, {
 *   minBalance: 1_000_000n // 1 USDC (6 decimals)
 * });
 *
 * if (result.status === 'EXECUTED') {
 *   console.log('Executed in tx', result.signature);
 * } else if (result.status === 'SKIPPED') {
 *   console.log('Skipped:', result.reason);
 * }
 * ```
 */
export async function executeSplit(
  publicClient: PublicClient,
  walletClient: WalletClient,
  splitAddress: Address,
  options?: EvmExecuteOptions,
): Promise<EvmExecuteResult> {
  // Get wallet account
  const account = walletClient.account;
  if (!account) {
    return {
      status: "FAILED",
      reason: "wallet_disconnected",
      message: "Wallet account not connected",
    };
  }

  try {
    // Check if it's a valid split
    const isValid = await isCascadeSplit(publicClient, splitAddress);
    if (!isValid) {
      return { status: "SKIPPED", reason: "not_a_split" };
    }

    // Check balance threshold
    if (options?.minBalance !== undefined) {
      const balance = await getSplitBalance(publicClient, splitAddress);
      if (balance < options.minBalance) {
        return { status: "SKIPPED", reason: "below_threshold" };
      }
    }

    // Check if there's anything to distribute
    const hasFunds = await hasPendingFunds(publicClient, splitAddress);
    if (!hasFunds) {
      return { status: "SKIPPED", reason: "no_pending_funds" };
    }

    // Execute the split
    const hash = await walletClient.writeContract({
      address: splitAddress,
      abi: splitConfigImplAbi,
      functionName: "executeSplit",
      args: [],
      account,
      chain: publicClient.chain,
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash });

    return { status: "EXECUTED", signature: hash };
  } catch (error) {
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
