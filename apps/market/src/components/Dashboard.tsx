import { Link } from "@tanstack/react-router";
import {
  Plus,
  Server,
  Activity,
  DollarSign,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { usdc } from "@/lib/utils";
import { getSplitsByAuthority, seedToLabel } from "@cascade-fyi/splits-sdk";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

interface ServiceDisplay {
  id: string; // split config address
  name: string; // derived from uniqueId via seedToLabel
  vaultBalance: bigint;
}

export function Dashboard() {
  const { wallet, connected } = useWalletConnection();
  const address = wallet?.account.address;
  const client = useSolanaClient();
  const rpc = client.runtime.rpc as Rpc<SolanaRpcApi>;

  // Fetch splits from chain (source of truth)
  const {
    data: splits = [],
    isLoading: splitsLoading,
    error: splitsError,
  } = useQuery({
    queryKey: ["splits", address],
    queryFn: async () => {
      if (!address) return [];
      const result = await getSplitsByAuthority(rpc, address);
      return result;
    },
    enabled: !!address && connected,
  });

  // Derive display data from chain
  const services: ServiceDisplay[] = splits.map((split) => ({
    id: split.address,
    name: seedToLabel(split.uniqueId) ?? split.address.slice(0, 8),
    vaultBalance: split.vaultBalance,
  }));

  // Calculate stats from chain data
  const totalBalance = splits.reduce((sum, s) => sum + s.vaultBalance, 0n);
  const activeSplits = splits.filter((s) => s.vaultBalance > 0n).length;

  return (
    <div className="container mx-auto px-4 py-6 md:px-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Manage your MCP services and track revenue
          </p>
        </div>
        <Button asChild>
          <Link to="/services/new">
            <Plus className="mr-2 h-4 w-4" />
            New Service
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Server className="h-4 w-4" />}
          label="Services"
          value={splitsLoading ? "..." : splits.length.toString()}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="With Balance"
          value={splitsLoading ? "..." : activeSplits.toString()}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Total Balance"
          value={
            splitsLoading
              ? "..."
              : `$${usdc.toDecimalString(totalBalance, { minimumFractionDigits: 2, trimTrailingZeros: false })}`
          }
        />
      </div>

      {/* Services List */}
      <Card>
        <CardHeader>
          <CardTitle>My Services</CardTitle>
        </CardHeader>
        <CardContent>
          {splitsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : splitsError ? (
            <Empty>
              <EmptyMedia variant="icon">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </EmptyMedia>
              <EmptyTitle>Failed to load services</EmptyTitle>
              <EmptyDescription>
                {splitsError instanceof Error
                  ? splitsError.message
                  : "Unable to fetch your services. Please try again."}
              </EmptyDescription>
            </Empty>
          ) : services.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Server className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No services yet</EmptyTitle>
              <EmptyDescription>
                Create your first paid MCP endpoint to get started.
              </EmptyDescription>
              <Button asChild>
                <Link to="/services/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Service
                </Link>
              </Button>
            </Empty>
          ) : (
            <div className="divide-y divide-border">
              {services.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-sm">{label}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function ServiceRow({ service }: { service: ServiceDisplay }) {
  const hasBalance = service.vaultBalance > 0n;

  return (
    <a
      href={`https://solscan.io/account/${service.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-2 h-2 rounded-full ${
            hasBalance ? "bg-green-500" : "bg-muted-foreground"
          }`}
        />
        <div>
          <div className="font-medium">{service.name}</div>
          <div className="text-sm text-muted-foreground font-mono">
            {service.id.slice(0, 8)}...{service.id.slice(-4)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-medium">
          ${usdc.toDecimalString(service.vaultBalance)}
        </div>
        <div className="text-sm text-muted-foreground">balance</div>
      </div>
    </a>
  );
}
