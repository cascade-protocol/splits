/**
 * POST /settle
 *
 * Settles a payment by verifying and broadcasting the transaction.
 */

import type { Context } from "hono";
import type { SettleRequest, SettleResponse } from "@x402/core/types";
import type { Env, ExactSvmPayload } from "../types.js";
import {
  createFacilitatorSigner,
  type SimulationResult,
} from "../lib/signer.js";
import {
  verifyTransaction,
  detectInstructionLayout,
} from "../lib/validation.js";
import { decodeTransaction } from "../lib/signer.js";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  createSolanaRpc,
  type CompiledTransactionMessage,
  type Address,
} from "@solana/kit";
import { executeAndSendSplit } from "@cascade-fyi/splits-sdk";

export async function settleHandler(c: Context<{ Bindings: Env }>) {
  const { FEE_PAYER_KEY, HELIUS_RPC_URL } = c.env;

  if (!FEE_PAYER_KEY || !HELIUS_RPC_URL) {
    return c.json({ error: "Server misconfigured" }, 500);
  }

  // Parse request body
  let body: SettleRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        errorReason: "invalid_request_body",
        transaction: "",
        network: "unknown:unknown",
      } satisfies SettleResponse,
      400,
    );
  }

  const { paymentPayload, paymentRequirements } = body;

  // Validate scheme
  if (
    paymentPayload.accepted.scheme !== "exact" ||
    paymentRequirements.scheme !== "exact"
  ) {
    return c.json(
      {
        success: false,
        errorReason: "unsupported_scheme",
        transaction: "",
        network: paymentPayload.accepted.network,
      } as SettleResponse,
      400,
    );
  }

  // Validate network match
  if (paymentPayload.accepted.network !== paymentRequirements.network) {
    return c.json(
      {
        success: false,
        errorReason: "network_mismatch",
        transaction: "",
        network: paymentPayload.accepted.network,
      } as SettleResponse,
      400,
    );
  }

  // Extract transaction from payload
  const svmPayload = paymentPayload.payload as unknown as ExactSvmPayload;
  if (!svmPayload?.transaction) {
    return c.json(
      {
        success: false,
        errorReason: "missing_transaction",
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Create signer
  const signer = await createFacilitatorSigner(FEE_PAYER_KEY, HELIUS_RPC_URL);
  const feePayerAddresses = [...signer.getAddresses()].map((a) => a.toString());

  // Validate fee payer in requirements
  const requestedFeePayer = paymentRequirements.extra?.feePayer;
  if (
    typeof requestedFeePayer !== "string" ||
    !feePayerAddresses.includes(requestedFeePayer)
  ) {
    return c.json(
      {
        success: false,
        errorReason: "fee_payer_not_managed_by_facilitator",
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Detect if we need simulation (for CPI transactions)
  let needsSimulation = false;
  try {
    const tx = decodeTransaction(svmPayload.transaction);
    const compiled = getCompiledTransactionMessageDecoder().decode(
      tx.messageBytes,
    ) as CompiledTransactionMessage;
    // Add dummy lifetimeToken for decompilation (not used in validation)
    const compiledWithLifetime = {
      ...compiled,
      lifetimeToken: "11111111111111111111111111111111" as const,
    };
    const decompiled = decompileTransactionMessage(compiledWithLifetime);
    const instructions = decompiled.instructions ?? [];
    const layout = detectInstructionLayout(instructions);

    if (layout && !layout.isDirectTransfer) {
      needsSimulation = true;
    }
  } catch {
    return c.json(
      {
        success: false,
        errorReason: "invalid_transaction_encoding",
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Sign transaction (facilitator adds fee payer signature)
  let signedTransaction: string;
  try {
    signedTransaction = await signer.signTransaction(
      svmPayload.transaction,
      requestedFeePayer as Address,
      paymentRequirements.network,
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        errorReason: `signing_failed: ${error instanceof Error ? error.message : "unknown"}`,
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Simulate transaction
  let simulationResult: SimulationResult;
  try {
    simulationResult = await signer.simulateTransaction(
      signedTransaction,
      paymentRequirements.network,
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        errorReason: `simulation_failed: ${error instanceof Error ? error.message : "unknown"}`,
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Verify transaction
  const verifyResult = await verifyTransaction(
    svmPayload.transaction,
    paymentRequirements,
    feePayerAddresses,
    needsSimulation ? simulationResult : undefined,
  );

  if (!verifyResult.isValid) {
    return c.json(
      {
        success: false,
        errorReason: verifyResult.invalidReason ?? "verification_failed",
        payer: verifyResult.payer,
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Send transaction
  let signature: string;
  try {
    signature = await signer.sendTransaction(
      signedTransaction,
      paymentRequirements.network,
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        errorReason: `send_failed: ${error instanceof Error ? error.message : "unknown"}`,
        payer: verifyResult.payer,
        transaction: "",
        network: paymentRequirements.network,
      } as SettleResponse,
      400,
    );
  }

  // Wait for confirmation
  try {
    await signer.confirmTransaction(signature, paymentRequirements.network);
  } catch {
    // Transaction was sent but confirmation failed/timed out
    // Return success with the signature - the transaction may still land
    return c.json({
      success: true,
      payer: verifyResult.payer,
      transaction: signature,
      network: paymentRequirements.network,
    } as SettleResponse);
  }

  // Execute split if payTo is a Cascade split (fire and forget)
  const rpc = createSolanaRpc(HELIUS_RPC_URL as `https://${string}`);
  executeAndSendSplit({
    rpc,
    splitConfig: paymentRequirements.payTo as Address,
    signer: signer.keyPairSigner,
  }).then((r) => {
    if (r.sent) {
      console.log(`[splits] Executed: ${r.signature}`);
    } else if (r.reason !== "not_a_split") {
      console.warn(`[splits] Skipped: ${r.reason}`, r.error);
    }
  });

  return c.json({
    success: true,
    payer: verifyResult.payer,
    transaction: signature,
    network: paymentRequirements.network,
  } as SettleResponse);
}
