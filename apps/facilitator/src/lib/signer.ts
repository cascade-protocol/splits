/**
 * Facilitator SVM Signer
 *
 * Handles signing, simulation, and broadcasting of Solana transactions.
 *
 * NOTE: This is a custom implementation, NOT using x402's `toFacilitatorSvmSigner()`.
 * Reason: We need `innerInstructions` from simulation for RFC #646 CPI verification.
 *
 * When smart wallets (e.g., Squads multisig) pay, the actual transfer happens via
 * Cross-Program Invocation (CPI) inside the multisig instruction. x402's signer
 * returns `void` from simulateTransaction() and doesn't request innerInstructions,
 * so it cannot verify CPI transfers. Our signer returns SimulationResult with
 * innerInstructions which validateCpiTransfer() uses to find and verify the
 * actual TransferChecked instruction inside the CPI.
 *
 * @see https://github.com/coinbase/x402/issues/646
 * @see validation.ts - validateCpiTransfer()
 */

import {
  type Address,
  type Signature,
  type Transaction,
  type Base64EncodedWireTransaction,
  type KeyPairSigner,
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
} from "@solana/kit";

// =============================================================================
// Types
// =============================================================================

export interface FacilitatorSigner {
  /** The underlying KeyPairSigner for SDK usage */
  keyPairSigner: KeyPairSigner;

  /** Get all fee payer addresses */
  getAddresses(): readonly Address[];

  /** Sign a partial transaction with the fee payer */
  signTransaction(
    transaction: string,
    feePayer: Address,
    network: string,
  ): Promise<string>;

  /** Simulate a transaction to verify it would succeed */
  simulateTransaction(
    transaction: string,
    network: string,
  ): Promise<SimulationResult>;

  /** Send a transaction to the network */
  sendTransaction(transaction: string, network: string): Promise<string>;

  /** Wait for transaction confirmation */
  confirmTransaction(signature: string, network: string): Promise<void>;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  logs?: string[];
  unitsConsumed?: bigint;
  innerInstructions?: InnerInstruction[];
}

export interface InnerInstruction {
  index: number;
  instructions: {
    programIdIndex: number;
    accounts: number[];
    data: string;
  }[];
}

// =============================================================================
// Transaction Utilities
// =============================================================================

export function decodeTransaction(base64Tx: string): Transaction {
  const base64Encoder = getBase64Encoder();
  const transactionBytes = base64Encoder.encode(base64Tx);
  const transactionDecoder = getTransactionDecoder();
  return transactionDecoder.decode(transactionBytes);
}

// =============================================================================
// Constants
// =============================================================================

const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// =============================================================================
// RPC Client Creation
// =============================================================================

function createRpc(network: string, rpcUrl: string) {
  // Validate network - currently only mainnet is supported
  if (network !== SOLANA_MAINNET_CAIP2) {
    throw new Error(
      `Unsupported network: ${network}. Only ${SOLANA_MAINNET_CAIP2} is supported.`,
    );
  }
  return createSolanaRpc(rpcUrl as `https://${string}`);
}

// =============================================================================
// Signer Factory
// =============================================================================

export async function createFacilitatorSigner(
  feePayerKeyBase58: string,
  rpcUrl: string,
): Promise<FacilitatorSigner> {
  // Decode the fee payer key using kit's base58 encoder (encode string → bytes)
  const base58Encoder = getBase58Encoder();
  const keyBytes = base58Encoder.encode(feePayerKeyBase58);
  const signer = await createKeyPairSignerFromBytes(keyBytes);

  return {
    keyPairSigner: signer,
    getAddresses: () => [signer.address],

    signTransaction: async (
      transaction: string,
      feePayer: Address,
      _network: string,
    ) => {
      if (feePayer !== signer.address) {
        throw new Error(
          `No signer for feePayer ${feePayer}. Available: ${signer.address}`,
        );
      }

      // Decode transaction
      const tx = decodeTransaction(transaction);

      // Sign the message
      const signableMessage = {
        content: tx.messageBytes,
        signatures: tx.signatures,
      };

      const [facilitatorSignature] = await signer.signMessages([
        signableMessage as never,
      ]);

      // Merge signatures
      const fullySignedTx = {
        ...tx,
        signatures: {
          ...tx.signatures,
          ...facilitatorSignature,
        },
      };

      return getBase64EncodedWireTransaction(fullySignedTx);
    },

    simulateTransaction: async (transaction: string, network: string) => {
      const rpc = createRpc(network, rpcUrl);

      const result = await rpc
        .simulateTransaction(transaction as Base64EncodedWireTransaction, {
          sigVerify: true,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          encoding: "base64",
          innerInstructions: true, // Request inner instructions for CPI verification
        })
        .send();

      if (result.value.err) {
        return {
          success: false,
          error: JSON.stringify(result.value.err),
          logs: result.value.logs ?? undefined,
        };
      }

      return {
        success: true,
        logs: result.value.logs ?? undefined,
        unitsConsumed: result.value.unitsConsumed ?? undefined,
        innerInstructions: result.value.innerInstructions as unknown as
          | InnerInstruction[]
          | undefined,
      };
    },

    sendTransaction: async (transaction: string, network: string) => {
      const rpc = createRpc(network, rpcUrl);

      return await rpc
        .sendTransaction(transaction as Base64EncodedWireTransaction, {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
        })
        .send();
    },

    confirmTransaction: async (signature: string, network: string) => {
      const rpc = createRpc(network, rpcUrl);

      let confirmed = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!confirmed && attempts < maxAttempts) {
        const status = await rpc
          .getSignatureStatuses([signature as Signature])
          .send();

        const txStatus = status.value[0];
        if (
          txStatus?.confirmationStatus === "confirmed" ||
          txStatus?.confirmationStatus === "finalized"
        ) {
          if (txStatus.err) {
            throw new Error(
              `Transaction failed: ${JSON.stringify(txStatus.err)}`,
            );
          }
          confirmed = true;
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }

      throw new Error("Transaction confirmation timeout");
    },
  };
}
