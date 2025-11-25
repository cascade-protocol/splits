// Buffer polyfill - MUST be first, before any Solana imports
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppProviders } from "./providers";

// biome-ignore lint/style/noNonNullAssertion: Vite guarantees root element exists
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppProviders>
			<App />
		</AppProviders>
	</StrictMode>,
);
