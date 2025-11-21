import { Dashboard } from "@/components/dashboard";
import { LandingPage } from "@/components/landing-page";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function App() {
	const [isConnected, setIsConnected] = useState(false);

	const handleConnect = () => {
		// TODO: Implement wallet connection
		setIsConnected(!isConnected);
	};

	return (
		<div className="min-h-screen bg-background text-foreground">
			{/* Header */}
			<header className="border-b">
				<div className="container mx-auto flex h-16 items-center justify-between px-4">
					<div className="flex items-center gap-2">
						<span className="text-xl font-bold">🌊 Cascade</span>
					</div>
					<Button
						onClick={handleConnect}
						variant={isConnected ? "outline" : "default"}
					>
						{isConnected ? "7xKd...3Po2" : "Connect Wallet"}
					</Button>
				</div>
			</header>

			{/* Main Content */}
			<main className="container mx-auto px-4 py-8">
				{isConnected ? (
					<Dashboard />
				) : (
					<LandingPage onConnect={handleConnect} />
				)}
			</main>

			{/* Footer */}
			<footer className="border-t py-6">
				<div className="container mx-auto px-4">
					<div className="flex justify-center gap-4 text-sm text-muted-foreground">
						<a href="#" className="hover:text-foreground">
							Docs
						</a>
						<a href="#" className="hover:text-foreground">
							SDK
						</a>
						<a href="#" className="hover:text-foreground">
							GitHub
						</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
