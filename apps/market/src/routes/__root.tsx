import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createClient,
  autoDiscover,
  phantom,
  solflare,
  backpack,
} from "@solana/client";
import { SolanaProvider } from "@solana/react-hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/Header";
import appCss from "../styles.css?url";

// Solana client configuration
const solanaClient = createClient({
  commitment: "confirmed",
  endpoint:
    import.meta.env.VITE_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
  websocketEndpoint:
    import.meta.env.VITE_MAINNET_WS || "wss://api.mainnet-beta.solana.com",
  walletConnectors: [
    ...phantom(),
    ...solflare(),
    ...backpack(),
    ...autoDiscover(),
  ],
});

// TanStack Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cascade Market - Monetize Your MCPs" },
      {
        name: "description",
        content:
          "The easiest way to monetize your MCP servers. Run one command, get a paid endpoint with automatic revenue distribution.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/water-wave-cascade.svg" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClientOnly fallback={<LoadingFallback />}>
          <AppWithProviders>{children}</AppWithProviders>
        </ClientOnly>
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={[
            {
              name: "TanStack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}

function AppWithProviders({ children }: { children: React.ReactNode }) {
  return (
    <SolanaProvider client={solanaClient}>
      <QueryClientProvider client={queryClient}>
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <Header />
          <main className="flex flex-1 flex-col min-h-0 overflow-auto">
            {children}
          </main>
          <footer className="shrink-0 border-t py-4 px-4 md:px-6">
            <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Cascade Market</span>
                <span className="text-xs">&copy; 2025</span>
                <span className="text-xs text-amber-600">
                  Beta — use at your own risk
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-muted px-2 py-0.5 rounded">
                  Solana Mainnet
                </span>
              </div>
            </div>
          </footer>
        </div>
        <Toaster />
      </QueryClientProvider>
    </SolanaProvider>
  );
}
