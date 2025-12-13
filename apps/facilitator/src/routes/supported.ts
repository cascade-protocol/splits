/**
 * GET /supported
 *
 * Returns facilitator capabilities - supported schemes, networks, and extensions.
 */

import type { Context } from "hono";
import type { SupportedResponse } from "@x402/core/types";
import type { Env } from "../types.js";
import { createFacilitatorSigner } from "../lib/signer.js";

// Solana mainnet CAIP-2 identifier
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export async function supportedHandler(c: Context<{ Bindings: Env }>) {
  const { FEE_PAYER_KEY, HELIUS_RPC_URL } = c.env;

  if (!FEE_PAYER_KEY || !HELIUS_RPC_URL) {
    return c.json({ error: "Server misconfigured" }, 500);
  }

  // Get fee payer address
  const signer = await createFacilitatorSigner(FEE_PAYER_KEY, HELIUS_RPC_URL);
  const addresses = signer.getAddresses();
  const feePayer = addresses[0];

  const response: SupportedResponse = {
    kinds: [
      {
        x402Version: 2,
        scheme: "exact",
        network: SOLANA_MAINNET,
        extra: {
          feePayer,
        },
      },
    ],
    // RFC #646 extensions
    extensions: [
      "cpi-verification", // Smart wallet CPI support via simulation
      "deadline-validator", // maxTimeoutSeconds enforcement
      "durable-nonce", // Extended timeouts (>90s)
    ],
    signers: {
      "solana:*": [...addresses],
    },
  };

  return c.json(response);
}
