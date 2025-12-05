/**
 * EVM Splits Dashboard
 *
 * Dashboard for managing EVM chain splits. Supports create and execute only
 * (EVM splits are immutable - no update/close).
 */

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import {
	useEvmSplits,
	useEnsureSplit,
	useExecuteSplit,
	type EvmSplitWithBalance,
} from "@/hooks/use-splits-evm";
import { useConnection } from "wagmi";

import {
	DataTable,
	EvmCreateSplitForm,
	EvmCreateSplitDialog,
	createColumns,
	EvmSplitDetailRow,
} from "@/components/evm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { openExternal } from "@/lib/utils";

// =============================================================================
// Dashboard Component
// =============================================================================

export function EvmDashboard() {
	const { isConnected } = useConnection();
	const { data: splits = [], isLoading, error, refetch } = useEvmSplits();
	const { ensureSplit, isPending: isCreating } = useEnsureSplit();
	const { executeSplit } = useExecuteSplit();

	const [executingAddress, setExecutingAddress] = useState<string | null>(null);

	const handleExecuteSplit = useCallback(
		async (split: EvmSplitWithBalance) => {
			if (!isConnected) {
				toast.error("Connect wallet first");
				return;
			}
			setExecutingAddress(split.address);
			const toastId = toast.loading("Signing transaction...");

			try {
				setTimeout(() => {
					toast.loading("Confirming transaction...", { id: toastId });
				}, 2000);

				const result = await executeSplit(split.address);

				if (result.status === "EXECUTED") {
					toast.success("Split executed!", {
						id: toastId,
						description: `Funds distributed. Tx: ${result.txHash.slice(0, 10)}...`,
						action: {
							label: "View",
							onClick: () =>
								openExternal(`https://basescan.org/tx/${result.txHash}`),
						},
					});
					refetch();
				} else if (result.status === "SKIPPED") {
					toast.info("Execution skipped", {
						id: toastId,
						description: result.reason,
					});
				} else {
					toast.error("Failed to execute split", {
						id: toastId,
						description: result.error,
					});
				}
			} catch (err) {
				toast.error("Failed to execute split", {
					id: toastId,
					description: err instanceof Error ? err.message : "Unknown error",
				});
			} finally {
				setExecutingAddress(null);
			}
		},
		[isConnected, executeSplit, refetch],
	);

	const columns = useMemo(
		() => createColumns({ onExecute: handleExecuteSplit }, executingAddress),
		[handleExecuteSplit, executingAddress],
	);

	const handleCreateSplit = async (
		recipients: Array<{ address: string; share: number }>,
	) => {
		if (!isConnected) {
			toast.error("Connect wallet first");
			return;
		}
		const toastId = toast.loading("Signing transaction...");

		try {
			setTimeout(() => {
				toast.loading("Confirming transaction...", { id: toastId });
			}, 2000);

			// Generate unique ID
			const uniqueId =
				`0x${crypto.randomUUID().replace(/-/g, "").padStart(64, "0")}` as `0x${string}`;

			const result = await ensureSplit({
				uniqueId,
				recipients: recipients.map((r) => ({
					address: r.address as `0x${string}`,
					share: r.share,
				})),
			});

			if (result.status === "CREATED") {
				toast.success("Split created!", {
					id: toastId,
					description: `Transaction: ${result.txHash.slice(0, 10)}...`,
					action: {
						label: "View",
						onClick: () =>
							openExternal(`https://basescan.org/tx/${result.txHash}`),
					},
				});
				refetch();
			} else if (result.status === "NO_CHANGE") {
				toast.info("Split already exists", { id: toastId });
			} else {
				toast.error("Failed to create split", {
					id: toastId,
					description: result.error,
				});
			}
		} catch (err) {
			toast.error("Failed to create split", {
				id: toastId,
				description: err instanceof Error ? err.message : "Unknown error",
			});
		}
	};

	return (
		<main className="container mx-auto flex-1 px-4 md:px-6 py-8">
			{isLoading ? (
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<div className="space-y-2">
							<Skeleton className="h-8 w-40" />
							<Skeleton className="h-4 w-64" />
						</div>
						<Skeleton className="h-9 w-32" />
					</div>
					<div className="overflow-hidden rounded-lg border">
						<div className="border-b bg-muted/50 px-4 py-3">
							<div className="flex gap-8">
								<Skeleton className="h-4 w-32" />
								<Skeleton className="h-4 w-20" />
								<Skeleton className="h-4 w-24" />
							</div>
						</div>
						{[1, 2, 3].map((n) => (
							<div
								key={`skeleton-row-${n}`}
								className="flex items-center gap-4 border-b px-4 py-4 last:border-0"
							>
								<Skeleton className="h-4 w-4" />
								<Skeleton className="h-4 w-48" />
								<Skeleton className="h-4 w-20" />
								<Skeleton className="h-4 w-16" />
								<div className="ml-auto flex gap-2">
									<Skeleton className="h-8 w-20" />
								</div>
							</div>
						))}
					</div>
				</div>
			) : error ? (
				<div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
					<p className="text-destructive font-medium">Failed to load splits</p>
					<p className="text-muted-foreground text-sm max-w-md">
						{error instanceof Error ? error.message : "Unknown error"}
					</p>
					<Button onClick={() => refetch()} variant="outline">
						<RefreshCw className="mr-2 h-4 w-4" />
						Try again
					</Button>
				</div>
			) : splits.length === 0 ? (
				<EvmCreateSplitForm
					onSubmit={handleCreateSplit}
					isPending={isCreating}
				/>
			) : (
				<>
					<div className="mb-6 flex items-center justify-between">
						<div>
							<h1 className="text-2xl font-bold md:text-3xl">Your Splits</h1>
							<p className="text-muted-foreground mt-1">
								Manage your payment split configurations
							</p>
						</div>
						<EvmCreateSplitDialog
							onSubmit={handleCreateSplit}
							isPending={isCreating}
						/>
					</div>
					<DataTable
						columns={columns}
						data={splits}
						initialColumnVisibility={{}}
						renderDetailRow={(row) => <EvmSplitDetailRow split={row} />}
					/>
				</>
			)}
		</main>
	);
}
