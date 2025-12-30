/**
 * Facilitator-specific Types
 *
 * Core x402 types should be imported directly from @x402/core/types
 */

// =============================================================================
// Exact SVM Payload Types
// =============================================================================

/** Payload for exact scheme on Solana (base64-encoded transaction) */
export interface ExactSvmPayload {
  transaction: string;
}

// =============================================================================
// Cloudflare Bindings
// =============================================================================

export interface Env {
  FEE_PAYER_KEY: string;
  HELIUS_RPC_URL: string;
}
