import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Wallet, ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";

import { Button } from "./button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./dropdown-menu";

/**
 * Custom wallet button styled to match the app's design system.
 * Replaces WalletMultiButton from @solana/wallet-adapter-react-ui.
 */
export function WalletButton() {
	const { connected, publicKey, disconnect, connecting } = useWallet();
	const { setVisible } = useWalletModal();
	const [copied, setCopied] = useState(false);

	const address = publicKey?.toBase58() ?? "";
	const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "";

	const copyAddress = useCallback(async () => {
		if (!address) return;
		await navigator.clipboard.writeText(address);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [address]);

	// Not connected - show connect button
	if (!connected) {
		return (
			<Button onClick={() => setVisible(true)} disabled={connecting}>
				<Wallet className="h-4 w-4" />
				{connecting ? "Connecting..." : "Connect Wallet"}
			</Button>
		);
	}

	// Connected - show address with dropdown
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline">
					<span className="font-mono">{shortAddress}</span>
					<ChevronDown className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuItem onClick={copyAddress}>
					{copied ? (
						<Check className="h-4 w-4 text-green-500" />
					) : (
						<Copy className="h-4 w-4" />
					)}
					{copied ? "Copied!" : "Copy Address"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => setVisible(true)}>
					<Wallet className="h-4 w-4" />
					Change Wallet
				</DropdownMenuItem>
				<DropdownMenuItem onClick={disconnect} className="text-destructive">
					<LogOut className="h-4 w-4" />
					Disconnect
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
