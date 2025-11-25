import type { FC, ReactNode } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { SplitsProvider } from "@cascade-fyi/splits-sdk/react";
import { WalletContextProvider } from "./wallet-provider";
import { QueryProvider } from "./query-provider";

interface AppProvidersProps {
	children: ReactNode;
}

/**
 * Inner providers that need wallet adapter context (connection).
 */
const InnerProviders: FC<{ children: ReactNode }> = ({ children }) => {
	const { connection } = useConnection();
	return (
		<SplitsProvider connection={connection}>
			<QueryProvider>{children}</QueryProvider>
		</SplitsProvider>
	);
};

/**
 * Combined providers wrapper for the app.
 * Order: Wallet → Splits (needs connection) → Query
 */
export const AppProviders: FC<AppProvidersProps> = ({ children }) => {
	return (
		<WalletContextProvider>
			<InnerProviders>{children}</InnerProviders>
		</WalletContextProvider>
	);
};
