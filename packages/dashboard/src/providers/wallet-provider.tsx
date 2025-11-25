import { type FC, type ReactNode, useMemo } from "react";
import {
	ConnectionProvider,
	WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

import "@solana/wallet-adapter-react-ui/styles.css";

interface WalletContextProviderProps {
	children: ReactNode;
}

/**
 * Wallet adapter provider for Solana mainnet.
 * Uses wallet-standard auto-detection (empty wallets array).
 */
export const WalletContextProvider: FC<WalletContextProviderProps> = ({
	children,
}) => {
	// Use env variable or fallback to public mainnet RPC
	const endpoint = useMemo(
		() =>
			import.meta.env.VITE_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
		[],
	);

	// Empty array enables wallet-standard auto-detection
	// This finds Phantom, Solflare, etc. automatically
	const wallets = useMemo(() => [], []);

	return (
		<ConnectionProvider endpoint={endpoint}>
			<WalletProvider wallets={wallets} autoConnect>
				<WalletModalProvider>{children}</WalletModalProvider>
			</WalletProvider>
		</ConnectionProvider>
	);
};
