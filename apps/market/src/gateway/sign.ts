/**
 * Tabs Transaction Signing Endpoint
 *
 * Per ADR-0004 §5.4: POST /sign
 * Signs spending limit transactions with Gateway's executor key.
 *
 * This enables "invisible payments" - CLI builds unsigned tx,
 * Gateway co-signs with executor key (has SpendingLimit authority).
 */

import type { Context } from "hono";
import {
  type Address,
  type CompiledTransactionMessage,
  type Rpc,
  type SolanaRpcApi,
  type Transaction,
  createSolanaRpc,
  getBase64Encoder,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  createKeyPairSignerFromBytes,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
} from "@solana/kit";
import {
  base58Decode,
  fetchMaybeSpendingLimit,
  deriveSpendingLimit,
  parseUseSpendingLimitInstruction,
  USE_SPENDING_LIMIT_DISCRIMINATOR,
  SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
} from "@cascade-fyi/tabs-sdk";
import type { AuthProps } from "../server";

/**
 * Sign endpoint bindings - extends global Env with:
 * - AUTH_PROPS: injected by apiHandler after OAuth validation
 * - Secrets: defined in Cloudflare dashboard
 */
interface Bindings extends Env {
  AUTH_PROPS?: AuthProps;
  EXECUTOR_KEY: string;
  HELIUS_RPC_URL: string;
}

// Rate limit config for /sign endpoint
const SIGN_RATE_LIMIT = { limit: 30, windowSec: 60 }; // 30 req/min per wallet

/**
 * Check rate limit using KV with sliding window
 */
async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `ratelimit:${key}:${Math.floor(now / windowSec)}`;

  const current = Number.parseInt((await kv.get(windowKey)) || "0", 10);
  if (current >= limit) {
    return false;
  }

  await kv.put(windowKey, String(current + 1), {
    expirationTtl: windowSec * 2,
  });
  return true;
}

// Request/Response types per ADR-0004 §5.4
interface SignRequest {
  unsignedTx: string; // base64 serialized transaction
  wallet: string; // user wallet address (for validation)
  // Service config for transaction validation
  splitVault: string; // expected destination vault
  price: string; // expected amount in USDC base units
}

// Response types per ADR-0004 §5.4
interface SignResponse {
  transaction: string; // base64 signed transaction
}

interface SignErrorResponse {
  error: string;
  message: string;
}

/**
 * Validate spending limit transaction before signing.
 *
 * Security critical: The facilitator only verifies the x402 payment, but /sign
 * receives a DIFFERENT transaction. A malicious client could pass a valid payment
 * then send a malicious transaction here. We MUST independently validate.
 *
 * Checks:
 * 1. Transaction contains useSpendingLimit instruction
 * 2. Destination matches expected service vault
 * 3. Amount matches expected price
 * 4. Spending limit PDA is valid
 * 5. Sufficient remaining balance
 * 6. Not expired
 * 7. Destination in whitelist (if restricted)
 */
async function validateSpendingLimitTx(
  rpc: Rpc<SolanaRpcApi>,
  transaction: Transaction,
  expectedVault: Address,
  expectedAmount: bigint,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    // 1. Decompile transaction to access instructions
    const compiled = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    ) as CompiledTransactionMessage;
    const compiledWithLifetime = {
      ...compiled,
      lifetimeToken: "11111111111111111111111111111111" as const,
    };
    const decompiled = decompileTransactionMessage(compiledWithLifetime);
    const instructions = decompiled.instructions ?? [];

    // 2. Verify exactly one instruction (prevent injection attacks)
    // Attacker could add malicious instructions alongside valid useSpendingLimit
    if (instructions.length !== 1) {
      return {
        valid: false,
        reason: `Expected exactly 1 instruction, found ${instructions.length}`,
      };
    }

    // 3. Verify the single instruction is useSpendingLimit
    const useSpendingLimitIx = instructions.find((ix) => {
      if (
        ix.programAddress.toString() !==
        SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS.toString()
      ) {
        return false;
      }
      const data = ix.data;
      if (!data || data.length < 8) return false;
      return USE_SPENDING_LIMIT_DISCRIMINATOR.every((b, i) => b === data[i]);
    });

    if (!useSpendingLimitIx) {
      return { valid: false, reason: "No spending limit instruction found" };
    }

    // 4. Parse instruction (as never follows codebase pattern for Codama types)
    const parsed = parseUseSpendingLimitInstruction(
      useSpendingLimitIx as never,
    );

    // 5. Verify destination token account matches service vault
    const destinationTokenAccount = parsed.accounts.destinationTokenAccount;
    if (!destinationTokenAccount) {
      return { valid: false, reason: "Missing destination token account" };
    }
    if (destinationTokenAccount.address !== expectedVault) {
      return {
        valid: false,
        reason: `Destination ${destinationTokenAccount.address} does not match expected vault ${expectedVault}`,
      };
    }

    // 6. Verify amount matches expected price
    if (parsed.data.amount !== expectedAmount) {
      return {
        valid: false,
        reason: `Amount ${parsed.data.amount} does not match expected ${expectedAmount}`,
      };
    }

    // 7. Verify spending limit PDA is valid
    const settingsAddress = parsed.accounts.settings.address;
    const signerAddress = parsed.accounts.signer.address;
    const derivedSpendingLimitPda = await deriveSpendingLimit(
      settingsAddress,
      signerAddress,
    );

    if (parsed.accounts.spendingLimit.address !== derivedSpendingLimitPda) {
      return { valid: false, reason: "Invalid spending limit PDA" };
    }

    // 8. Fetch spending limit and check remaining balance + expiration
    const spendingLimit = await fetchMaybeSpendingLimit(
      rpc,
      derivedSpendingLimitPda,
    );

    if (!spendingLimit.exists) {
      return { valid: false, reason: "Spending limit account not found" };
    }

    if (spendingLimit.data.remainingAmount < parsed.data.amount) {
      return {
        valid: false,
        reason: `Insufficient remaining: ${spendingLimit.data.remainingAmount} < ${parsed.data.amount}`,
      };
    }

    // 9. Check expiration (0n means no expiration)
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (
      spendingLimit.data.expiration !== 0n &&
      spendingLimit.data.expiration < now
    ) {
      return { valid: false, reason: "Spending limit expired" };
    }

    // 10. Check destinations whitelist (if restricted)
    if (spendingLimit.data.destinations.length > 0) {
      const dest = parsed.accounts.destination.address;
      if (!spendingLimit.data.destinations.some((d) => d === dest)) {
        return { valid: false, reason: "Destination not in whitelist" };
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `Validation error: ${error instanceof Error ? error.message : "Unknown"}`,
    };
  }
}

