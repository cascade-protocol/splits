import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronRight,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { usdc } from "@/lib/utils";
import {
  getSplitsByAuthority,
  type SplitWithBalance,
} from "@cascade-fyi/splits-sdk";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/splits")({
  ssr: false, // Client-only - requires wallet
  component: SplitsConsole,
});

function SplitsConsole() {
  const { wallet, connected } = useWalletConnection();
  const address = wallet?.account.address;
  const client = useSolanaClient();
  // Cast to SolanaRpcApi (mainnet) - framework-kit's type is a union
  const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;

  // Fetch splits for this authority
  const {
    data: splits = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["splits", address],
    queryFn: () => {
      if (!address) return [];
      return getSplitsByAuthority(rpc, address);
    },
    enabled: !!address && connected,
  });

  // Calculate totals
  const totalBalance = splits.reduce((sum, s) => sum + s.vaultBalance, 0n);
  const activeSplits = splits.filter((s) => s.vaultBalance > 0n).length;

  if (!connected) {
    return (
      <div className="container mx-auto px-4 py-6 md:px-6">
        <Empty>
          <EmptyMedia variant="icon">
            <Wallet className="h-6 w-6" />
          </EmptyMedia>
          <EmptyTitle>Connect Your Wallet</EmptyTitle>
          <EmptyDescription>
            Connect your wallet to view and manage your Cascade Splits.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 md:px-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Splits Console</h1>
        <p className="text-sm text-muted-foreground">
          View and manage your Cascade Splits on Solana
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Splits"
          value={isLoading ? "..." : splits.length.toString()}
        />
        <StatCard
          label="Active (Balance > 0)"
          value={isLoading ? "..." : activeSplits.toString()}
        />
        <StatCard
          label="Total Balance"
          value={
            isLoading
              ? "..."
              : `$${usdc.toDecimalString(totalBalance, { minimumFractionDigits: 2, trimTrailingZeros: false })}`
          }
        />
      </div>

      {/* Splits Table */}
      <Card>
        <CardHeader>
          <CardTitle>My Splits</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              Failed to load splits:{" "}
              {error instanceof Error ? error.message : "Unknown error"}
            </div>
          ) : splits.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Wallet className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No splits found</EmptyTitle>
              <EmptyDescription>
                You don't have any Cascade Splits yet. Create one to start
                splitting payments.
              </EmptyDescription>
              <Button asChild>
                <Link to="/services/new">Create Split</Link>
              </Button>
            </Empty>
          ) : (
            <SplitsTable splits={splits} />
          )}
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
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function SplitsTable({ splits }: { splits: SplitWithBalance[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Split Config</TableHead>
          <TableHead>Vault</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead className="text-right">Recipients</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {splits.map((split) => (
          <SplitRow
            key={split.address}
            split={split}
            isExpanded={expandedId === split.address}
            onToggle={() =>
              setExpandedId(expandedId === split.address ? null : split.address)
            }
          />
        ))}
      </TableBody>
    </Table>
  );
}

function SplitRow({
  split,
  isExpanded,
  onToggle,
}: {
  split: SplitWithBalance;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const hasBalance = split.vaultBalance > 0n;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onToggle}>
        <TableCell>
          <ChevronRight
            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm truncate max-w-[120px]">
              {split.address.slice(0, 8)}...
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(split.address, "config");
              }}
            >
              {copied === "config" ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm truncate max-w-[120px]">
              {split.vault.slice(0, 8)}...
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(split.vault, "vault");
              }}
            >
              {copied === "vault" ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <Badge variant={hasBalance ? "default" : "secondary"}>
            ${usdc.toDecimalString(split.vaultBalance)}
          </Badge>
        </TableCell>
        <TableCell className="text-right">{split.recipients.length}</TableCell>
        <TableCell>
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a
              href={`https://solscan.io/account/${split.address}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
            <SplitDetails split={split} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SplitDetails({ split }: { split: SplitWithBalance }) {
  // Check for unclaimed amounts (amount > 0)
  const hasUnclaimed = split.unclaimedAmounts?.some((u) => u.amount > 0n);

  return (
    <div className="p-4 space-y-4">
      {/* Unique ID / Label */}
      {split.uniqueId && (
        <div className="text-sm">
          <span className="text-muted-foreground">Unique ID: </span>
          <span className="font-mono">
            {split.uniqueId.slice(0, 8)}...{split.uniqueId.slice(-4)}
          </span>
        </div>
      )}

      {/* Recipients */}
      <div>
        <div className="text-sm font-medium mb-2">Recipients</div>
        <div className="space-y-1">
          {split.recipients.map((r) => (
            <div
              key={r.address}
              className="flex items-center justify-between text-sm bg-background rounded px-3 py-2"
            >
              <span className="font-mono text-muted-foreground">
                {r.address.slice(0, 8)}...{r.address.slice(-4)}
              </span>
              <span className="font-medium">{(r.share / 100).toFixed(2)}%</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm bg-background rounded px-3 py-2 border-t">
            <span className="text-muted-foreground">Protocol Fee</span>
            <span className="font-medium">1.00%</span>
          </div>
        </div>
      </div>

      {/* Unclaimed Amounts (if any) */}
      {hasUnclaimed && (
        <div>
          <div className="text-sm font-medium mb-2 text-amber-500">
            Unclaimed Amounts
          </div>
          <div className="text-sm text-muted-foreground">
            Some recipients have unclaimed funds due to missing token accounts.
            Execute split again after they create their USDC ATA.
          </div>
        </div>
      )}
    </div>
  );
}
