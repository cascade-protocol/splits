/**
 * x402 Payment Building
 *
 * Composes tabs-sdk primitives for the CLI's payment flow.
 * Builds spending limit transactions for automatic MCP payments.
 */

import {
  type Address,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
  createSolanaRpc,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  deriveSpendingLimit,
  deriveAta,
  fetchSmartAccountStateByOwner,
  fetchMaybeSpendingLimit,
  getUseSpendingLimitInstruction,
  SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ID,
} from "@cascade-fyi/tabs-sdk";

const GATEWAY_URL = "https://market.cascade.fyi";

/**
 * PaymentRequirements from 402 JSON-RPC error.
 */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { executorKey?: string; feePayer?: string };
}

/**
 * x402 payment payload for retry.
 */
export interface PaymentPayload {
  x402Version: number;
  accepted: PaymentRequirements;
  payload: { transaction: string };
}

/**
 * Build unsigned spending limit transaction.
 *
 * Composes tabs-sdk primitives for CLI's payment flow.
 * The transaction is unsigned - executor signature added by Gateway /sign.
 *
 * @param rpc - Solana RPC client
 * @param userWallet - User's wallet address (settings authority)
 * @param executorAddress - Gateway executor address (from 402 requirements)
 * @param destination - Split vault ATA (payTo from requirements)
 * @param amount - Amount in token base units
 * @param mint - Token mint address
 * @returns Base64-encoded unsigned transaction
 */
export async function buildSpendingLimitTx(
  rpc: Rpc<SolanaRpcApi>,
  userWallet: Address,
  executorAddress: Address,
  destination: Address,
  amount: bigint,
  mint: Address,
): Promise<{ unsignedTx: string; spendingLimitPda: Address }> {
  // 1. Discover user's Tabs account
  const state = await fetchSmartAccountStateByOwner(
    rpc,
    userWallet,
    executorAddress,
    mint,
  );
  if (!state) {
    throw new Error("No Tabs account found. Set up at market.cascade.fyi/pay");
  }

  // 2. Derive PDAs
  const spendingLimitPda = await deriveSpendingLimit(
    state.address,
    executorAddress,
  );
  const vaultAta = await deriveAta(state.vaultAddress, mint);

  // 3. Verify spending limit exists and has balance
  const spendingLimit = await fetchMaybeSpendingLimit(rpc, spendingLimitPda);
  if (!spendingLimit.exists) {
    throw new Error(
      "No spending limit for Gateway executor. Set up at market.cascade.fyi/pay",
    );
  }
  if (spendingLimit.data.remainingAmount < amount) {
    throw new Error(
      `Insufficient spending limit: ${spendingLimit.data.remainingAmount} < ${amount}`,
    );
  }

  // 4. Build useSpendingLimit instruction
  // Create a fake signer object - actual signing happens on Gateway
  const executorSigner = { address: executorAddress } as TransactionSigner;

  const ix = getUseSpendingLimitInstruction({
    settings: state.address,
    signer: executorSigner,
    spendingLimit: spendingLimitPda,
    smartAccount: state.vaultAddress,
    destination,
    mint,
    smartAccountTokenAccount: vaultAta,
    destinationTokenAccount: destination, // Already an ATA (split vault)
    tokenProgram: TOKEN_PROGRAM_ID as Address,
    program: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    amount,
    decimals: 6, // USDC
    memo: null,
  });

  // 5. Build transaction (fee payer = executor per x402 spec)
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(executorAddress, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstruction(ix, tx),
  );

  const transaction = compileTransaction(txMessage);
  const unsignedTx = getBase64EncodedWireTransaction(transaction);

  return { unsignedTx, spendingLimitPda };
}

/**
 * Sign transaction via Gateway /sign endpoint.
 *
 * Gateway adds executor signature to the transaction.
 *
 * @param unsignedTx - Base64-encoded unsigned transaction
 * @param accessToken - User's OAuth access token
 * @param wallet - User's wallet address
 * @param splitVault - Split vault address
 * @param price - Payment amount (for validation)
 * @returns Base64-encoded signed transaction
 */
export async function signWithExecutor(
  unsignedTx: string,
  accessToken: string,
  wallet: string,
  splitVault: string,
  price: string,
): Promise<string> {
  const resp = await fetch(`${GATEWAY_URL}/sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ unsignedTx, wallet, splitVault, price }),
  });

  if (!resp.ok) {
    const error = (await resp.json()) as { message?: string };
    throw new Error(error.message || "Signing failed");
  }

  const { transaction } = (await resp.json()) as { transaction: string };
  return transaction;
}

/**
 * Build complete x402 payment payload for retry.
 *
 * @param creds - User credentials (accessToken, walletAddress)
 * @param requirements - Payment requirements from 402 error
 * @param rpcUrl - Solana RPC URL
 * @returns Payment payload to include in retry request
 */
export async function buildPaymentPayload(
  creds: { accessToken: string; walletAddress: string },
  requirements: PaymentRequirements,
  rpcUrl: string,
): Promise<PaymentPayload> {
  const rpc = createSolanaRpc(rpcUrl);
  const executorAddress = requirements.extra?.executorKey as Address;

  if (!executorAddress) {
    throw new Error("Payment requirements missing executorKey");
  }

  // Build unsigned tx
  const { unsignedTx } = await buildSpendingLimitTx(
    rpc,
    creds.walletAddress as Address,
    executorAddress,
    requirements.payTo as Address,
    BigInt(requirements.amount),
    requirements.asset as Address,
  );

  // Get executor signature from /sign
  const signedTx = await signWithExecutor(
    unsignedTx,
    creds.accessToken,
    creds.walletAddress,
    requirements.payTo,
    requirements.amount,
  );

  return {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction: signedTx },
  };
}