/**
 * POST /sign handler
 *
 * Note: Bearer token is already validated by OAuthProvider before reaching gateway.
 * c.env.AUTH_PROPS.walletAddress contains the authenticated wallet address.
 *
 * 1. Check rate limit
 * 2. Parse request body
 * 3. Validate wallet matches authenticated user
 * 4. Validate spending limit transaction
 * 5. Sign with executor key
 * 6. Return signed transaction
 */
export async function signHandler(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response> {
  // Get authenticated wallet address from OAuthProvider
  const walletAddress = c.env.AUTH_PROPS?.walletAddress;
  if (!walletAddress) {
    return c.json<SignErrorResponse>(
      { error: "unauthorized", message: "Authentication required" },
      401,
    );
  }

  // 1. Check rate limit (per wallet)
  const rateLimitKey = `sign:${walletAddress}`;
  const allowed = await checkRateLimit(
    c.env.KV,
    rateLimitKey,
    SIGN_RATE_LIMIT.limit,
    SIGN_RATE_LIMIT.windowSec,
  );

  if (!allowed) {
    return c.json<SignErrorResponse>(
      {
        error: "rate_limit_exceeded",
        message: "Too many signing requests. Please try again later.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(SIGN_RATE_LIMIT.windowSec) },
      },
    );
  }

  // 2. Parse request body
  let body: SignRequest;
  try {
    body = await c.req.json<SignRequest>();
  } catch {
    return c.json<SignErrorResponse>(
      { error: "invalid_request", message: "Invalid JSON body" },
      400,
    );
  }

  if (!body.unsignedTx || !body.wallet || !body.splitVault || !body.price) {
    return c.json<SignErrorResponse>(
      {
        error: "invalid_request",
        message:
          "Missing required fields: unsignedTx, wallet, splitVault, price",
      },
      400,
    );
  }

  // 3. Validate wallet matches authenticated user
  if (body.wallet !== walletAddress) {
    return c.json<SignErrorResponse>(
      {
        error: "forbidden",
        message: "Wallet does not match authenticated user",
      },
      403,
    );
  }

  // 4. Get executor key and sign
  const executorKey = c.env.EXECUTOR_KEY;
  if (!executorKey) {
    console.error("EXECUTOR_KEY not configured");
    return c.json<SignErrorResponse>(
      { error: "server_error", message: "Signing not configured" },
      500,
    );
  }

  try {
    // 5. Decode executor keypair from base58 env var
    const executorBytes = base58Decode(executorKey);
    const executorSigner = await createKeyPairSignerFromBytes(executorBytes);

    // 6. Decode transaction from base64
    const base64Encoder = getBase64Encoder();
    const transactionBytes = base64Encoder.encode(body.unsignedTx);
    const transactionDecoder = getTransactionDecoder();
    const transaction = transactionDecoder.decode(transactionBytes);

    // 7. Validate transaction before signing (security critical)
    const rpc = createSolanaRpc(c.env.HELIUS_RPC_URL);
    const validation = await validateSpendingLimitTx(
      rpc,
      transaction,
      body.splitVault as Address,
      BigInt(body.price),
    );

    if (!validation.valid) {
      return c.json<SignErrorResponse>(
        {
          error: "invalid_transaction",
          message: validation.reason || "Transaction validation failed",
        },
        400,
      );
    }

    // 8. Sign the transaction message
    const signableMessage = {
      content: transaction.messageBytes,
      signatures: transaction.signatures,
    };

    const [executorSignature] = await executorSigner.signMessages([
      signableMessage as never,
    ]);

    // 9. Merge signatures
    const signedTx = {
      ...transaction,
      signatures: {
        ...transaction.signatures,
        ...executorSignature,
      },
    };

    // 10. Encode and return
    const signedBase64 = getBase64EncodedWireTransaction(signedTx);

    // 11. Audit log (W8: executor action forensics)
    // Non-blocking - writeDataPoint returns immediately
    c.env.AUDIT.writeDataPoint({
      blobs: [walletAddress, body.splitVault], // wallet, destination vault
      doubles: [Number(body.price), Date.now()], // amount, timestamp
      indexes: [walletAddress], // sampling key
    });

    return c.json<SignResponse>({ transaction: signedBase64 });
  } catch (error) {
    console.error("Signing error:", error);
    return c.json<SignErrorResponse>(
      {
        error: "signing_failed",
        message:
          error instanceof Error ? error.message : "Unknown signing error",
      },
      500,
    );
  }
}
