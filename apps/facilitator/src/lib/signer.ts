/**
 * Facilitator SVM Signer
 *
 * Uses @x402/svm's `toFacilitatorSvmSigner()` for standard operations
 * (signing, sending, confirming). Adds a separate `simulateForCpi()` for
 * RFC #646 CPI verification, which needs `innerInstructions` from the RPC
 * response - something the upstream signer doesn't expose.
 *
 * @see https://github.com/coinbase/x402/issues/646
 * @see validation.ts - verifyCpiTransfer()
 */

import {
  type KeyPairSigner,
  type Transaction,
  type Base64EncodedWireTransaction,
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getBase64Encoder,
  getTransactionDecoder,
} from "@solana/kit";
import {
  toFacilitatorSvmSigner,
  createRpcClient,
  SOLANA_MAINNET_CAIP2,
  type FacilitatorSvmSigner,
} from "@x402/svm";

// Re-export for consumers
export type { FacilitatorSvmSigner };

// =============================================================================
// CPI Simulation Types (not in @x402/svm)
// =============================================================================

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
// Signer + CPI Simulation
// =============================================================================

export interface FacilitatorContext {
  /** Standard x402 signer for sign/send/confirm */
  signer: FacilitatorSvmSigner;
  /** KeyPairSigner for Cascade splits execution */
  keyPairSigner: KeyPairSigner;
  /** Simulate with innerInstructions for CPI verification */
  simulateForCpi: (
    transaction: string,
    network: string,
  ) => Promise<SimulationResult>;
}

export async function createFacilitatorContext(
  feePayerKeyBase58: string,
  rpcUrl: string,
): Promise<FacilitatorContext> {
  const base58Encoder = getBase58Encoder();
  const keyBytes = base58Encoder.encode(feePayerKeyBase58);
  const keyPairSigner = await createKeyPairSignerFromBytes(keyBytes);

  const rpc = createRpcClient(SOLANA_MAINNET_CAIP2, rpcUrl);
  // Pass as explicit network map - the Proxy-based RPC from @solana/kit
  // fails the `"getBalance" in rpc` detection in toFacilitatorSvmSigner
  const signer = toFacilitatorSvmSigner(keyPairSigner, {
    [SOLANA_MAINNET_CAIP2]: rpc,
  });

  return {
    signer,
    keyPairSigner,
    simulateForCpi: async (transaction: string, _network: string) => {
      const result = await rpc
        .simulateTransaction(transaction as Base64EncodedWireTransaction, {
          sigVerify: true,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          encoding: "base64",
          innerInstructions: true,
        })
        .send();

      if (result.value.err) {
        return {
          success: false,
          error: JSON.stringify(result.value.err, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
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
  };
}
