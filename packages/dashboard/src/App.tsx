import { useState, useMemo, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import {
	USDC_MINT,
	type ShareRecipient,
	type SplitWithBalance,
} from "@cascade-fyi/splits-sdk";
import {
	useSplits,
	useCreateSplit,
	useExecuteSplit,
	useUpdateSplit,
	useCloseSplit,
	type MutationConfig,
} from "@cascade-fyi/splits-sdk/react";

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

// Mainnet transaction config - priority fees help transactions land on congested network
const CREATE_CONFIG: MutationConfig = {
	priorityFee: 50_000, // 50k microlamports
	computeUnits: 200_000,
};

const EXECUTE_CONFIG: MutationConfig = {
	priorityFee: 50_000,
	computeUnits: 300_000, // Execute needs more CUs for multiple transfers
};

export default function App() {
	const { connected } = useWallet();

	// Data fetching
	const { data: splits = [], isLoading, error, refetch } = useSplits();

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

	// Mutations with mainnet config
	const createSplitMutation = useCreateSplit(CREATE_CONFIG);
	const executeSplitMutation = useExecuteSplit(EXECUTE_CONFIG);
	const updateSplitMutation = useUpdateSplit(CREATE_CONFIG);
	const closeSplitMutation = useCloseSplit(CREATE_CONFIG);

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

	// Stable execute callback - mutateAsync reference is stable from TanStack Query
	const handleExecuteSplit = useCallback(
		async (vault: string) => {
			setExecutingVault(vault);
			const toastId = toast.loading("Signing transaction...");
			try {
				// Update toast once wallet interaction starts
				setTimeout(() => {
					toast.loading("Confirming transaction...", { id: toastId });
				}, 2000); // Approximate time for wallet popup

				const result = await executeSplitMutation.mutateAsync(vault);
				toast.success("Split executed!", {
					id: toastId,
					description: `Funds distributed. Signature: ${result.signature.slice(0, 8)}...`,
					action: {
						label: "View",
						onClick: () =>
							openExternal(`https://solscan.io/tx/${result.signature}`),
					},
				});
			} catch (err) {
				toast.error("Failed to execute split", {
					id: toastId,
					description: err instanceof Error ? err.message : "Unknown error",
				});
			} finally {
				setExecutingVault(null);
			}
		},
		[executeSplitMutation.mutateAsync],
	);

	// Callbacks for update/close actions
	const handleUpdateSplit = useCallback((split: SplitWithBalance) => {
		setSelectedSplit(split);
		setUpdateDialogOpen(true);
	}, []);

	const handleCloseSplit = useCallback((split: SplitWithBalance) => {
		setSelectedSplit(split);
		setCloseDialogOpen(true);
	}, []);

	// Handlers for dialog submissions - dialogs handle errors internally
	const handleUpdateSubmit = async (
		vault: string,
		recipients: ShareRecipient[],
	) => {
		const result = await updateSplitMutation.mutateAsync({
			vault,
			recipients,
		});
		toast.success("Recipients updated!", {
			description: `Signature: ${result.signature.slice(0, 8)}...`,
			action: {
				label: "View",
				onClick: () =>
					openExternal(`https://solscan.io/tx/${result.signature}`),
			},
		});
	};

	const handleCloseSubmit = async (vault: string) => {
		const result = await closeSplitMutation.mutateAsync(vault);
		toast.success("Split closed!", {
			description: `Rent returned. Signature: ${result.signature.slice(0, 8)}...`,
			action: {
				label: "View",
				onClick: () =>
					openExternal(`https://solscan.io/tx/${result.signature}`),
			},
		});
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

	const handleCreateSplit = async (recipients: ShareRecipient[]) => {
		const toastId = toast.loading("Signing transaction...");
		try {
			setTimeout(() => {
				toast.loading("Confirming transaction...", { id: toastId });
			}, 2000);

			const result = await createSplitMutation.mutateAsync({
				recipients,
				token: USDC_MINT,
			});
			toast.success("Split created!", {
				id: toastId,
				description: `Vault: ${result.vault.slice(0, 8)}...${result.vault.slice(-4)}`,
				action: {
					label: "View",
					onClick: () =>
						openExternal(`https://solscan.io/account/${result.vault}`),
				},
			});
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
				split={selectedSplit}
				open={updateDialogOpen}
				onOpenChange={setUpdateDialogOpen}
				onSubmit={handleUpdateSubmit}
				isPending={updateSplitMutation.isPending}
			/>
			<CloseSplitDialog
				split={selectedSplit}
				open={closeDialogOpen}
				onOpenChange={setCloseDialogOpen}
				onConfirm={handleCloseSubmit}
				isPending={closeSplitMutation.isPending}
			/>

			<Toaster />
		</div>
	);
}
