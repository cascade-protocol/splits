/**
 * tabsFetch - x402 Payment Client
 *
 * Drop-in fetch replacement for paying x402-enabled APIs with Tabs API keys.
 */

const DEFAULT_FACILITATOR_URL = "https://tabs.cascade.fyi";

export interface TabsFetchOptions extends RequestInit {
  /** Tabs API key (required, starts with 'tabs_') */
  tabsApiKey: string;
  /** Tabs facilitator URL (defaults to https://tabs.cascade.fyi) */
  facilitatorUrl?: string;
  /** Network preference for payment selection (defaults to 'solana') */
  network?: "solana" | "solana-devnet";
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  description?: string;
  extra?: Record<string, unknown>;
}

/** Error thrown when payment fails */
export class TabsPaymentError extends Error {
  readonly code = "PAYMENT_FAILED";
  constructor(
    message: string,
    readonly facilitatorError?: string,
    readonly paymentRequirements?: PaymentRequirements,
  ) {
    super(message);
    this.name = "TabsPaymentError";
  }
}

/**
 * Fetch a URL, automatically handling x402 payment if required.
 *
 * @example
 * ```typescript
 * import { tabsFetch } from '@cascade-fyi/tabs-sdk';
 *
 * const response = await tabsFetch('https://api.example.com/resource', {
 *   tabsApiKey: 'tabs_abc123...',
 * });
 * ```
 */
export async function tabsFetch(
  url: string | URL,
  options: TabsFetchOptions,
): Promise<Response> {
  const {
    tabsApiKey,
    facilitatorUrl = DEFAULT_FACILITATOR_URL,
    network = "solana",
    ...fetchOptions
  } = options;

  // Basic validation
  if (!tabsApiKey.startsWith("tabs_")) {
    throw new Error("Invalid Tabs API key");
  }

  // Initial request
  const response = await fetch(url, fetchOptions);
  if (response.status !== 402) return response;

  // Parse 402
  const body = (await response.json()) as {
    accepts?: PaymentRequirements[];
  };
  if (!body.accepts?.length) {
    throw new TabsPaymentError("No payment options in 402 response");
  }

  // Select Solana payment option
  const req =
    body.accepts.find((r) => r.network === network) ??
    body.accepts.find(
      (r) => r.network === "solana" || r.network === "solana-devnet",
    );
  if (!req) {
    throw new TabsPaymentError(
      `No Solana payment option. Available: ${body.accepts.map((a) => a.network).join(", ")}`,
    );
  }

  const amount = BigInt(req.maxAmountRequired);

  // Settle via facilitator
  const settleRes = await fetch(`${facilitatorUrl}/api/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: tabsApiKey,
      payTo: req.payTo,
      amount: amount.toString(),
    }),
  });

  const settle = (await settleRes.json()) as {
    success: boolean;
    transaction?: string;
    error?: string;
  };

  if (!settle.success || !settle.transaction) {
    throw new TabsPaymentError("Settlement failed", settle.error, req);
  }

  // Retry with signed transaction for resource's facilitator to submit
  return fetch(url, {
    ...fetchOptions,
    headers: {
      ...fetchOptions.headers,
      "X-PAYMENT": btoa(
        JSON.stringify({
          x402Version: 1,
          scheme: "exact",
          network,
          payload: {
            transaction: settle.transaction,
            tabsApiKey, // Include for refund derivation
          },
        }),
      ),
    },
  });
}
