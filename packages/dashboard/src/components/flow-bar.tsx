import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface FlowBarProps {
	address: string;
	share: number; // 1-99
	amount?: number; // Dollar amount (for display)
	className?: string;
}

export function FlowBar({ address, share, amount, className }: FlowBarProps) {
	// Truncate address for display
	const displayAddress =
		address.length > 20
			? `${address.slice(0, 8)}...${address.slice(-8)}`
			: address;

	return (
		<div className={cn("space-y-2", className)}>
			<div className="flex items-center justify-between text-sm">
				<span className="font-mono text-muted-foreground">
					{displayAddress}
				</span>
				<div className="flex items-center gap-2">
					{amount !== undefined && (
						<span className="font-medium">${amount.toLocaleString()}</span>
					)}
					<span className="text-muted-foreground">{share}%</span>
				</div>
			</div>
			<Progress value={share} className="h-2" />
		</div>
	);
}
