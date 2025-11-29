import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { SplitWithBalance } from "@/hooks/use-splits";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CloseSplitDialogProps {
	splitConfig: SplitWithBalance | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (splitConfig: SplitWithBalance) => Promise<void>;
	isPending: boolean;
}

export function CloseSplitDialog({
	splitConfig,
	open,
	onOpenChange,
	onConfirm,
	isPending,
}: CloseSplitDialogProps) {
	const [error, setError] = useState<string | null>(null);

	// Reset error when dialog opens/closes
	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) setError(null);
		onOpenChange(isOpen);
	};

	const handleConfirm = async () => {
		if (!splitConfig) return;
		setError(null);

		try {
			await onConfirm(splitConfig);
			onOpenChange(false); // Only close on success
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to close split");
			// Don't close - let user retry
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Close this split?</AlertDialogTitle>
					<AlertDialogDescription>
						This action cannot be undone. The split configuration will be
						permanently deleted and rent will be returned to your wallet.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{splitConfig && (
					<div className="rounded-md bg-muted p-3 text-sm">
						<div className="font-mono text-xs text-muted-foreground mb-1">
							Vault
						</div>
						<div className="font-mono text-xs break-all">
							{splitConfig.vault}
						</div>
					</div>
				)}
				{/* Error display */}
				{error && (
					<div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
						<AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
						<span>{error}</span>
					</div>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirm}
						disabled={isPending}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{isPending ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Closing...
							</>
						) : (
							"Close Split"
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
