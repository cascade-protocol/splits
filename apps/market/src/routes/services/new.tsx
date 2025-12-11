import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, Check, Copy } from "lucide-react";

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

export const Route = createFileRoute("/services/new")({
  ssr: false, // Client-only - requires wallet
  component: NewService,
});

type Step = "details" | "creating" | "success";

function NewService() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("1000"); // Default: 0.001 USDC (1000 base units)
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("creating");

    // TODO: Implement actual service creation
    // 1. Build split creation transaction
    // 2. User signs transaction
    // 3. Wait for confirmation
    // 4. Store service in D1
    // 5. Generate token

    // Simulate for now
    await new Promise((r) => setTimeout(r, 2000));
    setToken(`csc_${btoa(JSON.stringify({ name, price })).slice(0, 32)}`);
    setStep("success");
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
                  ${(Number(price) / 1_000_000).toFixed(6)}/call
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
                pattern="[a-z0-9-]+"
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
                  value={(Number(price) / 1_000_000).toString()}
                  onChange={(e) =>
                    setPrice(
                      (parseFloat(e.target.value) * 1_000_000).toString(),
                    )
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

            {/* Submit */}
            <Button
              type="submit"
              className="w-full"
              disabled={step === "creating" || !name}
            >
              {step === "creating" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Service...
                </>
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
