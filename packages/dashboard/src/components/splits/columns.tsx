"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { SplitConfig } from "@cascade-fyi/splits-sdk";
import { Check, Copy, MoreHorizontal, ExternalLink, Users } from "lucide-react";

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
import { formatRelativeTime, hasUnclaimedAmounts } from "@/data/mocks";

/**
 * CopyButton with confirmation animation
 * Shows Check icon for 2 seconds after copying
 */
function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
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
 * Actions cell component with copy confirmation
 */
function ActionsCell({ split }: { split: SplitConfig }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(split.vault);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

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
				<DropdownMenuItem onClick={handleCopy}>
					{copied ? (
						<Check className="mr-2 h-4 w-4 text-green-500" />
					) : (
						<Copy className="mr-2 h-4 w-4" />
					)}
					{copied ? "Copied!" : "Copy vault address"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						// TODO: Navigate to split detail or open modal
						console.log("Opening split:", split.vault);
					}}
				>
					<ExternalLink className="mr-2 h-4 w-4" />
					View details
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export const columns: ColumnDef<SplitConfig>[] = [
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
			return <ActionsCell split={row.original} />;
		},
	},
];

// Mobile-optimized columns (hide some on small screens)
export const mobileHiddenColumns = {
	lastActivity: false, // Hidden by default on mobile
};
