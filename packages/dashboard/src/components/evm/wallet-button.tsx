import { Wallet, ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import {
	useConnect,
	useDisconnect,
	useConnection,
	useConnectors,
	useChainId,
	type Connector,
} from "wagmi";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Individual wallet option that checks its own readiness.
 * Following wagmi docs: https://wagmi.sh/react/guides/connect-wallet
 */
function WalletOption({
	connector,
	onClick,
}: {
	connector: Connector;
	onClick: () => void;
}) {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		(async () => {
			const provider = await connector.getProvider();
			setReady(!!provider);
		})();
	}, [connector]);

	if (!ready) return null;

	return (
		<DropdownMenuItem onClick={onClick}>
			{connector.icon && (
				<img src={connector.icon} alt={connector.name} className="h-4 w-4" />
			)}
			{connector.name}
		</DropdownMenuItem>
	);
}

/**
 * EVM wallet button following wagmi's recommended pattern.
 * Lists all available connectors and checks each one's readiness.
 */
export function EvmWalletButton() {
	const chainId = useChainId();
	const { connect, isPending: isConnecting } = useConnect();
	const { disconnect } = useDisconnect();
	const { address, isConnected } = useConnection();
	const connectors = useConnectors();
	const [copied, setCopied] = useState(false);

	const shortAddress = address
		? `${address.slice(0, 6)}...${address.slice(-4)}`
		: "";

	const copyAddress = useCallback(async () => {
		if (!address) return;
		await navigator.clipboard.writeText(address);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [address]);

	// Not connected - show wallet selector dropdown
	if (!isConnected) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button disabled={isConnecting}>
						<Wallet className="h-4 w-4" />
						{isConnecting ? "Connecting..." : "Connect Wallet"}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{connectors.map((connector) => (
						<WalletOption
							key={connector.uid}
							connector={connector}
							onClick={() => connect({ connector, chainId })}
						/>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
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
				<DropdownMenuItem
					onClick={() => disconnect()}
					className="text-destructive"
				>
					<LogOut className="h-4 w-4" />
					Disconnect
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
