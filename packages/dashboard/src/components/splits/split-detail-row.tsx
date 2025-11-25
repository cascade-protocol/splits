import {
	hasUnclaimedAmounts,
	type SplitWithBalance,
} from "@cascade-fyi/splits-sdk";

// USDC decimals
const USDC_DECIMALS = 6;

function formatBalance(amount: bigint): string {
	const value = Number(amount) / 10 ** USDC_DECIMALS;
	if (value === 0) return "0.00 USDC";
	if (value < 0.01) return "< 0.01 USDC";
	return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

interface SplitDetailRowProps {
	split: SplitWithBalance;
}

export function SplitDetailRow({ split }: SplitDetailRowProps) {
	const hasUnclaimed = hasUnclaimedAmounts(split);

	return (
		<div className="p-4 bg-muted/30 border-t space-y-4">
			{/* Recipients breakdown */}
			<div>
				<h4 className="font-medium text-sm mb-3">Recipients</h4>
				<div className="space-y-2">
					{split.recipients.map((r) => {
						// Find unclaimed amount for this recipient (if any)
						const unclaimedEntry = split.unclaimedAmounts.find(
							(u) => u.recipient === r.address,
						);
						const unclaimedAmount = unclaimedEntry?.amount ?? 0n;

						return (
							<div
								key={r.address}
								className="flex items-center justify-between gap-4 text-sm"
							>
								<code className="font-mono text-xs bg-muted px-2 py-1 rounded truncate max-w-[200px] md:max-w-none">
									{r.address}
								</code>
								<div className="flex items-center gap-3 shrink-0">
									<span className="font-medium">{r.share}%</span>
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
			{split.protocolUnclaimed > 0n && (
				<div className="text-sm text-muted-foreground">
					Protocol fee unclaimed: {formatBalance(split.protocolUnclaimed)}
				</div>
			)}
		</div>
	);
}
