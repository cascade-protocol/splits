import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import type { Rpc, SolanaRpcApi, Address } from "@solana/kit";
import {
  closeSplitConfig,
  getSplitConfig,
  getVaultBalance,
  seedToLabel,
} from "@cascade-fyi/splits-sdk";
import { toast } from "sonner";
import { usdc } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/services/$id")({
  ssr: false, // Client-only - requires wallet
  component: ServiceDetail,
});

function ServiceDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);

  const solanaClient = useSolanaClient();
  const { wallet } = useWalletConnection();
  const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;

  // Fetch split config and vault balance from on-chain (id is the split config address)
  const {
    data: splitData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["splitConfig", id],
    queryFn: async () => {
      const config = await getSplitConfig(rpc, id as Address);
      const vaultBalance = await getVaultBalance(rpc, config.vault);
      return { config, vaultBalance };
    },
    enabled: !!id,
  });

  // Close service mutation
  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("Wallet not connected");

      const toastId = toast.loading("Closing service...");

      try {
        // Build close instruction (id is the split config address)
        const instruction = await closeSplitConfig({
          rpc,
          splitConfig: id as Address,
          authority: wallet.account.address,
        });

        // Sign and send
        toast.loading("Signing transaction...", { id: toastId });
        await solanaClient.helpers.transaction.prepareAndSend({
          authority: wallet,
          instructions: [instruction],
          commitment: "confirmed",
        });

        toast.loading("Closing account...", { id: toastId });
        // Wait for RPC to propagate the closed account state
        await new Promise((resolve) => setTimeout(resolve, 2000));
        toast.success("Service closed!", { id: toastId });
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["splits"] });
      navigate({ to: "/" });
    },
    onError: (err) => {
      toast.error(`Failed to close service: ${err.message}`);
    },
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error or not found
  if (error || !splitData) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-semibold mb-2">Service not found</h2>
        <p className="text-muted-foreground mb-4">
          The service you're looking for doesn't exist or you don't have access.
        </p>
        <Button onClick={() => navigate({ to: "/" })}>Back to Dashboard</Button>
      </div>
    );
  }

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  // Derive display values from on-chain data
  const { config: splitConfig, vaultBalance } = splitData;
  const serviceName = seedToLabel(splitConfig.uniqueId) ?? id.slice(0, 8);
  const hasBalance = vaultBalance > 0n;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{serviceName}</h1>
              <Badge variant={hasBalance ? "default" : "secondary"}>
                {hasBalance ? "active" : "empty"}
              </Badge>
            </div>
            <p className="text-muted-foreground font-mono text-sm">
              {id.slice(0, 8)}...{id.slice(-4)}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={closeMutation.isPending || hasBalance}
              >
                {closeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Close Service
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close this service?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will close the on-chain split configuration and recover
                  the rent. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => closeMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Close Service
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Status" value={hasBalance ? "Active" : "Empty"} />
        <StatCard
          label="Vault Balance"
          value={`$${usdc.toDecimalString(vaultBalance)}`}
        />
        <StatCard
          label="Recipients"
          value={splitConfig.recipients.length.toString()}
        />
      </div>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>On-Chain Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailRow
            label="Split Config"
            value={id}
            onCopy={() => copyToClipboard(id, "config")}
            copied={copied === "config"}
            explorerUrl={`https://solscan.io/account/${id}`}
          />
          <DetailRow
            label="Vault Balance"
            value={`$${usdc.toDecimalString(vaultBalance)}`}
          />
          <DetailRow
            label="Authority"
            value={splitConfig.authority}
            onCopy={() => copyToClipboard(splitConfig.authority, "authority")}
            copied={copied === "authority"}
            explorerUrl={`https://solscan.io/account/${splitConfig.authority}`}
          />
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {splitConfig.recipients.map((recipient, idx) => (
            <DetailRow
              key={recipient.address}
              label={`Recipient ${idx + 1} (${recipient.percentageBps / 100}%)`}
              value={recipient.address}
              onCopy={() =>
                copyToClipboard(recipient.address, `recipient-${idx}`)
              }
              copied={copied === `recipient-${idx}`}
              explorerUrl={`https://solscan.io/account/${recipient.address}`}
            />
          ))}
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
