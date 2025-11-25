import type { ColumnDef } from "@tanstack/react-table";
import {
	Check,
	Copy,
	MoreHorizontal,
	ExternalLink,
	Users,
	Play,
	Loader2,
	Settings,
	Trash2,
} from "lucide-react";
import {
	hasUnclaimedAmounts,
	canUpdateOrClose,
	previewDistribution,
	type SplitWithBalance,
} from "@cascade-fyi/splits-sdk";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

// USDC decimals
const USDC_DECIMALS = 6;

/**
 * Format token balance for display
 */
function formatBalance(amount: bigint): string {
	const value = Number(amount) / 10 ** USDC_DECIMALS;
	if (value === 0) return "$0.00";
	if (value < 0.01) return "< $0.01";
	return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * CopyButton with confirmation animation.
 * Uses useCopyToClipboard hook for proper cleanup and error handling.
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
			title={copied ? "Copied!" : "Copy vault address"}
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-green-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
			<span className="sr-only">
				{copied ? "Copied" : "Copy vault address"}
			</span>
		</Button>
	);
}

/**
 * Creates column definitions with execute callback
 */
export function createColumns(
	onExecute: (vault: string) => void,
	executingVault: string | null,
): ColumnDef<SplitWithBalance>[] {
	return [
		{
			accessorKey: "vault",
			header: "Vault Address",
			cell: ({ row }) => {
				const vault = row.getValue("vault") as string;
				return (
					<div className="flex items-center gap-2">
						{/* Mobile: Truncated */}
						<code className="font-mono text-sm md:hidden">
							{vault.slice(0, 6)}...{vault.slice(-4)}
						</code>
						{/* Desktop: Full address */}
						<code className="hidden font-mono text-sm md:block">{vault}</code>
						<CopyButton text={vault} />
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
			accessorKey: "recipientCount",
			header: "Recipients",
			cell: ({ row }) => {
				const count = row.getValue("recipientCount") as number;
				return (
					<div className="flex items-center gap-1.5">
						<Users className="h-4 w-4 text-muted-foreground" />
						<span>{count}</span>
					</div>
				);
			},
		},
		{
			accessorKey: "lastActivity",
			header: "Last Activity",
			cell: ({ row }) => {
				const timestamp = row.getValue("lastActivity") as bigint;
				return (
					<span className="text-muted-foreground">
						{formatRelativeTime(timestamp)}
					</span>
				);
			},
		},
		{
			id: "status",
			header: "Status",
			cell: ({ row }) => {
				const split = row.original;
				const hasUnclaimed = hasUnclaimedAmounts(split);

				if (hasUnclaimed) {
					return (
						<Badge variant="destructive" className="text-xs">
							Unclaimed
						</Badge>
					);
				}
				return (
					<Badge variant="secondary" className="text-xs">
						Active
					</Badge>
				);
			},
		},
		{
			id: "actions",
			enableHiding: false,
			cell: ({ row }) => {
				const split = row.original;
				const isExecuting = executingVault === split.vault;
				const hasBalance = split.vaultBalance > 0n;
				const preview = hasBalance
					? previewDistribution(split.vaultBalance, split.recipients)
					: null;

				return (
					<div className="flex items-center gap-2">
						{/* Execute button with distribution preview tooltip */}
						{hasBalance && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											onClick={() => onExecute(split.vault)}
											disabled={isExecuting}
											aria-label={
												isExecuting ? "Executing split" : "Execute split"
											}
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
									</TooltipTrigger>
									{preview && !isExecuting && (
										<TooltipContent className="max-w-xs">
											<div className="text-xs">
												<div className="font-medium mb-1">
													Distribution Preview:
												</div>
												{preview.distributions.slice(0, 5).map((d) => (
													<div
														key={d.address}
														className="flex justify-between gap-4"
													>
														<span className="text-muted-foreground">
															{d.address.slice(0, 4)}...{d.address.slice(-4)}
														</span>
														<span>{formatBalance(d.amount)}</span>
													</div>
												))}
												{preview.distributions.length > 5 && (
													<div className="text-muted-foreground">
														+{preview.distributions.length - 5} more...
													</div>
												)}
												<div className="border-t mt-1 pt-1 text-muted-foreground">
													Protocol fee: {formatBalance(preview.protocolFee)}
												</div>
											</div>
										</TooltipContent>
									)}
								</Tooltip>
							</TooltipProvider>
						)}

						{/* More actions dropdown */}
						<ActionsDropdown split={split} />
					</div>
				);
			},
		},
	];
}

/**
 * Actions dropdown component
 */
function ActionsDropdown({ split }: { split: SplitWithBalance }) {
	const { copied, copy } = useCopyToClipboard();
	const canModify = canUpdateOrClose(split, split.vaultBalance);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" className="h-8 w-8 p-0">
					<span className="sr-only">Open menu</span>
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Actions</DropdownMenuLabel>
				<DropdownMenuItem onClick={() => copy(split.vault)}>
					{copied ? (
						<Check className="mr-2 h-4 w-4 text-green-500" />
					) : (
						<Copy className="mr-2 h-4 w-4" />
					)}
					{copied ? "Copied!" : "Copy vault address"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={!canModify}
					className={!canModify ? "opacity-50 cursor-not-allowed" : ""}
					title={!canModify ? "Distribute funds first" : undefined}
				>
					<Settings className="mr-2 h-4 w-4" />
					Update Recipients
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canModify}
					className={
						!canModify
							? "opacity-50 cursor-not-allowed"
							: "text-destructive focus:text-destructive"
					}
					title={!canModify ? "Distribute funds first" : undefined}
				>
					<Trash2 className="mr-2 h-4 w-4" />
					Close Split
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						window.open(`https://solscan.io/account/${split.vault}`, "_blank");
					}}
				>
					<ExternalLink className="mr-2 h-4 w-4" />
					View on Solscan
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// Mobile-optimized columns (hide some on small screens)
export const mobileHiddenColumns = {
	lastActivity: false, // Hidden by default on mobile
};
