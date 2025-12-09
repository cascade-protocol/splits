/**
 * Shared helpers for the client layer
 * @internal
 */

import type {
  Address,
  Instruction,
  Rpc,
  SolanaRpcApi,
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
  TransactionSigner,
  Commitment,
} from "@solana/kit";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import {
  getVaultBalance,
  checkRecipientAtas,
  type SplitConfig,
  type MissingAta,
} from "../helpers.js";
import { executeSplit } from "../instructions.js";
import { recipientAtasMissingMessage } from "./messages.js";
import type {
  SplitsWallet,
  TransactionMessage,
  BlockedReason,
} from "./types.js";

// =============================================================================
// Kit Wallet Creation
// =============================================================================

/**
 * Create a SplitsWallet from @solana/kit primitives.
 * @internal
 */
export function createKitWallet(
  signer: TransactionSigner,
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<
    SignatureNotificationsApi & SlotNotificationsApi
  >,
): SplitsWallet {
  const address = signer.address;
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  return {
    address,
    signAndSend: async (message: TransactionMessage, options) => {
      const commitment: Commitment = options?.commitment ?? "confirmed";

      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayerSigner(signer, msg),
        (msg) =>
          setTransactionMessageLifetimeUsingBlockhash(
            message.lifetimeConstraint,
            msg,
          ),
        (msg) =>
          appendTransactionMessageInstructions([...message.instructions], msg),
      );

      const signedTransaction =
        await signTransactionMessageWithSigners(transactionMessage);
      assertIsTransactionWithBlockhashLifetime(signedTransaction);

      const signature = getSignatureFromTransaction(signedTransaction);

      const sendOptions: { commitment: Commitment; abortSignal?: AbortSignal } =
        { commitment };
      if (options?.abortSignal) {
        sendOptions.abortSignal = options.abortSignal;
      }
      await sendAndConfirm(signedTransaction, sendOptions);

      return signature;
    },
  };
}

/**
 * Account sizes for rent calculation
 * SplitConfig: 1,832 bytes, Vault (Token Account): 165 bytes
 */
const SPLIT_CONFIG_SIZE = 1832n;
const TOKEN_ACCOUNT_SIZE = 165n;

/**
 * Check unclaimed amounts in a split config.
 * Returns the count of recipients with unclaimed amounts and total amount.
 */
export function checkUnclaimedAmounts(config: SplitConfig): {
  unclaimedCount: number;
  totalUnclaimed: bigint;
} {
  const unclaimedCount = config.unclaimedAmounts.filter(
    (u) => u.amount > 0n,
  ).length;
  const totalUnclaimed =
    config.unclaimedAmounts.reduce((sum, u) => sum + u.amount, 0n) +
    config.protocolUnclaimed;

  return { unclaimedCount, totalUnclaimed };
}

/**
 * Get the count of pending claimants (recipients + protocol if applicable)
 */
export function getPendingClaimantCount(config: SplitConfig): number {
  const { unclaimedCount } = checkUnclaimedAmounts(config);
  return unclaimedCount + (config.protocolUnclaimed > 0n ? 1 : 0);
}

/**
 * Calculate total rent for split config + vault.
 * Fetches minimum rent exemption from RPC.
 */
export async function calculateTotalRent(
  rpc: Rpc<SolanaRpcApi>,
): Promise<bigint> {
  const [splitConfigRent, vaultRent] = await Promise.all([
    rpc.getMinimumBalanceForRentExemption(SPLIT_CONFIG_SIZE).send(),
    rpc.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE).send(),
  ]);
  return splitConfigRent + vaultRent;
}

// =============================================================================
// Execution Preparation
// =============================================================================

/**
 * Result of prepareExecutionIfNeeded - either execution is not needed,
 * execution is prepared, or operation is blocked.
 */
export type ExecutionPreparation =
  | { needed: false }
  | {
      needed: true;
      executeInstruction: Instruction;
      atasToCreate: MissingAta[];
    }
  | { blocked: true; reason: BlockedReason; message: string };

/**
 * Prepare execution prerequisites for update/close operations.
 *
 * Checks vault state, unclaimed amounts, recipient ATAs, and builds
 * execution instruction if needed.
 *
 * @internal
 */
export async function prepareExecutionIfNeeded(params: {
  rpc: Rpc<SolanaRpcApi>;
  splitConfig: Address;
  wallet: SplitsWallet;
  existingConfig: SplitConfig;
  tokenProgram: Address;
  createMissingAtas: boolean;
}): Promise<ExecutionPreparation> {
  const {
    rpc,
    splitConfig,
    wallet,
    existingConfig,
    tokenProgram,
    createMissingAtas,
  } = params;

  // Check if vault has balance OR unclaimed amounts
  const vaultBalance = await getVaultBalance(rpc, existingConfig.vault);
  const { totalUnclaimed } = checkUnclaimedAmounts(existingConfig);
  const needsExecute = vaultBalance > 0n || totalUnclaimed > 0n;

  if (!needsExecute) {
    return { needed: false };
  }

  // Check recipient ATAs (for execute to distribute funds)
  const missingAtas = await checkRecipientAtas(
    rpc,
    existingConfig.recipients,
    existingConfig.mint,
  );

  if (missingAtas.length > 0 && !createMissingAtas) {
    return {
      blocked: true,
      reason: "recipient_atas_missing",
      message: recipientAtasMissingMessage(missingAtas.map((m) => m.recipient)),
    };
  }

  // Build execute instruction
  const execResult = await executeSplit({
    rpc,
    splitConfig,
    executor: wallet.address,
    tokenProgram,
  });

  if (execResult.status !== "success") {
    return {
      blocked: true,
      reason: "vault_not_empty",
      message: `Cannot execute split: ${execResult.status}`,
    };
  }

  return {
    needed: true,
    executeInstruction: execResult.instruction,
    atasToCreate: missingAtas,
  };
}

/**
 * Deduplicate ATA creation requests by ATA address.
 * Returns ATAs from `newAtas` that are not already in `existing`.
 *
 * @internal
 */
export function deduplicateAtas(
  existing: MissingAta[],
  newAtas: MissingAta[],
): MissingAta[] {
  const existingAddresses = new Set(existing.map((a) => a.ata));
  return newAtas.filter((a) => !existingAddresses.has(a.ata));
}
