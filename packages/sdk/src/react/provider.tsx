/**
 * React provider for Cascade Splits SDK.
 * Framework-agnostic - works with any connection source.
 */

import { type ReactNode, useMemo } from "react";
import type { Connection } from "@solana/web3.js";
import { CascadeSplits } from "../web3/index.js";
import { SplitsContext } from "./context.js";

/**
 * Props for SplitsProvider
 */
export interface SplitsProviderProps {
	children: ReactNode;
	/** Solana connection instance */
	connection: Connection;
	/** Optional custom SDK instance. If provided, connection prop is ignored. */
	sdk?: CascadeSplits;
}

/**
 * Provider component that makes the Cascade Splits SDK available to all hooks.
 *
 * @example
 * ```tsx
 * // With @solana/wallet-adapter-react
 * import { useConnection } from '@solana/wallet-adapter-react';
 * import { SplitsProvider } from '@cascade-fyi/splits-sdk/react';
 *
 * function App() {
 *   const { connection } = useConnection();
 *   return (
 *     <SplitsProvider connection={connection}>
 *       <YourApp />
 *     </SplitsProvider>
 *   );
 * }
 *
 * // Or with manual connection
 * import { Connection } from '@solana/web3.js';
 *
 * const connection = new Connection('https://api.mainnet-beta.solana.com');
 * <SplitsProvider connection={connection}>...</SplitsProvider>
 * ```
 */
export function SplitsProvider({
	children,
	connection,
	sdk: customSdk,
}: SplitsProviderProps) {
	const sdk = useMemo(() => {
		if (customSdk) return customSdk;
		return new CascadeSplits(connection);
	}, [connection, customSdk]);

	return (
		<SplitsContext.Provider value={sdk}>{children}</SplitsContext.Provider>
	);
}
