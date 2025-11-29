import { bpsToShares } from "@cascade-fyi/splits-sdk";
import type { SplitWithBalance } from "@/hooks/use-splits";
import { hasUnclaimedAmounts, formatBalance } from "@/lib/splits-helpers";

interface SplitDetailRowProps {
	splitConfig: SplitWithBalance;
}

export function SplitDetailRow({ splitConfig }: SplitDetailRowProps) {
	const hasUnclaimed = hasUnclaimedAmounts(splitConfig);

	return (
		<div className="p-4 bg-muted/30 border-t space-y-4">
			{/* Recipients breakdown */}
			<div>
				<h4 className="font-medium text-sm mb-3">Recipients</h4>
				<div className="space-y-2">
					{splitConfig.recipients
						.slice(0, splitConfig.recipientCount)
						.map((r) => {
							const address = r.address as string;
							// Find unclaimed amount for this recipient (if any)
							const unclaimedEntry = splitConfig.unclaimedAmounts.find(
								(u) => u.recipient === r.address,
							);
							const unclaimedAmount = unclaimedEntry?.amount ?? 0n;

							return (
								<div
									key={address}
									className="flex items-center justify-between gap-4 text-sm"
								>
									<code className="font-mono text-xs bg-muted px-2 py-1 rounded truncate max-w-[200px] md:max-w-none">
										{address}
									</code>
									<div className="flex items-center gap-3 shrink-0">
										<span className="font-medium">
											{bpsToShares(r.percentageBps)}%
										</span>
										{unclaimedAmount > 0n && (
											<span className="text-amber-500 text-xs">
												{formatBalance(unclaimedAmount)} unclaimed
											</span>
										)}
									</div>
								</div>
							);
						})}
				</div>
			</div>

			{/* Unclaimed explanation */}
			{hasUnclaimed && (
				<div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
					<p className="text-sm text-amber-600 dark:text-amber-400">
						<strong>Why are funds unclaimed?</strong> Some recipients don't have
						a USDC token account yet. When they create one (by receiving any
						USDC), the next split execution will automatically transfer their
						unclaimed amount.
					</p>
				</div>
			)}

			{/* Protocol unclaimed if any */}
			{splitConfig.protocolUnclaimed > 0n && (
				<div className="text-sm text-muted-foreground">
					Protocol fee unclaimed: {formatBalance(splitConfig.protocolUnclaimed)}
				</div>
			)}
		</div>
	);
}
