import { SplitCard } from "@/components/split-card";
import { Button } from "@/components/ui/button";
import { mockSplits } from "@/lib/mock-data";

export function Dashboard() {
	const handleExecute = (splitId: string) => {
		// TODO: Implement execute logic
		console.log("Executing split:", splitId);
	};

	const handleCreateNew = () => {
		// TODO: Navigate to create split flow
		console.log("Create new split");
	};

	// Calculate totals
	const totalBalance = mockSplits.reduce(
		(sum, split) => sum + split.balance,
		0,
	);
	const activeSplits = mockSplits.filter((s) => s.status === "ready").length;

	return (
		<div className="space-y-8">
			{/* Stats */}
			<div className="grid gap-4 md:grid-cols-3">
				<div className="rounded-lg border bg-card p-6">
					<div className="text-sm text-muted-foreground">Total Balance</div>
					<div className="text-2xl font-bold">
						${totalBalance.toLocaleString()}
					</div>
				</div>
				<div className="rounded-lg border bg-card p-6">
					<div className="text-sm text-muted-foreground">Active Splits</div>
					<div className="text-2xl font-bold">{mockSplits.length}</div>
				</div>
				<div className="rounded-lg border bg-card p-6">
					<div className="text-sm text-muted-foreground">Ready to Execute</div>
					<div className="text-2xl font-bold">{activeSplits}</div>
				</div>
			</div>

			{/* Split Cards */}
			<div>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-2xl font-bold">Your Splits</h2>
					<Button onClick={handleCreateNew}>+ New Split</Button>
				</div>

				<div className="grid gap-4">
					{mockSplits.map((split) => (
						<SplitCard key={split.id} split={split} onExecute={handleExecute} />
					))}
				</div>
			</div>
		</div>
	);
}
