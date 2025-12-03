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
import { router } from "./router";
import "./index.css";

const client = createClient({
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

// biome-ignore lint/style/noNonNullAssertion: Vite guarantees root element exists
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<SolanaProvider client={client}>
			<RouterProvider router={router} />
		</SolanaProvider>
	</StrictMode>,
);
