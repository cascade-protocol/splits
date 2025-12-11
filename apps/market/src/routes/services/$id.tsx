import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Copy, Check, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/services/$id")({
  ssr: false, // Client-only - requires wallet
  component: ServiceDetail,
});

function ServiceDetail() {
  const { id } = Route.useParams();
  const [copied, setCopied] = useState<string | null>(null);

  // TODO: Fetch service from server function
  const service = {
    id,
    name: "twitter-research",
    status: "online" as const,
    price: "1000",
    splitConfig: "7xK9...3mP",
    splitVault: "8yL2...4nQ",
    totalCalls: 1234,
    totalRevenue: "12.34",
    pendingBalance: "1.23",
    createdAt: new Date().toISOString(),
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const cliCommand = `cascade --token csc_xxx localhost:3000`;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link to="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{service.name}</h1>
          <Badge
            variant={service.status === "online" ? "default" : "secondary"}
          >
            {service.status}
          </Badge>
        </div>
        <p className="text-muted-foreground">{service.name}.mcps.cascade.fyi</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Status" value={service.status} />
        <StatCard
          label="Price"
          value={`$${(Number(service.price) / 1_000_000).toFixed(6)}`}
        />
        <StatCard label="Total Calls" value={service.totalCalls.toString()} />
        <StatCard label="Total Revenue" value={`$${service.totalRevenue}`} />
      </div>

      {/* CLI Command */}
      <Card>
        <CardHeader>
          <CardTitle>Connect Your MCP</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between gap-4">
              <code className="text-sm font-mono truncate">{cliCommand}</code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copyToClipboard(cliCommand, "cli")}
              >
                {copied === "cli" ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>Service Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailRow
            label="Split Config"
            value={service.splitConfig}
            onCopy={() => copyToClipboard(service.splitConfig, "config")}
            copied={copied === "config"}
            explorerUrl={`https://solscan.io/account/${service.splitConfig}`}
          />
          <DetailRow
            label="Split Vault"
            value={service.splitVault}
            onCopy={() => copyToClipboard(service.splitVault, "vault")}
            copied={copied === "vault"}
            explorerUrl={`https://solscan.io/account/${service.splitVault}`}
          />
          <DetailRow
            label="Pending Balance"
            value={`$${service.pendingBalance}`}
          />
          <DetailRow
            label="Created"
            value={new Date(service.createdAt).toLocaleDateString()}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground mb-1">{label}</div>
        <div className="text-xl font-semibold capitalize">{value}</div>
      </CardContent>
    </Card>
  );
}

function DetailRow({
  label,
  value,
  onCopy,
  copied,
  explorerUrl,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  explorerUrl?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-sm">{value}</span>
        {onCopy && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCopy}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
        {explorerUrl && (
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
