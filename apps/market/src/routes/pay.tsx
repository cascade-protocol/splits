import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Wallet,
  CreditCard,
  Shield,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pay")({
  ssr: false, // Wallet-heavy route - must run on client
  component: PayPage,
});

function PayPage() {
  return (
    <div className="container mx-auto px-4 py-8 md:px-6 max-w-3xl">
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CreditCard className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-3">Pay for MCP Services</h1>
        <p className="text-muted-foreground text-lg">
          Set up a Tabs smart account to pay for services on Cascade Market
        </p>
      </div>

      {/* How it works */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">How Tabs Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Create a Smart Account</p>
              <p className="text-sm text-muted-foreground">
                A non-custodial Squads multisig where you're the sole owner
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Deposit USDC</p>
              <p className="text-sm text-muted-foreground">
                Fund your account with USDC that services can charge against
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Set Spending Limits</p>
              <p className="text-sm text-muted-foreground">
                Control how much services can charge per day - you stay in
                control
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Benefits */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Why Use Tabs?</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <ArrowRight className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>
                <strong>Non-custodial:</strong> Only you can withdraw funds
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>
                <strong>Daily limits:</strong> Cap how much can be spent each
                day
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>
                <strong>Revocable:</strong> Remove spending permission anytime
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>
                <strong>x402 compatible:</strong> Works with the HTTP 402
                Payment Required standard
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* CTA */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button size="lg" asChild>
          <a
            href="https://tabs.cascade.fyi"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get Started with Tabs
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link to="/explore">Explore Services</Link>
        </Button>
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-muted-foreground mt-6">
        Already have a Tabs account? Your API key works on all Cascade Market
        services.
      </p>
    </div>
  );
}
