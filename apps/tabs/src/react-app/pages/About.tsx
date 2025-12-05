import { Link } from "react-router";
import { useWalletConnection } from "@solana/react-hooks";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Key, Shield, Zap, Wallet, ArrowRight } from "lucide-react";

export function About() {
	const { connect, connectors, connecting, connected } = useWalletConnection();

	return (
		<main className="flex flex-1 items-center justify-center px-4 py-12">
			<div className="max-w-2xl space-y-8">
				{/* Hero */}
				<div className="text-center space-y-4">
					<h1 className="text-4xl font-bold tracking-tight">Cascade Tabs</h1>
					<p className="text-xl text-muted-foreground">
						Non-custodial API keys for x402-enabled services
					</p>
				</div>

				{/* Features */}
				<div className="grid gap-4 sm:grid-cols-3">
					<Card>
						<CardHeader className="pb-2">
							<Key className="h-8 w-8 text-primary mb-2" />
							<CardTitle className="text-lg">API Key Access</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Access any x402 API with just an API key. No wallet signing
								required per request.
							</CardDescription>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<Shield className="h-8 w-8 text-primary mb-2" />
							<CardTitle className="text-lg">Non-Custodial</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Powered by Squads Smart Accounts. You control the funds, set
								spending limits.
							</CardDescription>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<Zap className="h-8 w-8 text-primary mb-2" />
							<CardTitle className="text-lg">Instant Setup</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Create an account, deposit USDC, get your API key. Start making
								requests immediately.
							</CardDescription>
						</CardContent>
					</Card>
				</div>

				{/* CTA */}
				<div className="text-center space-y-4">
					{connected ? (
						<Button size="lg" asChild>
							<Link to="/">
								<ArrowRight className="h-4 w-4" />
								Go to Dashboard
							</Link>
						</Button>
					) : (
						<>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button size="lg" disabled={connecting}>
										<Wallet className="h-4 w-4" />
										{connecting
											? "Connecting..."
											: "Connect Wallet to Get Started"}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="center">
									{connectors.map((connector) => (
										<DropdownMenuItem
											key={connector.id}
											onClick={() => connect(connector.id)}
										>
											{connector.icon && (
												<img
													src={connector.icon}
													alt={connector.name}
													className="h-4 w-4"
												/>
											)}
											{connector.name}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
							<p className="text-sm text-muted-foreground">
								Requires a Solana wallet with USDC for deposits
							</p>
						</>
					)}
				</div>
			</div>
		</main>
	);
}
