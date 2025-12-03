import { useLocation } from "react-router";
import { useWallet } from "@solana/react-hooks";
import { Header } from "@/components/Header";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { Dashboard } from "@/pages/Dashboard";
import { About } from "@/pages/About";

export function RootLayout() {
	const location = useLocation();
	const wallet = useWallet();
	const connected = wallet.status === "connected";

	// Show About if on /about OR if wallet not connected
	const showAbout = location.pathname === "/about" || !connected;

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Header />

			<ErrorBoundary>
				{/* Keep both mounted, show/hide based on route + wallet state */}
				<div className={showAbout ? "hidden" : "flex flex-1 flex-col"}>
					<Dashboard />
				</div>
				<div className={showAbout ? "flex flex-1 flex-col" : "hidden"}>
					<About />
				</div>
			</ErrorBoundary>

			{/* Footer */}
			<footer className="border-t py-4 px-4 mt-auto">
				<div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
					<div className="flex items-center gap-2">
						<span>Cascade Splits</span>
						<span className="text-xs">&copy; 2025</span>
						<span className="text-xs text-amber-600">
							Unaudited — use at your own risk
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs bg-muted px-2 py-0.5 rounded">
							Mainnet
						</span>
						<a
							href="https://solscan.io/account/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB"
							target="_blank"
							rel="noopener noreferrer"
							className="font-mono text-xs hover:text-foreground transition-colors"
						>
							SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB
						</a>
					</div>
				</div>
			</footer>

			<Toaster />
		</div>
	);
}
