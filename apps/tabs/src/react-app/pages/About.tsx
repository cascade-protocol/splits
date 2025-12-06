import { Link } from "react-router";
import { useWalletConnection } from "@solana/react-hooks";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Key, Shield, Lock, Wallet, ArrowRight } from "lucide-react";

export function About() {
	const { connect, connectors, connecting, connected } = useWalletConnection();

	return (
		<main className="flex flex-1 flex-col items-center justify-center px-4 py-12 md:py-16">
			<div className="w-full max-w-2xl space-y-10">
				{/* Hero */}
				<div className="text-center space-y-3">
					<h1 className="text-4xl md:text-5xl font-bold tracking-tight">
						Two lines to pay for any API
					</h1>
					<p className="text-lg text-muted-foreground">
						Non-custodial. On-chain spending limits. No wallet popups.
					</p>
				</div>

				{/* Code Block */}
				<div className="rounded-lg border border-border bg-card overflow-hidden">
					<div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
						<div className="flex items-center gap-2">
							<div className="flex items-center gap-1.5">
								<div className="size-2.5 rounded-full bg-muted-foreground/40" />
								<div className="size-2.5 rounded-full bg-muted-foreground/40" />
								<div className="size-2.5 rounded-full bg-muted-foreground/40" />
							</div>
							<span className="text-[11px] font-medium text-muted-foreground ml-1">
								app.ts
							</span>
						</div>
						<span className="text-[11px] font-medium text-muted-foreground">
							TypeScript
						</span>
					</div>
					<div className="p-4 font-mono text-sm leading-relaxed">
						<div className="text-muted-foreground">
							{"import { "}
							<span className="text-foreground">tabsFetch</span>
							{" } from "}
							<span className="text-amber-500 dark:text-amber-400">
								'@cascade-fyi/tabs-sdk'
							</span>
						</div>
						<div className="h-4" />
						<div className="text-emerald-600 dark:text-emerald-400">
							{"await "}
							<span className="text-foreground">tabsFetch</span>
							{"("}
							<span className="text-amber-500 dark:text-amber-400">
								'/api/ai/generate'
							</span>
							{", { "}
							<span className="text-foreground">tabsApiKey</span>
							{" })"}
						</div>
					</div>
				</div>

				{/* Value Props */}
				<div className="grid gap-4 sm:grid-cols-3">
					<div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
						<Key className="h-5 w-5 text-primary" />
						<h3 className="font-semibold">Just an API key</h3>
						<p className="text-sm text-muted-foreground">
							No wallet popups. No signing. Works like any API you already use.
						</p>
					</div>

					<div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
						<Shield className="h-5 w-5 text-primary" />
						<h3 className="font-semibold">Your custody</h3>
						<p className="text-sm text-muted-foreground">
							Funds stay in your Squads smart account. You control the keys.
						</p>
					</div>

					<div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
						<Lock className="h-5 w-5 text-primary" />
						<h3 className="font-semibold">Spending limits</h3>
						<p className="text-sm text-muted-foreground">
							Set max spend per key. Your agents can't drain your funds.
						</p>
					</div>
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
										{connecting ? "Connecting..." : "Get Started"}
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
								Powered by{" "}
								<a
									href="https://squads.so"
									target="_blank"
									rel="noopener noreferrer"
									className="text-foreground hover:underline"
								>
									Squads Protocol
								</a>
							</p>
						</>
					)}
				</div>
			</div>
		</main>
	);
}
