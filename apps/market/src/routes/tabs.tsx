import { createFileRoute } from "@tanstack/react-router";
import { useWalletConnection } from "@solana/react-hooks";
import { Wallet } from "lucide-react";

import { SmartAccountPanel } from "@/components/tabs/SmartAccountPanel";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

export const Route = createFileRoute("/tabs")({
  ssr: false, // Client-only - requires wallet
  component: TabsPage,
});

function TabsPage() {
  const { connected } = useWalletConnection();

  if (!connected) {
    return (
      <div className="container mx-auto px-4 py-6 md:px-6">
        <Empty>
          <EmptyMedia variant="icon">
            <Wallet className="h-6 w-6" />
          </EmptyMedia>
          <EmptyTitle>Connect Your Wallet</EmptyTitle>
          <EmptyDescription>
            Connect your wallet to manage your Cascade Tabs Smart Account.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
      <div className="space-y-4 md:space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Tabs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your Cascade Tabs Smart Account
          </p>
        </div>

        <SmartAccountPanel />
      </div>
    </main>
  );
}
