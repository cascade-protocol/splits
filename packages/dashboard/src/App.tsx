import { useState, useMemo, useCallback } from "react";
import { useWallet } from "@solana/react-hooks";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { RefreshCw } from "lucide-react";
import { USDC_MINT, type Recipient } from "@cascade-fyi/splits-sdk";
import {
	useSplitsWithBalances,
	useCreateSplit,
	useExecuteSplit,
	useUpdateSplit,
	useCloseSplit,
	type SplitWithBalance,
} from "./hooks/use-splits";

import { useCreationTimestamps } from "./hooks/use-creation-timestamps";

import { Header } from "./components/Header";
import {
	createColumns,
	CloseSplitDialog,
	CreateSplitDialog,
	CreateSplitForm,
	DataTable,
	mobileHiddenColumns,
	SplitExplainer,
	UpdateSplitDialog,
	type SplitActions,
} from "./components/splits";
import { Button } from "./components/ui/button";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { Toaster } from "./components/ui/sonner";
import { openExternal } from "./lib/utils";

export default function App() {
	const wallet = useWallet();
	const connected = wallet.status === "connected";

	// Data fetching with real-time balance updates via WebSocket
	const {
		data: splits = [],
		isLoading,
		error,
		refetch,
	} = useSplitsWithBalances();

	// Fetch creation timestamps (cached indefinitely - they never change)
	const { timestamps } = useCreationTimestamps(splits);

	// Enrich splits with createdAt for table display
	const splitsWithCreatedAt = useMemo(
		() =>
			splits.map((split) => ({
				...split,
				createdAt: timestamps.get(split.address) ?? null,
			})),
		[splits, timestamps],
	);

	// Mutations (priority fees handled in hooks)
	const createSplitMutation = useCreateSplit();
	const executeSplitMutation = useExecuteSplit();
	const updateSplitMutation = useUpdateSplit();
	const closeSplitMutation = useCloseSplit();

	// Track which vault is being executed (for loading state in table)
	const [executingVault, setExecutingVault] = useState<string | null>(null);

	// View navigation - allows connected users to switch between About and Dashboard
	const [showAbout, setShowAbout] = useState(false);

	// Dialog state for update/close actions
	const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
	const [closeDialogOpen, setCloseDialogOpen] = useState(false);
	const [selectedSplit, setSelectedSplit] = useState<SplitWithBalance | null>(
		null,
	);

	const handleExecuteSplit = useCallback(
		async (splitConfig: SplitWithBalance) => {
			setExecutingVault(splitConfig.vault as string);
			const toastId = toast.loading("Signing transaction...");
			try {
				// Update toast once wallet interaction starts
				setTimeout(() => {
					toast.loading("Confirming transaction...", { id: toastId });
				}, 2000); // Approximate time for wallet popup

				const result = await executeSplitMutation.mutate(splitConfig);
				toast.success("Split executed!", {
					id: toastId,
					description: `Funds distributed. Signature: ${result.signature.slice(0, 8)}...`,
					action: {
						label: "View",
						onClick: () =>
							openExternal(`https://solscan.io/tx/${result.signature}`),
					},
				});
				refetch();
			} catch (err) {
				toast.error("Failed to execute split", {
					id: toastId,
					description: err instanceof Error ? err.message : "Unknown error",
				});
			} finally {
				setExecutingVault(null);
			}
		},
		[executeSplitMutation.mutate, refetch],
	);

	// Callbacks for update/close actions
	const handleUpdateSplit = useCallback((splitConfig: SplitWithBalance) => {
		setSelectedSplit(splitConfig);
		setUpdateDialogOpen(true);
	}, []);

	const handleCloseSplit = useCallback((splitConfig: SplitWithBalance) => {
		setSelectedSplit(splitConfig);
		setCloseDialogOpen(true);
	}, []);

	// Handlers for dialog submissions - dialogs handle errors internally
	const handleUpdateSubmit = async (
		splitConfig: SplitWithBalance,
		recipients: Recipient[],
	) => {
		const result = await updateSplitMutation.mutate(splitConfig, recipients);
		toast.success("Recipients updated!", {
			description: `Signature: ${result.signature.slice(0, 8)}...`,
			action: {
				label: "View",
				onClick: () =>
					openExternal(`https://solscan.io/tx/${result.signature}`),
			},
		});
		refetch();
	};

	const handleCloseSubmit = async (splitConfig: SplitWithBalance) => {
		const result = await closeSplitMutation.mutate(splitConfig);
		toast.success("Split closed!", {
			description: `Rent returned. Signature: ${result.signature.slice(0, 8)}...`,
			action: {
				label: "View",
				onClick: () =>
					openExternal(`https://solscan.io/tx/${result.signature}`),
			},
		});
		refetch();
	};

	// Split actions object for table columns
	const splitActions: SplitActions = useMemo(
		() => ({
			onExecute: handleExecuteSplit,
			onUpdate: handleUpdateSplit,
			onClose: handleCloseSplit,
		}),
		[handleExecuteSplit, handleUpdateSplit, handleCloseSplit],
	);

	// Create columns - only recreate when executingVault changes for loading state
	const columns = useMemo(
		() => createColumns(splitActions, executingVault),
		[splitActions, executingVault],
	);

	const handleCreateSplit = async (recipients: Recipient[]) => {
		const toastId = toast.loading("Signing transaction...");
		try {
			setTimeout(() => {
				toast.loading("Confirming transaction...", { id: toastId });
			}, 2000);

			const result = await createSplitMutation.mutate(
				recipients,
				USDC_MINT as Address,
			);
			const vault = result.vault;
			toast.success("Split created!", {
				id: toastId,
				description: vault
					? `Vault: ${vault.slice(0, 8)}...${vault.slice(-4)}`
					: `Signature: ${result.signature.slice(0, 8)}...`,
				action: vault
					? {
							label: "View",
							onClick: () =>
								openExternal(`https://solscan.io/account/${vault}`),
						}
					: undefined,
			});
			refetch();
		} catch (err) {
			toast.error("Failed to create split", {
				id: toastId,
				description: err instanceof Error ? err.message : "Unknown error",
			});
		}
	};

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Header
				showAbout={showAbout}
				onNavigate={setShowAbout}
				showNav={connected}
			/>

			<ErrorBoundary>
				{!connected || showAbout ? (
					// Not connected or viewing About: hero section fills remaining space
					<main className="flex flex-1 items-center justify-center px-4">
						<SplitExplainer />
					</main>
				) : (
					// Connected and viewing Dashboard: standard content layout
					<main className="container mx-auto flex-1 px-4 py-8">
						{isLoading ? (
							<div className="flex items-center justify-center py-16">
								<div className="text-muted-foreground">Loading splits...</div>
							</div>
						) : error ? (
							<div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
								<p className="text-destructive font-medium">
									Failed to load splits
								</p>
								<p className="text-muted-foreground text-sm max-w-md">
									{error instanceof Error ? error.message : "Unknown error"}
								</p>
								<Button onClick={() => refetch()} variant="outline">
									<RefreshCw className="mr-2 h-4 w-4" />
									Try again
								</Button>
							</div>
						) : splits.length === 0 ? (
							<CreateSplitForm
								onSubmit={handleCreateSplit}
								isPending={createSplitMutation.isPending}
							/>
						) : (
							<>
								<div className="mb-6 flex items-center justify-between">
									<div>
										<h1 className="text-2xl font-bold md:text-3xl">
											Your Splits
										</h1>
										<p className="text-muted-foreground mt-1">
											Manage your payment split configurations
										</p>
									</div>
									<CreateSplitDialog
										onSubmit={handleCreateSplit}
										isPending={createSplitMutation.isPending}
									/>
								</div>
								<DataTable
									columns={columns}
									data={splitsWithCreatedAt}
									initialColumnVisibility={mobileHiddenColumns}
								/>
							</>
						)}
					</main>
				)}
			</ErrorBoundary>

			{/* Footer */}
			<footer className="border-t py-4 px-4 mt-auto">
				<div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
					<div className="flex items-center gap-2">
						<span>Cascade Splits</span>
						<span className="text-xs">© 2025</span>
						<span className="text-xs text-amber-600">
							Unaudited — use at your own risk
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs bg-muted px-2 py-0.5 rounded">
							Mainnet
						</span>
						<a
							href="https://solscan.io/account/SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB"
							target="_blank"
							rel="noopener noreferrer"
							className="font-mono text-xs hover:text-foreground transition-colors"
						>
							SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB
						</a>
					</div>
				</div>
			</footer>

			{/* Update/Close dialogs */}
			<UpdateSplitDialog
				splitConfig={selectedSplit}
				open={updateDialogOpen}
				onOpenChange={setUpdateDialogOpen}
				onSubmit={handleUpdateSubmit}
				isPending={updateSplitMutation.isPending}
			/>
			<CloseSplitDialog
				splitConfig={selectedSplit}
				open={closeDialogOpen}
				onOpenChange={setCloseDialogOpen}
				onConfirm={handleCloseSubmit}
				isPending={closeSplitMutation.isPending}
			/>

			<Toaster />
		</div>
	);
}
