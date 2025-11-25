import { useState, useMemo, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { USDC_MINT, type ShareRecipient } from "@cascade-fyi/splits-sdk";
import {
	useSplits,
	useCreateSplit,
	useExecuteSplit,
	type MutationConfig,
} from "@cascade-fyi/splits-sdk/react";

import { Header } from "./components/Header";
import {
	createColumns,
	CreateSplitForm,
	DataTable,
	mobileHiddenColumns,
	SplitExplainer,
} from "./components/splits";
import { Button } from "./components/ui/button";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { Toaster } from "./components/ui/sonner";

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

	// Mutations with mainnet config
	const createSplitMutation = useCreateSplit(CREATE_CONFIG);
	const executeSplitMutation = useExecuteSplit(EXECUTE_CONFIG);

	// Track which vault is being executed (for loading state in table)
	const [executingVault, setExecutingVault] = useState<string | null>(null);

	// Stable execute callback - mutateAsync reference is stable from TanStack Query
	const handleExecuteSplit = useCallback(
		async (vault: string) => {
			setExecutingVault(vault);
			try {
				const result = await executeSplitMutation.mutateAsync(vault);
				toast.success("Split executed!", {
					description: `Funds distributed. Signature: ${result.signature.slice(0, 8)}...`,
					action: {
						label: "View",
						onClick: () =>
							window.open(
								`https://solscan.io/tx/${result.signature}`,
								"_blank",
							),
					},
				});
			} catch (err) {
				toast.error("Failed to execute split", {
					description: err instanceof Error ? err.message : "Unknown error",
				});
			} finally {
				setExecutingVault(null);
			}
		},
		[executeSplitMutation.mutateAsync],
	);

	// Create columns - only recreate when executingVault changes for loading state
	const columns = useMemo(
		() => createColumns(handleExecuteSplit, executingVault),
		[handleExecuteSplit, executingVault],
	);

	const handleCreateSplit = async (recipients: ShareRecipient[]) => {
		try {
			const result = await createSplitMutation.mutateAsync({
				recipients,
				token: USDC_MINT,
			});
			toast.success("Split created!", {
				description: `Vault: ${result.vault.slice(0, 8)}...${result.vault.slice(-4)}`,
				action: {
					label: "View",
					onClick: () =>
						window.open(`https://solscan.io/account/${result.vault}`, "_blank"),
				},
			});
		} catch (err) {
			toast.error("Failed to create split", {
				description: err instanceof Error ? err.message : "Unknown error",
			});
		}
	};

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Header />

			<ErrorBoundary>
				{!connected ? (
					// Not connected: hero section fills remaining space
					<main className="flex flex-1 items-center justify-center px-4">
						<SplitExplainer />
					</main>
				) : (
					// Connected: standard content layout
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
								</div>
								<DataTable
									columns={columns}
									data={splits}
									initialColumnVisibility={mobileHiddenColumns}
								/>
							</>
						)}
					</main>
				)}
			</ErrorBoundary>
			<Toaster />
		</div>
	);
}
