import { createFileRoute } from "@tanstack/react-router";
import { useWalletConnection } from "@solana/react-hooks";
import { Dashboard } from "@/components/Dashboard";
import { About } from "@/components/About";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { connected } = useWalletConnection();

  // Show dashboard if connected, otherwise show about/landing
  return connected ? <Dashboard /> : <About />;
}
