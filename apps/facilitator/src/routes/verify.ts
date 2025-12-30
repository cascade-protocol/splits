/**
 * POST /verify
 *
 * Verifies a payment transaction without settling.
 * Implements RFC #646 verification:
 * - 3-6 instruction support
 * - CPI verification via simulation
 * - Deadline validator support
 */

import type { Context } from "hono";
import type { VerifyRequest, VerifyResponse } from "@x402/core/types";
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
  type CompiledTransactionMessage,
  type Address,
} from "@solana/kit";

export async function verifyHandler(c: Context<{ Bindings: Env }>) {
  const { FEE_PAYER_KEY, HELIUS_RPC_URL } = c.env;

  if (!FEE_PAYER_KEY || !HELIUS_RPC_URL) {
    return c.json({ error: "Server misconfigured" }, 500);
  }

  // Parse request body
  let body: VerifyRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        isValid: false,
        invalidReason: "invalid_request_body",
      } as VerifyResponse,
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
      { isValid: false, invalidReason: "unsupported_scheme" } as VerifyResponse,
      400,
    );
  }

  // Validate network match
  if (paymentPayload.accepted.network !== paymentRequirements.network) {
    return c.json(
      { isValid: false, invalidReason: "network_mismatch" } as VerifyResponse,
      400,
    );
  }

  // Extract transaction from payload
  const svmPayload = paymentPayload.payload as unknown as ExactSvmPayload;
  if (!svmPayload?.transaction) {
    return c.json(
      {
        isValid: false,
        invalidReason: "missing_transaction",
      } as VerifyResponse,
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
        isValid: false,
        invalidReason: "fee_payer_not_managed_by_facilitator",
      } as VerifyResponse,
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
        isValid: false,
        invalidReason: "invalid_transaction_encoding",
      } as VerifyResponse,
      400,
    );
  }

  // Sign transaction first (facilitator adds fee payer signature)
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
        isValid: false,
        invalidReason: `signing_failed: ${error instanceof Error ? error.message : "unknown"}`,
      } as VerifyResponse,
      400,
    );
  }

  // Simulate if needed (for CPI verification or general validation)
  let simulationResult: SimulationResult;
  try {
    simulationResult = await signer.simulateTransaction(
      signedTransaction,
      paymentRequirements.network,
    );
  } catch (error) {
    return c.json(
      {
        isValid: false,
        invalidReason: `simulation_failed: ${error instanceof Error ? error.message : "unknown"}`,
      } as VerifyResponse,
      400,
    );
  }

  // Verify transaction
  const result = await verifyTransaction(
    svmPayload.transaction,
    paymentRequirements,
    feePayerAddresses,
    needsSimulation ? simulationResult : undefined,
  );

  return c.json(result as VerifyResponse);
}
