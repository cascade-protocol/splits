import { Activity } from "react";
import { useLocation } from "react-router";
import { useWalletConnection } from "@solana/react-hooks";
import { Header } from "@/components/Header";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { Dashboard } from "@/pages/Dashboard";
import { About } from "@/pages/About";

export function RootLayout() {
  const location = useLocation();
  const { connected } = useWalletConnection();

  // Show About if on /about OR if wallet not connected
  const showDashboard = location.pathname !== "/about" && connected;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Header />

      <ErrorBoundary>
        {/* Activity automatically cleans up Effects when hidden */}
        <Activity mode={showDashboard ? "visible" : "hidden"}>
          <div className="flex flex-1 flex-col min-h-0 overflow-auto">
            <Dashboard />
          </div>
        </Activity>

        <Activity mode={showDashboard ? "hidden" : "visible"}>
          <div className="flex flex-1 flex-col min-h-0 overflow-auto">
            <About />
          </div>
        </Activity>
      </ErrorBoundary>

      {/* Footer */}
      <footer className="shrink-0 border-t py-4 px-4 md:px-6">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Cascade Tabs</span>
            <span className="text-xs">&copy; 2025</span>
            <span className="text-xs text-amber-600">
              Unaudited — use at your own risk
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-muted px-2 py-0.5 rounded">
              Solana Mainnet
            </span>
          </div>
        </div>
      </footer>

      <Toaster />
    </div>
  );
}
