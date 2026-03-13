/**
 * MCP Proxy Command
 *
 * Stdio JSON-RPC relay with x402 payment handling.
 * This is invoked by Claude Code when it starts the MCP server.
 *
 * Flow for each request:
 * 1. Read JSON-RPC request from stdin
 * 2. Forward to Gateway
 * 3. If 402 error, build payment and retry
 * 4. Write response to stdout
 */

import { buildCommand, type CommandContext } from "@stricli/core";
import { createInterface } from "node:readline";
import { loadCredentials, refreshIfNeeded } from "../../lib/auth";
import { buildPaymentPayload, type PaymentRequirements } from "../../lib/x402";

const GATEWAY_URL = "https://market.cascade.fyi";
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

/**
 * JSON-RPC request (MCP transport).
 */
interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: {
    _meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
  id?: string | number | null;
}

/**
 * JSON-RPC response (MCP transport).
 */
interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: { _meta?: Record<string, unknown>; [key: string]: unknown };
  error?: { code: number; message: string; data?: unknown };
  id: string | number | null;
}

/**
 * x402 payment requirements from 402 JSON-RPC error.
 */
interface X402Requirements {
  x402Version: number;
  accepts: PaymentRequirements[];
}

/**
 * Send error response to stdout.
 */
function sendError(
  id: string | number | null,
  code: number,
  message: string,
): void {
  const response: JSONRPCResponse = {
    jsonrpc: "2.0",
    error: { code, message },
    id,
  };
  console.log(JSON.stringify(response));
}

/**
 * Run the stdio proxy.
 */
async function runProxy(service: string): Promise<void> {
  // Load credentials
  let creds = await loadCredentials();
  if (!creds) {
    // Output error in JSON-RPC format for Claude Code to display
    process.stderr.write("Not logged in. Run: cascade login\n");
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  const rpcUrl = process.env.HELIUS_RPC_URL || DEFAULT_RPC_URL;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let request: JSONRPCRequest;
    try {
      request = JSON.parse(line) as JSONRPCRequest;
    } catch {
      sendError(null, -32700, "Parse error");
      continue;
    }

    // Refresh token if needed
    const refreshed = await refreshIfNeeded(creds);
    if (!refreshed) {
      sendError(
        request.id ?? null,
        -32001,
        "Session expired. Run: cascade login",
      );
      continue;
    }
    creds = refreshed;

    try {
      // First attempt - no payment
      let resp = await fetch(`${GATEWAY_URL}/mcps/${service}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      let body: JSONRPCResponse = await resp.json();

      // Handle 402 (JSON-RPC error code 402, HTTP 200 per MCP spec)
      if (body.error?.code === 402) {
        const requirements = body.error.data as X402Requirements;

        if (!requirements?.accepts?.length) {
          sendError(
            request.id ?? null,
            402,
            "Payment required but no payment options available",
          );
          continue;
        }

        // Build payment payload
        const firstOption = requirements.accepts[0];
        if (!firstOption) {
          sendError(request.id ?? null, 402, "No valid payment option");
          continue;
        }
        const paymentPayload = await buildPaymentPayload(
          creds,
          firstOption,
          rpcUrl,
        );

        // Retry with payment in params._meta
        const requestWithPayment: JSONRPCRequest = {
          ...request,
          params: {
            ...request.params,
            _meta: {
              ...request.params?._meta,
              "x402/payment": paymentPayload,
            },
          },
        };

        resp = await fetch(`${GATEWAY_URL}/mcps/${service}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestWithPayment),
        });

        body = await resp.json();
      }

      // Output response to stdout for Claude Code
      console.log(JSON.stringify(body));
    } catch (error) {
      sendError(
        request.id ?? null,
        -32603,
        error instanceof Error ? error.message : "Internal error",
      );
    }
  }
}

export const proxyCommand = buildCommand({
  docs: {
    brief: "Stdio proxy for MCP requests (internal)",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Service path (e.g., @cascade/twitter)",
          parse: String,
        },
      ],
    },
  },
  async func(this: CommandContext, _: object, service: string) {
    await runProxy(service);
  },
});
