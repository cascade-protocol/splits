/**
 * execute implementation for the Splits client
 *
 * Execute split distribution with actionable error messages.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { SplitConfigNotFoundError } from "../errors.js";
import { executeSplit } from "../instructions.js";
import {
  getSplitConfig,
  detectTokenProgram,
  invalidateProtocolConfigCache,
  type SplitConfig,
} from "../helpers.js";
import { buildTransaction } from "./buildTransaction.js";
import { notFoundMessage, notASplitMessage } from "./messages.js";
import type {
  SplitsWallet,
  SplitsClientConfig,
  ExecuteOptions,
  ExecuteResult,
} from "./types.js";
import { handleTransactionError } from "./errors.js";

// Program error code for stale protocol config
const INVALID_PROTOCOL_FEE_RECIPIENT = 6004;

/**
 * Execute a split distribution.
 *
 * @internal
 */
export async function executeImpl(
  rpc: Rpc<SolanaRpcApi>,
  wallet: SplitsWallet,
  splitConfig: Address,
  options: ExecuteOptions &
    SplitsClientConfig & {
      computeUnitLimit?: number;
      abortSignal?: AbortSignal;
      _isRetry?: boolean;
    },
): Promise<ExecuteResult> {
  const {
    commitment = "confirmed",
    computeUnitPrice,
    computeUnitLimit,
    abortSignal,
  } = options;

  // 1. Get split config to find vault and mint
  let config: SplitConfig;
  try {
    config = await getSplitConfig(rpc, splitConfig);
  } catch (e) {
    if (e instanceof SplitConfigNotFoundError) {
      return {
        status: "skipped",
        reason: "not_found",
        message: notFoundMessage(splitConfig),
      };
    }
    throw e;
  }

  // 2. Detect token program from mint
  const tokenProgram = await detectTokenProgram(rpc, config.mint);

  // 3. Build execute instruction
  const result = await executeSplit({
    rpc,
    splitConfig,
    executor: wallet.address,
    tokenProgram,
  });
  if (result.status !== "success") {
    if (result.status === "not_a_split") {
      return {
        status: "skipped",
        reason: "not_a_split",
        message: notASplitMessage(splitConfig),
      };
    }
    return {
      status: "skipped",
      reason: "not_found",
      message: notFoundMessage(splitConfig),
    };
  }

  // 4. Build and send transaction
  try {
    // Build transaction with compute budget options (spread conditional)
    const buildOptions = {
      ...(computeUnitPrice !== undefined && { computeUnitPrice }),
      ...(computeUnitLimit !== undefined && { computeUnitLimit }),
    };

    const message = await buildTransaction(
      rpc,
      wallet.address,
      [result.instruction],
      Object.keys(buildOptions).length > 0 ? buildOptions : undefined,
    );

    const signature = await wallet.signAndSend(message, {
      commitment,
      ...(abortSignal && { abortSignal }),
    });

    return {
      status: "executed",
      signature,
    };
  } catch (e) {
    // Check for abort
    if (abortSignal?.aborted) {
      return {
        status: "failed",
        reason: "transaction_expired",
        message: "Transaction was aborted",
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }

    // Check for stale protocol config error and retry once
    if (
      isProgramError(e, INVALID_PROTOCOL_FEE_RECIPIENT) &&
      !options._isRetry
    ) {
      invalidateProtocolConfigCache();
      return executeImpl(rpc, wallet, splitConfig, {
        ...options,
        _isRetry: true,
      });
    }

    return handleTransactionError(e);
  }
}

/**
 * Check if an error is a specific program error code.
 */
function isProgramError(e: unknown, expectedCode: number): boolean {
  if (e instanceof Error) {
    const msg = e.message;
    // Check for program error in message (common pattern)
    if (msg.includes(`custom program error: 0x${expectedCode.toString(16)}`)) {
      return true;
    }
    // Check for error code in message
    if (msg.includes(`Error Code: ${expectedCode}`)) {
      return true;
    }
  }
  return false;
}
