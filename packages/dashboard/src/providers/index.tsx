import type { FC, ReactNode } from "react";
import { WalletContextProvider } from "./wallet-provider";
import { QueryProvider } from "./query-provider";

interface AppProvidersProps {
	children: ReactNode;
}

/**
 * Combined providers wrapper for the app.
 * Order: Wallet → Query
 */
export const AppProviders: FC<AppProvidersProps> = ({ children }) => (
	<WalletContextProvider>
		<QueryProvider>{children}</QueryProvider>
	</WalletContextProvider>
);
