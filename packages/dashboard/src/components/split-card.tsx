import { FlowBar } from "@/components/flow-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { MockSplit } from "@/lib/mock-data";
import { Copy } from "lucide-react";

interface SplitCardProps {
	split: MockSplit;
	onExecute?: (splitId: string) => void;
}

export function SplitCard({ split, onExecute }: SplitCardProps) {
	const { id, name, vault, recipients, balance, status } = split;

	// Truncate vault address
	const displayVault =
		vault.length > 20 ? `${vault.slice(0, 8)}...${vault.slice(-8)}` : vault;

	// Calculate dollar amounts per recipient
	const recipientsWithAmounts = recipients.map((r) => ({
		...r,
		amount: balance > 0 ? Math.floor((balance * r.share) / 100) : 0,
	}));

	const handleCopy = () => {
		navigator.clipboard.writeText(vault);
		// TODO: Add toast notification
	};

	const handleExecute = () => {
		if (onExecute) {
			onExecute(id);
		}
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<CardTitle className="text-lg">{name}</CardTitle>
						<div className="flex items-center gap-2">
							<code className="text-xs text-muted-foreground">
								{displayVault}
							</code>
							<Button
								variant="ghost"
								size="icon"
								className="size-6"
								onClick={handleCopy}
							>
								<Copy className="size-3" />
								<span className="sr-only">Copy vault address</span>
							</Button>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{status === "ready" && balance > 0 && (
							<>
								<span className="text-lg font-semibold">
									${balance.toLocaleString()}
								</span>
								<Badge variant="default">⚡ Ready</Badge>
							</>
						)}
						{status === "empty" && <Badge variant="secondary">Empty</Badge>}
						{status === "executed" && (
							<Badge variant="outline">✓ Executed</Badge>
						)}
					</div>
				</div>
			</CardHeader>

			<CardContent className="space-y-3">
				{recipientsWithAmounts.map((recipient) => (
					<FlowBar
						key={recipient.address}
						address={recipient.address}
						share={recipient.share}
						amount={balance > 0 ? recipient.amount : undefined}
					/>
				))}
			</CardContent>

			<CardFooter className="flex gap-2">
				{status === "ready" && balance > 0 ? (
					<Button onClick={handleExecute} className="w-full">
						Execute Split
					</Button>
				) : (
					<Button variant="outline" onClick={handleCopy} className="w-full">
						Share Vault Address
					</Button>
				)}
			</CardFooter>
		</Card>
	);
}
