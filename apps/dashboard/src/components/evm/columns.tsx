/* @refresh reset */
import type { ColumnDef } from "@tanstack/react-table";
import {
	Check,
	Copy,
	MoreHorizontal,
	ExternalLink,
	Users,
	Play,
	Loader2,
	Lock,
} from "lucide-react";
import { percentageBpsToShares } from "@cascade-fyi/splits-sdk";
import type { EvmSplitWithBalance } from "@/hooks/use-splits-evm";
import { formatBalance } from "@/lib/splits-helpers";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { openExternal } from "@/lib/utils";
import { getAddressExplorerUrl, getExplorerName } from "@/lib/chain-helpers";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Format timestamp to relative time string
 */
function formatRelativeTime(timestamp: bigint): string {
	const now = Math.floor(Date.now() / 1000);
	const secondsAgo = now - Number(timestamp);
	if (secondsAgo < 60) return "just now";
	if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
	if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
	if (secondsAgo < 2592000) return `${Math.floor(secondsAgo / 86400)}d ago`;
	return `${Math.floor(secondsAgo / 2592000)}mo ago`;
}

/**
 * CopyButton with confirmation animation.
 */
function CopyButton({ text }: { text: string }) {
	const { copied, copy } = useCopyToClipboard();

	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		await copy(text);
	};

	return (
		<Button
			variant="ghost"
			size="icon"
			className="h-7 w-7 shrink-0"
			onClick={handleCopy}
			title={copied ? "Copied!" : "Copy payment address"}
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-green-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
			<span className="sr-only">
				{copied ? "Copied" : "Copy payment address"}
			</span>
		</Button>
	);
}

/**
 * Action callbacks for split operations
 */
export interface EvmSplitActions {
	onExecute: (split: EvmSplitWithBalance) => void;
}

/**
 * Creates column definitions with action callbacks
 */
export function createColumns(
	actions: EvmSplitActions,
	executingAddress: string | null,
): ColumnDef<EvmSplitWithBalance>[] {
	return [
		{
			accessorKey: "address",
			header: "Payment Address",
			cell: ({ row }) => {
				const address = row.getValue("address") as string;
				return (
					<div className="flex items-center gap-2">
						{/* Mobile: Truncated */}
						<code className="font-mono text-sm md:hidden">
							{address.slice(0, 6)}...{address.slice(-4)}
						</code>
						{/* Desktop: Full address */}
						<code className="hidden font-mono text-sm md:block">{address}</code>
						<CopyButton text={address} />
					</div>
				);
			},
		},
		{
			accessorKey: "vaultBalance",
			header: "Balance",
			cell: ({ row }) => {
				const balance = row.getValue("vaultBalance") as bigint;
				return (
					<span
						className={
							balance > 0n
								? "font-medium text-green-600"
								: "text-muted-foreground"
						}
					>
						{formatBalance(balance)}
					</span>
				);
			},
		},
		{
			id: "recipients",
			header: "Recipients",
			accessorFn: (row) => row.recipients.length,
			cell: ({ row }) => {
				const split = row.original;

				return (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-1.5 cursor-help">
									<Users className="h-4 w-4 text-muted-foreground" />
									<span>{split.recipients.length}</span>
								</div>
							</TooltipTrigger>
							<TooltipContent side="right" className="max-w-xs">
								<div className="space-y-1 text-xs">
									{split.recipients.map((r, i) => (
										<div
											key={r.address ?? i}
											className="flex justify-between gap-4"
										>
											<span className="font-mono text-muted-foreground">
												{r.address
													? `${r.address.slice(0, 4)}...${r.address.slice(-4)}`
													: "Unknown"}
											</span>
											<span className="font-medium">
												{percentageBpsToShares(r.percentageBps)}%
											</span>
										</div>
									))}
								</div>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				);
			},
		},
		{
			accessorKey: "createdAt",
			header: "Created",
			cell: ({ row }) => {
				const timestamp = row.getValue("createdAt") as bigint | null;
				if (!timestamp) {
					return <span className="text-muted-foreground">—</span>;
				}
				return (
					<span className="text-muted-foreground">
						{formatRelativeTime(timestamp)}
					</span>
				);
			},
		},
		{
			id: "actions",
			enableHiding: false,
			cell: ({ row }) => {
				const split = row.original;
				const isExecuting = executingAddress === split.address;
				const hasBalance = split.vaultBalance > 0n;

				return (
					<div className="flex items-center gap-2">
						{/* Execute button */}
						{hasBalance && (
							<Button
								variant="outline"
								size="sm"
								onClick={(e) => {
									e.stopPropagation();
									actions.onExecute(split);
								}}
								disabled={isExecuting}
								aria-label={isExecuting ? "Executing split" : "Execute split"}
							>
								{isExecuting ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Play className="h-4 w-4" />
								)}
								<span className="ml-1.5 hidden sm:inline">
									{isExecuting ? "Executing..." : "Execute"}
								</span>
							</Button>
						)}

						{/* More actions dropdown */}
						<ActionsDropdown split={split} />
					</div>
				);
			},
		},
	];
}

interface ActionsDropdownProps {
	split: EvmSplitWithBalance;
}

/**
 * Actions dropdown component
 */
function ActionsDropdown({ split }: ActionsDropdownProps) {
	const { copied, copy } = useCopyToClipboard();
	const explorerName = getExplorerName("base");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					className="h-8 w-8 p-0"
					onClick={(e) => e.stopPropagation()}
				>
					<span className="sr-only">Open menu</span>
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Actions</DropdownMenuLabel>
				<DropdownMenuItem onClick={() => copy(split.address)}>
					{copied ? (
						<Check className="mr-2 h-4 w-4 text-green-500" />
					) : (
						<Copy className="mr-2 h-4 w-4" />
					)}
					{copied ? "Copied!" : "Copy payment address"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						openExternal(getAddressExplorerUrl(split.address, "base"));
					}}
				>
					<ExternalLink className="mr-2 h-4 w-4" />
					View on {explorerName}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem disabled className="text-muted-foreground">
					<Lock className="mr-2 h-4 w-4" />
					<span className="text-xs">EVM splits are immutable</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
