import { useState } from "react";
import { Header } from "./components/Header";
import {
	columns,
	DataTable,
	mobileHiddenColumns,
	SplitsEmptyState,
} from "./components/splits";
import { mockSplits } from "./data/mocks";

// Mock wallet address for testing
const MOCK_WALLET_ADDRESS = "8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

export default function App() {
	// Mock auth state - toggle to test different views
	const [isAuthenticated, setIsAuthenticated] = useState(true);

	// TODO: Replace with actual data from SDK/TanStack Query
	const splits = isAuthenticated ? mockSplits : [];

	const handleToggleAuth = () => {
		setIsAuthenticated((prev) => !prev);
	};

	const handleCreateSplit = () => {
		// TODO: Navigate to create split page or open modal
		console.log("Create split clicked");
	};

	return (
		<div className="min-h-screen bg-background text-foreground">
			<Header
				isAuthenticated={isAuthenticated}
				walletAddress={isAuthenticated ? MOCK_WALLET_ADDRESS : undefined}
				onToggleAuth={handleToggleAuth}
			/>
			<main className="container mx-auto px-4 py-8">
				<div className="mb-6">
					<h1 className="text-2xl font-bold md:text-3xl">Your Splits</h1>
					<p className="text-muted-foreground mt-1">
						Manage your payment split configurations
					</p>
				</div>

				{!isAuthenticated || splits.length === 0 ? (
					<SplitsEmptyState
						isAuthenticated={isAuthenticated}
						onCreateSplit={handleCreateSplit}
						onConnectWallet={handleToggleAuth}
					/>
				) : (
					<DataTable
						columns={columns}
						data={splits}
						initialColumnVisibility={mobileHiddenColumns}
					/>
				)}
			</main>
		</div>
	);
}
