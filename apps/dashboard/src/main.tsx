import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import {
  createClient,
  autoDiscover,
  phantom,
  solflare,
  backpack,
} from "@solana/client";
import { SolanaProvider } from "@solana/react-hooks";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChainProvider } from "./contexts/chain-context";
import { wagmiConfig } from "./lib/wagmi";
import { router } from "./router";
import "./index.css";

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

// TanStack Query client (required by wagmi)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

// biome-ignore lint/style/noNonNullAssertion: Vite guarantees root element exists
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SolanaProvider client={solanaClient}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ChainProvider>
            <RouterProvider router={router} />
          </ChainProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </SolanaProvider>
  </StrictMode>,
);
