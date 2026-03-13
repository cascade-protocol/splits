/**
 * Explore Page
 *
 * Per ADR-0004 §4.7: Service discovery uses on-chain SplitConfig PDAs.
 * For MVP, shows a placeholder. Full implementation queries Solana RPC.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Server, Construction } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

export const Route = createFileRoute("/explore")({
  ssr: true,
  component: ExplorePage,
});

function ExplorePage() {
  return (
    <div className="container mx-auto px-4 py-8 md:px-6">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Explore MCP Services</h1>
        <p className="text-muted-foreground">
          Discover paid MCP endpoints from the community
        </p>
      </div>

      {/* Coming Soon */}
      <Card>
        <CardContent className="py-12">
          <Empty>
            <EmptyMedia variant="icon">
              <Construction className="h-6 w-6" />
            </EmptyMedia>
            <EmptyTitle>Service Discovery Coming Soon</EmptyTitle>
            <EmptyDescription>
              On-chain service discovery is being implemented. In the meantime,
              you can create your own service and share the endpoint directly.
            </EmptyDescription>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/services/new">Create Service</Link>
              </Button>
            </div>
          </Empty>
        </CardContent>
      </Card>

      {/* How It Works */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <Server className="h-8 w-8 mb-4 text-muted-foreground" />
            <h3 className="font-semibold mb-2">1. Create Service</h3>
            <p className="text-sm text-muted-foreground">
              Register your MCP with a @namespace/name and price per call.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Server className="h-8 w-8 mb-4 text-muted-foreground" />
            <h3 className="font-semibold mb-2">2. Connect CLI</h3>
            <p className="text-sm text-muted-foreground">
              Run `cascade serve` to tunnel your local MCP to the market.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Server className="h-8 w-8 mb-4 text-muted-foreground" />
            <h3 className="font-semibold mb-2">3. Get Paid</h3>
            <p className="text-sm text-muted-foreground">
              Revenue is automatically split via your Cascade Split.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
