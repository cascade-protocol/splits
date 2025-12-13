import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { useState } from "react";
import { ArrowLeft, Loader2, Check, Copy, AlertCircle } from "lucide-react";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import type {
  Rpc,
  SolanaRpcApi,
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from "@solana/kit";
import { ensureSplitConfig, labelToSeed } from "@cascade-fyi/splits-sdk";
import { signerFromFrameworkKit } from "@cascade-fyi/splits-sdk/adapters/framework-kit";
import { usdc } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateServiceToken, createTokenSchema } from "@/server/tokens";

interface CloudflareEnv {
  TOKEN_SECRET?: string;
}

/**
 * Server function to create a service token
 * Following Cloudflare docs pattern: env accessed inside createServerFn handler
 */
const createServiceTokenFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createTokenSchema.parse(data))
  .handler(
    async ({
      data,
    }: {
      data: {
        splitConfig: string;
        splitVault: string;
        price: string;
      };
    }) => {
      const { TOKEN_SECRET } = env as CloudflareEnv;
      // Development fallback - DO NOT USE IN PRODUCTION
      const tokenSecret =
        TOKEN_SECRET || "cascade-market-dev-secret-change-in-production";
      if (!TOKEN_SECRET) {
        console.warn("TOKEN_SECRET not set, using development fallback");
      }
      // Use splitConfig address as serviceId (chain is source of truth)
      return generateServiceToken(tokenSecret, {
        serviceId: data.splitConfig,
        ...data,
      });
    },
  );

export const Route = createFileRoute("/services/new")({
  ssr: false, // Client-only - requires wallet
  component: NewService,
});

type Step = "details" | "creating" | "success";

function NewService() {
  const navigate = useNavigate();
  const { wallet, connected } = useWalletConnection();
  const client = useSolanaClient();
  const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;
  const rpcSubscriptions = client.runtime.rpcSubscriptions as RpcSubscriptions<
    SignatureNotificationsApi & SlotNotificationsApi
  >;

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("1000"); // Default: 0.001 USDC (1000 base units)
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!wallet || !connected) {
      setError("Please connect your wallet first");
      return;
    }

    setStep("creating");

    try {
      const uniqueId = labelToSeed(name);
      const signer = signerFromFrameworkKit(wallet);

      // Idempotent split creation - handles all edge cases
      const result = await ensureSplitConfig({
        rpc,
        rpcSubscriptions,
        signer,
        recipients: [{ address: signer.address, share: 100 }],
        uniqueId,
      });

      if (result.status === "failed") {
        throw new Error(result.message);
      }

      if (result.status === "blocked") {
        throw new Error(result.message);
      }

      // result.status is 'created' or 'no_change'
      const { splitConfig, vault } = result;

      // Generate token (chain is source of truth, no D1 needed)
      const { token: generatedToken } = await createServiceTokenFn({
        data: {
          splitConfig,
          splitVault: vault,
          price,
        },
      });

      setToken(generatedToken);
      setStep("success");
    } catch (err) {
      console.error("Service creation failed:", err);
      setError(err instanceof Error ? err.message : "Failed to create service");
      setStep("details");
    }
  };

  const cliCommand = `cascade --token ${token} localhost:3000`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (step === "success") {
    return (
      <div className="max-w-xl mx-auto py-8">
        <Card className="text-center">
          <CardHeader>
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle>Service Created!</CardTitle>
            <CardDescription>
              Your service <strong>{name}</strong> is ready. Run the CLI command
              below to connect your MCP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center justify-between gap-4">
                <code className="text-sm font-mono truncate">{cliCommand}</code>
                <Button variant="ghost" size="icon" onClick={copyToClipboard}>
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Public URL:{" "}
                <code className="text-foreground">
                  https://{name}.mcps.cascade.fyi
                </code>
              </p>
              <p>
                Price:{" "}
                <code className="text-foreground">
                  ${usdc.toDecimalString(BigInt(price))}/call
                </code>
              </p>
            </div>

            <Button
              className="w-full"
              onClick={() => navigate({ to: "/dashboard" })}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link to="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Create New Service</h1>
        <p className="text-muted-foreground">
          Set up a paid MCP endpoint with automatic revenue distribution.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Service Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Service Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  )
                }
                placeholder="twitter-research"
                required
                pattern="[a-z0-9\-]+"
                minLength={3}
                maxLength={32}
                disabled={step === "creating"}
              />
              <p className="text-sm text-muted-foreground">
                Your endpoint: {name || "name"}.mcps.cascade.fyi
              </p>
            </div>

            {/* Price */}
            <div className="space-y-2">
              <Label htmlFor="price">Price per Call (USDC)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="price"
                  type="number"
                  value={usdc.toDecimalString(BigInt(price))}
                  onChange={(e) =>
                    setPrice(usdc.fromDecimal(e.target.value || "0").toString())
                  }
                  placeholder="0.001"
                  step="0.000001"
                  min="0.000001"
                  className="pl-7"
                  required
                  disabled={step === "creating"}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                You receive 99% • Protocol fee: 1%
              </p>
            </div>

            {/* Info */}
            <div className="bg-muted/50 border border-border rounded-lg p-4">
              <h3 className="font-medium mb-2">What happens next:</h3>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>
                  A Cascade Split will be created for your service (~$2 rent)
                </li>
                <li>You'll sign a transaction with your wallet</li>
                <li>You'll receive a CLI token to connect your MCP</li>
              </ol>
            </div>

            {/* Error Display */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full"
              disabled={step === "creating" || !name || !connected}
            >
              {step === "creating" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Service...
                </>
              ) : !connected ? (
                "Connect Wallet to Continue"
              ) : (
                "Create Service"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
