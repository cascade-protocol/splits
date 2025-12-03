/* @refresh reset */
import type { ColumnDef } from "@tanstack/react-table";
import {
	AlertTriangle,
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
import { bpsToShares } from "@cascade-fyi/splits-sdk";
import type { SplitWithBalance } from "@/hooks/use-splits";
import {
	canUpdateOrClose,
	hasUnclaimedAmounts,
	getTotalUnclaimed,
	previewDistribution,
	formatBalance,
} from "@/lib/splits-helpers";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { openExternal } from "@/lib/utils";

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
export interface SplitActions {
	onExecute: (splitConfig: SplitWithBalance) => void;
	onUpdate: (splitConfig: SplitWithBalance) => void;
	onClose: (splitConfig: SplitWithBalance) => void;
}

/**
 * Creates column definitions with action callbacks
 */
export function createColumns(
	actions: SplitActions,
	executingVault: string | null,
): ColumnDef<SplitWithBalance>[] {
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
				const splitConfig = row.original;
				const hasUnclaimed = hasUnclaimedAmounts(splitConfig);
				const unclaimedTotal = hasUnclaimed
					? getTotalUnclaimed(splitConfig)
					: 0n;

				return (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-1.5 cursor-help">
									<Users className="h-4 w-4 text-muted-foreground" />
									<span>{splitConfig.recipients.length}</span>
									{hasUnclaimed && (
										<AlertTriangle className="h-4 w-4 text-amber-500" />
									)}
								</div>
							</TooltipTrigger>
							<TooltipContent side="right" className="max-w-xs">
								<div className="space-y-2 text-xs">
									{/* Recipient breakdown */}
									<div className="space-y-1">
										{splitConfig.recipients.map((r) => (
											<div
												key={r.address as string}
												className="flex justify-between gap-4"
											>
												<span className="font-mono text-muted-foreground">
													{(r.address as string).slice(0, 4)}...
													{(r.address as string).slice(-4)}
												</span>
												<span className="font-medium">
													{bpsToShares(r.percentageBps)}%
												</span>
											</div>
										))}
									</div>

									{/* Unclaimed warning */}
									{hasUnclaimed && (
										<div className="border-t pt-2 text-amber-500">
											<div className="font-medium">
												{formatBalance(unclaimedTotal)} unclaimed
											</div>
											<div className="text-muted-foreground">
												Some recipients need to create token accounts
											</div>
										</div>
									)}
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
				const splitConfig = row.original;
				const isExecuting = executingVault === (splitConfig.vault as string);
				const hasBalance = splitConfig.vaultBalance > 0n;
				const activeRecipients = splitConfig.recipients.map((r) => ({
					address: r.address as string,
					percentageBps: r.percentageBps,
				}));
				const preview = hasBalance
					? previewDistribution(splitConfig.vaultBalance, activeRecipients)
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
											onClick={() => actions.onExecute(splitConfig)}
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
						<ActionsDropdown splitConfig={splitConfig} actions={actions} />
					</div>
				);
			},
		},
	];
}

interface ActionsDropdownProps {
	splitConfig: SplitWithBalance;
	actions: SplitActions;
}

/**
 * Get specific reason why update/close is blocked
 */
function getBlockedReason(splitConfig: SplitWithBalance): string | null {
	if (splitConfig.vaultBalance > 0n) {
		return "Execute to distribute vault balance first";
	}
	if (hasUnclaimedAmounts(splitConfig)) {
		const unclaimed = getTotalUnclaimed(splitConfig);
		return `${formatBalance(unclaimed)} unclaimed - recipients need token accounts`;
	}
	return null;
}

/**
 * Actions dropdown component
 */
function ActionsDropdown({ splitConfig, actions }: ActionsDropdownProps) {
	const { copied, copy } = useCopyToClipboard();
	const canModify = canUpdateOrClose(splitConfig, splitConfig.vaultBalance);
	const blockedReason = canModify ? null : getBlockedReason(splitConfig);

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
				<DropdownMenuItem onClick={() => copy(splitConfig.address as string)}>
					{copied ? (
						<Check className="mr-2 h-4 w-4 text-green-500" />
					) : (
						<Copy className="mr-2 h-4 w-4" />
					)}
					{copied ? "Copied!" : "Copy payment address"}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => copy(splitConfig.vault as string)}>
					<Copy className="mr-2 h-4 w-4" />
					Copy vault address (ATA)
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={!canModify}
					onClick={() => canModify && actions.onUpdate(splitConfig)}
					className={!canModify ? "opacity-50 cursor-not-allowed" : ""}
					title={blockedReason ?? undefined}
				>
					<Settings className="mr-2 h-4 w-4" />
					Update Recipients
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canModify}
					onClick={() => canModify && actions.onClose(splitConfig)}
					className={
						!canModify
							? "opacity-50 cursor-not-allowed"
							: "text-destructive focus:text-destructive"
					}
					title={blockedReason ?? undefined}
				>
					<Trash2 className="mr-2 h-4 w-4" />
					Close Split
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						openExternal(
							`https://solscan.io/account/${splitConfig.address as string}`,
						);
					}}
				>
					<ExternalLink className="mr-2 h-4 w-4" />
					View on Solscan
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => {
						openExternal(
							`https://solscan.io/account/${splitConfig.vault as string}`,
						);
					}}
				>
					<ExternalLink className="mr-2 h-4 w-4" />
					View vault on Solscan
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// Columns hidden by default on mobile
export const mobileHiddenColumns = {};
