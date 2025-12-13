/**
 * GET /api/echo/resource
 *
 * Demo x402 resource for Tabs testing.
 * Uses x402 primitives to integrate with the facilitator.
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type ResourceConfig,
  type ResourceInfo,
} from "@x402/core/server";
import type { PaymentPayload, Network } from "@x402/core/types";

// Facilitator URL
const FACILITATOR_URL = "https://facilitator.cascade.fyi";

// Demo payTo address - facilitator's fee payer
const DEMO_PAY_TO = "CMdouXzA7neGHzUcX5ZwKrceqhQK6duTpLA56cwZfVF6";

export const Route = createFileRoute("/api/echo/resource")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Create facilitator client and resource server
        const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
        const resourceServer = new x402ResourceServer(facilitator);

        // Initialize to fetch supported kinds from facilitator
        await resourceServer.initialize();

        // Resource configuration
        const resourceConfig: ResourceConfig = {
          scheme: "exact",
          network: "solana:mainnet" as Network,
          price: "$0.01", // Human-readable, server converts to asset amount
          payTo: DEMO_PAY_TO,
          maxTimeoutSeconds: 60,
        };

        const resourceInfo: ResourceInfo = {
          url: new URL(request.url).href,
          description: "Echo demo resource",
          mimeType: "application/json",
        };

        // Check for payment header
        const paymentHeader = request.headers.get("X-PAYMENT");

        // Use processPaymentRequest for high-level flow
        const paymentPayload = paymentHeader
          ? (JSON.parse(atob(paymentHeader)) as PaymentPayload)
          : null;

        try {
          const result = await resourceServer.processPaymentRequest(
            paymentPayload,
            resourceConfig,
            resourceInfo,
          );

          // Payment required
          if (!result.success && result.requiresPayment) {
            return json(result.requiresPayment, { status: 402 });
          }

          // Verification failed
          if (!result.success && result.verificationResult) {
            return json(
              {
                error: "Payment verification failed",
                reason: result.verificationResult.invalidReason,
              },
              { status: 402 },
            );
          }

          // Settlement failed
          if (!result.success && result.settlementResult) {
            return json(
              {
                error: "Payment settlement failed",
                reason: result.settlementResult.errorReason,
              },
              { status: 402 },
            );
          }

          // Generic failure
          if (!result.success) {
            return json(
              { error: result.error ?? "Payment processing failed" },
              { status: 400 },
            );
          }

          // Success - return echo response with settlement data
          return json({
            success: true,
            message: "Echo! Payment received and settled.",
            data: {
              transaction: result.settlementResult?.transaction,
              network: result.settlementResult?.network,
            },
          });
        } catch (error) {
          console.error("Echo resource error:", error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Payment processing failed",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
