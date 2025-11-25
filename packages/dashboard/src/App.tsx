import { useState } from "react";
import type { ShareRecipient } from "@cascade-fyi/splits-sdk";
import { Header } from "./components/Header";
import {
	columns,
	CreateSplitForm,
	DataTable,
	mobileHiddenColumns,
	SplitExplainer,
} from "./components/splits";
import { Toaster } from "./components/ui/sonner";
import { mockSplits } from "./data/mocks";

// Mock wallet address for testing
const MOCK_WALLET_ADDRESS = "8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

export default function App() {
	// Mock auth state - toggle to test different views
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	// TODO: Replace with actual data from SDK/TanStack Query
	const splits = isAuthenticated ? mockSplits : [];

	const handleToggleAuth = () => {
		setIsAuthenticated((prev) => !prev);
	};

	const handleCreateSplit = (recipients: ShareRecipient[]) => {
		// TODO: Connect wallet if not authenticated, then submit transaction
		console.log("Creating split with recipients:", recipients);
	};

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Header
				isAuthenticated={isAuthenticated}
				walletAddress={isAuthenticated ? MOCK_WALLET_ADDRESS : undefined}
				onToggleAuth={handleToggleAuth}
			/>
			{!isAuthenticated ? (
				// Not connected: hero section fills remaining space
				<main className="flex flex-1 items-center justify-center px-4">
					<SplitExplainer onConnect={handleToggleAuth} />
				</main>
			) : (
				// Connected: standard content layout
				<main className="container mx-auto flex-1 px-4 py-8">
					{splits.length === 0 ? (
						<CreateSplitForm onSubmit={handleCreateSplit} />
					) : (
						<>
							<div className="mb-6">
								<h1 className="text-2xl font-bold md:text-3xl">Your Splits</h1>
								<p className="text-muted-foreground mt-1">
									Manage your payment split configurations
								</p>
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
			<Toaster />
		</div>
	);
}
