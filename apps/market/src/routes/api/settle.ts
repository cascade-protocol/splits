/**
 * POST /api/settle
 *
 * Tabs settlement endpoint - creates a signed transaction from Tabs allowance.
 * This proxies to the Tabs executor (facilitator) which holds the signing key.
 *
 * Request: { apiKey: string, payTo: string, amount: string }
 * Response: { success: boolean, transaction?: string, error?: string }
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

// Tabs executor URL - where the signing key lives
const TABS_EXECUTOR_URL = "https://facilitator.cascade.fyi";

interface SettleRequest {
  apiKey: string;
  payTo: string;
  amount: string;
}

interface SettleResponse {
  success: boolean;
  transaction?: string;
  error?: string;
}

export const Route = createFileRoute("/api/settle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: SettleRequest;
        try {
          body = await request.json();
        } catch {
          return json<SettleResponse>(
            { success: false, error: "Invalid request body" },
            { status: 400 },
          );
        }

        const { apiKey, payTo, amount } = body;

        // Validate input
        if (!apiKey?.startsWith("tabs_")) {
          return json<SettleResponse>(
            { success: false, error: "Invalid API key format" },
            { status: 400 },
          );
        }

        if (!payTo || !amount) {
          return json<SettleResponse>(
            { success: false, error: "Missing payTo or amount" },
            { status: 400 },
          );
        }

        // Forward to Tabs executor
        try {
          const response = await fetch(`${TABS_EXECUTOR_URL}/api/tabs/settle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, payTo, amount }),
          });

          const result = (await response.json()) as SettleResponse;
          return json<SettleResponse>(result, { status: response.status });
        } catch (error) {
          console.error("Tabs settlement error:", error);

          // For development: Return a helpful error message
          // TODO: Implement /api/tabs/settle in the facilitator
          return json<SettleResponse>(
            {
              success: false,
              error:
                "Tabs executor not available. The /api/tabs/settle endpoint needs to be implemented in the facilitator.",
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
