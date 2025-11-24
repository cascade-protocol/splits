import { Plus, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

interface SplitsEmptyStateProps {
	isAuthenticated?: boolean;
	onCreateSplit?: () => void;
	onConnectWallet?: () => void;
}

export function SplitsEmptyState({
	isAuthenticated = false,
	onCreateSplit,
	onConnectWallet,
}: SplitsEmptyStateProps) {
	if (!isAuthenticated) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Wallet />
					</EmptyMedia>
					<EmptyTitle>Connect Your Wallet</EmptyTitle>
					<EmptyDescription>
						Connect your Solana wallet to view and manage your payment splits.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={onConnectWallet}>
						<Wallet className="mr-2 h-4 w-4" />
						Connect Wallet
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Plus />
				</EmptyMedia>
				<EmptyTitle>No Splits Yet</EmptyTitle>
				<EmptyDescription>
					You haven't created any payment splits yet. Create your first split to
					start distributing payments automatically.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button onClick={onCreateSplit}>
					<Plus className="mr-2 h-4 w-4" />
					Create Split
				</Button>
			</EmptyContent>
		</Empty>
	);
}
