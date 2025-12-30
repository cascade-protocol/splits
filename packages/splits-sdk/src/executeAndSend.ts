/**
 * Execute and send split (no confirmation wait)
 *
 * Builds, signs, and broadcasts a split execution transaction.
 * Returns immediately after sending - does not wait for confirmation.
 */
import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { isCascadeSplit } from "./helpers.js";
import { executeSplit } from "./instructions.js";

export type ExecuteAndSendResult =
  | { sent: true; signature: string }
  | {
      sent: false;
      reason: "not_a_split" | "not_found" | "build_failed" | "send_failed";
      error?: string;
    };

/**
 * Execute a split without waiting for confirmation.
 *
 * Designed for x402 facilitators: after settling a payment to a split config,
 * call this to trigger distribution. Returns immediately after broadcast.
 *
 * @example
 * ```typescript
 * // In facilitator after successful settlement
 * executeAndSendSplit({
 *   rpc,
 *   splitConfig: paymentRequirements.payTo,
 *   signer: feePayerSigner,
 * }).then((r) => {
 *   if (r.sent) console.log(`[splits] Sent: ${r.signature}`);
 * });
 * ```
 */
export async function executeAndSendSplit(input: {
  rpc: Rpc<SolanaRpcApi>;
  splitConfig: Address;
  signer: TransactionSigner;
}): Promise<ExecuteAndSendResult> {
  const { rpc, splitConfig, signer } = input;

  // 1. Check if address is a cascade split
  if (!(await isCascadeSplit(rpc, splitConfig))) {
    return { sent: false, reason: "not_a_split" };
  }

  // 2. Build execute instruction
  const result = await executeSplit({
    rpc,
    splitConfig,
    executor: signer.address,
  });
  if (result.status !== "success") {
    return {
      sent: false,
      reason: result.status === "not_found" ? "not_found" : "build_failed",
    };
  }

  // 3. Get blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // 4. Build and sign transaction
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([result.instruction], m),
  );

  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  const wireTransaction = getBase64EncodedWireTransaction(signedTransaction);

  // 5. Send (no confirmation wait)
  try {
    const signature = await rpc
      .sendTransaction(wireTransaction, {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
      })
      .send();
    return { sent: true, signature };
  } catch (e) {
    return {
      sent: false,
      reason: "send_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
