/**
 * Cascade Tabs Dashboard
 *
 * Main dashboard for managing Smart Account and API keys.
 */

import { SmartAccountPanel } from "@/components/SmartAccountPanel";

export function Dashboard() {
	return (
		<main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
					<p className="text-muted-foreground mt-1">
						Manage your Cascade Tabs Smart Account
					</p>
				</div>

				<SmartAccountPanel />
			</div>
		</main>
	);
}
