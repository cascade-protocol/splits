import { ArrowDown, Copy } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * Static explainer showing how payment splits work.
 * Emphasizes the vault address concept - it's just an address you share.
 */
export function SplitExplainer() {
	return (
		<div className="flex w-full max-w-md flex-col items-center py-8 md:py-12">
			{/* Headline */}
			<div className="text-center mb-8 md:mb-10">
				<h1 className="text-2xl font-bold tracking-tight mb-2 sm:text-3xl md:text-4xl md:mb-3">
					Split payments automatically
				</h1>
				<p className="text-muted-foreground text-sm sm:text-base md:text-lg">
					Native payment splitting for x402 on Solana.
				</p>
			</div>

			{/* Flow Diagram */}
			<div className="w-full mb-8 md:mb-10">
				{/* Vault Address - the key concept */}
				<div className="border rounded-lg p-4 bg-muted/30 mb-1">
					<p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
						Your Split Address
					</p>
					<div className="flex items-center gap-2 p-2.5 bg-background rounded-md border font-mono text-xs">
						<span className="text-muted-foreground break-all">
							7xKpQ9Lm2Rn3Wp4Ys5Zt6Au7Bv8Cw9Dx1Ey2Fz3mNq
						</span>
						<Copy className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
					</div>
					<p className="text-xs text-muted-foreground mt-2">
						Share this address to receive payments
					</p>
				</div>

				{/* Arrow down */}
				<div className="flex justify-center py-2">
					<ArrowDown className="h-5 w-5 text-muted-foreground/40" />
				</div>

				{/* Auto-split visualization */}
				<div className="border rounded-lg p-4 bg-background">
					<p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
						Automatically splits to
					</p>

					{/* Recipients - 10/90 marketplace split */}
					<div className="space-y-2">
						<div className="flex items-center justify-between p-3 bg-muted/30 rounded-md">
							<div className="flex items-center gap-2">
								<div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-medium text-blue-600">
									1
								</div>
								<span className="text-sm text-muted-foreground">Platform</span>
							</div>
							<span className="font-semibold">10%</span>
						</div>

						<div className="flex items-center justify-between p-3 bg-muted/30 rounded-md">
							<div className="flex items-center gap-2">
								<div className="h-7 w-7 rounded-full bg-emerald-500/10 flex items-center justify-center text-xs font-medium text-emerald-600">
									2
								</div>
								<span className="text-sm text-muted-foreground">Merchant</span>
							</div>
							<span className="font-semibold">90%</span>
						</div>
					</div>
				</div>

				{/* Bottom note */}
				<p className="text-center text-xs text-muted-foreground mt-3">
					Permissionless · Non-custodial · 1% protocol fee
				</p>
			</div>

			{/* CTA - uses wallet adapter button for connecting */}
			<WalletMultiButton />
		</div>
	);
}
