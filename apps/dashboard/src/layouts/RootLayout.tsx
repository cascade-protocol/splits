import { useLocation } from "react-router";
import { useWallet } from "@solana/react-hooks";
import { useConnection } from "wagmi";
import { useChain } from "@/contexts/chain-context";
import { Header } from "@/components/Header";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { Dashboard } from "@/pages/Dashboard";
import { About } from "@/pages/About";

export function RootLayout() {
  const location = useLocation();
  const { isSolana } = useChain();

  // Check the active chain's wallet connection
  const solanaWallet = useWallet();
  const { isConnected: evmConnected } = useConnection();
  const connected = isSolana
    ? solanaWallet.status === "connected"
    : evmConnected;

  // Show About if on /about OR if wallet not connected
  const showAbout = location.pathname === "/about" || !connected;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      <Header />

      <ErrorBoundary>
        {/* Keep both mounted, show/hide based on route + wallet state */}
        <div className={showAbout ? "hidden" : "flex flex-1 flex-col"}>
          <Dashboard />
        </div>
        <div className={showAbout ? "flex flex-1 flex-col" : "hidden"}>
          <About />
        </div>
      </ErrorBoundary>

      {/* Footer */}
      <footer className="border-t py-4 px-4 md:px-6 mt-auto">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Cascade Splits</span>
            <span className="text-xs">&copy; 2025</span>
            <span className="text-xs text-amber-600">
              Unaudited — use at your own risk
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 text-xs bg-muted px-2 py-0.5 rounded">
              {isSolana ? "Solana" : "Base"} Mainnet
            </span>
            <a
              href={
                isSolana
                  ? "https://solscan.io/account/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB"
                  : "https://basescan.org/address/0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"
              }
              target="_blank"
              rel="noopener noreferrer"
              title={
                isSolana
                  ? "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB"
                  : "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"
              }
              className="font-mono text-xs hover:text-foreground transition-colors truncate max-w-[120px] md:max-w-none"
            >
              {isSolana
                ? "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB"
                : "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"}
            </a>
          </div>
        </div>
      </footer>

      <Toaster />
    </div>
  );
}
