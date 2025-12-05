/**
 * Transaction history component for Cascade Tabs.
 *
 * Displays vault transaction history with type icons and amounts.
 */

import { useState } from "react";
import {
	ArrowDownLeft,
	ArrowUpRight,
	Settings,
	Key,
	Zap,
	HelpCircle,
	ExternalLink,
	Loader2,
	ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUsdc } from "@/lib/squads";
import { useTransactionHistory } from "@/hooks/use-transaction-history";
import type { ParsedTxType } from "@/lib/transaction-parser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TX_TYPE_CONFIG: Record<
	ParsedTxType,
	{ icon: typeof ArrowDownLeft; label: string; color: string }
> = {
	deposit: { icon: ArrowDownLeft, label: "Deposit", color: "text-green-500" },
	withdraw: { icon: ArrowUpRight, label: "Withdraw", color: "text-orange-500" },
	set_limit: { icon: Settings, label: "Set Limit", color: "text-blue-500" },
	revoke_limit: { icon: Key, label: "Revoke Limit", color: "text-red-500" },
	api_spend: { icon: Zap, label: "API Spend", color: "text-purple-500" },
	unknown: {
		icon: HelpCircle,
		label: "Unknown",
		color: "text-muted-foreground",
	},
};

interface TransactionHistoryProps {
	vaultAddress: string;
}

export function TransactionHistory({ vaultAddress }: TransactionHistoryProps) {
	const {
		transactions,
		isLoading,
		error,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
	} = useTransactionHistory(vaultAddress);

	if (isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Transaction History</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-destructive">
						Failed to load transactions
					</p>
				</CardContent>
			</Card>
		);
	}

	if (transactions.length === 0) {
		return (
			<Card>
				<CardHeader className="py-4">
					<CardTitle className="text-base">Transaction History</CardTitle>
				</CardHeader>
				<CardContent className="pt-0">
					<p className="text-sm text-muted-foreground">No transactions yet</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<TransactionList
			transactions={transactions}
			hasNextPage={hasNextPage}
			fetchNextPage={fetchNextPage}
			isFetchingNextPage={isFetchingNextPage}
		/>
	);
}

function TransactionList({
	transactions,
	hasNextPage,
	fetchNextPage,
	isFetchingNextPage,
}: {
	transactions: Array<{
		signature: string | null;
		type: ParsedTxType;
		timestamp: Date;
		amount?: bigint;
	}>;
	hasNextPage: boolean;
	fetchNextPage: () => void;
	isFetchingNextPage: boolean;
}) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Card>
			<CardHeader
				className="py-4 cursor-pointer md:cursor-default"
				onClick={() => setIsOpen(!isOpen)}
			>
				<div className="flex items-center justify-between">
					<CardTitle className="text-base">Transaction History</CardTitle>
					<ChevronDown
						className={cn(
							"size-4 md:hidden transition-transform",
							isOpen && "rotate-180",
						)}
					/>
				</div>
			</CardHeader>
			<CardContent
				className={cn("pt-0 space-y-2", isOpen ? "block" : "hidden md:block")}
			>
				{transactions.map((tx, index) => {
					const config = TX_TYPE_CONFIG[tx.type];
					const Icon = config.icon;

					return (
						<div
							key={tx.signature ?? index}
							className="flex items-center justify-between border-b py-2 last:border-0"
						>
							<div className="flex items-center gap-2">
								<div className={`rounded-full bg-muted p-1.5 ${config.color}`}>
									<Icon className="size-3" />
								</div>
								<div>
									<p className="text-sm font-medium">{config.label}</p>
									<p className="text-[10px] text-muted-foreground">
										{tx.timestamp.toLocaleDateString()}{" "}
										{tx.timestamp.toLocaleTimeString()}
									</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								{tx.amount !== undefined && (
									<span className="font-mono text-xs">
										{tx.type === "deposit" ? "+" : "-"}
										{formatUsdc(tx.amount)} USDC
									</span>
								)}
								<a
									href={`https://solscan.io/tx/${tx.signature}`}
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground hover:text-foreground"
								>
									<ExternalLink className="size-3" />
								</a>
							</div>
						</div>
					);
				})}
				{hasNextPage && (
					<Button
						variant="outline"
						onClick={() => fetchNextPage()}
						disabled={isFetchingNextPage}
						className="w-full"
						size="sm"
					>
						{isFetchingNextPage ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							"Load More"
						)}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
