import { useState } from "react";
import { ArrowDown, Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "../ui/button";

const CODE_SNIPPET = `import { createSplitsClient } from "@cascade-fyi/splits-sdk";

const splits = createSplitsClient({ rpc, rpcSubscriptions, signer });

const result = await splits.ensureSplit({
  recipients: [
    { address: "Agent111...", share: 90 },
    { address: "Marketplace111...", share: 10 },
  ],
});

// result.vault is your payment address`;

const NPM_INSTALL = "npm install @cascade-fyi/splits-sdk";

/**
 * Static explainer showing how payment splits work.
 * Emphasizes the vault address concept - it's just an address you share.
 */
export function SplitExplainer() {
	const [copiedCode, setCopiedCode] = useState(false);
	const [copiedNpm, setCopiedNpm] = useState(false);

	const copyToClipboard = async (text: string, type: "code" | "npm") => {
		await navigator.clipboard.writeText(text);
		if (type === "code") {
			setCopiedCode(true);
			setTimeout(() => setCopiedCode(false), 2000);
		} else {
			setCopiedNpm(true);
			setTimeout(() => setCopiedNpm(false), 2000);
		}
	};

	return (
		<div className="flex w-full max-w-xl flex-col items-center py-8 md:py-12">
			{/* Positioning Badge */}
			<div className="mb-4 rounded-full border border-border/50 bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
				First x402-native splitter on Solana
			</div>

			{/* Headline */}
			<div className="mb-8 text-center md:mb-10">
				<h1 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl md:mb-3 md:text-4xl">
					Revenue sharing in 5 minutes
				</h1>
				<p className="text-sm text-muted-foreground sm:text-base md:text-lg">
					Native payment splitting for x402 on Solana.
				</p>
			</div>

			{/* Flow Diagram */}
			<div className="mb-6 w-full md:mb-8">
				{/* Vault Address - the key concept */}
				<div className="mb-1 rounded-lg border bg-muted/30 p-4">
					<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Your Split Address
					</p>
					<div className="flex items-center gap-2 rounded-md border bg-background p-2.5 font-mono text-xs min-w-0 w-full">
						<span className="break-all text-muted-foreground">
							7xKpQ9Lm2Rn3Wp4Ys5Zt6Au7Bv8Cw9Dx1Ey2Fz3mNq
						</span>
						<Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						Share this address to receive payments
					</p>
				</div>

				{/* Arrow down */}
				<div className="flex justify-center py-2">
					<ArrowDown className="h-5 w-5 text-muted-foreground/40" />
				</div>

				{/* Auto-split visualization */}
				<div className="rounded-lg border bg-background p-4">
					<p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Automatically splits to
					</p>

					{/* Recipients - 90/10 agent/marketplace split */}
					<div className="space-y-2">
						<div className="flex items-center justify-between rounded-md bg-muted/30 p-3">
							<div className="flex items-center gap-2">
								<div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-medium text-emerald-600">
									1
								</div>
								<span className="text-sm text-muted-foreground">Agent</span>
							</div>
							<span className="font-semibold">90%</span>
						</div>

						<div className="flex items-center justify-between rounded-md bg-muted/30 p-3">
							<div className="flex items-center gap-2">
								<div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 text-xs font-medium text-blue-600">
									2
								</div>
								<span className="text-sm text-muted-foreground">
									Marketplace
								</span>
							</div>
							<span className="font-semibold">10%</span>
						</div>
					</div>
				</div>
			</div>

			{/* Use Case Badges */}
			<div className="mb-8 flex flex-wrap justify-center gap-2">
				<span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
					Marketplaces
				</span>
				<span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
					API Monetization
				</span>
				<span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
					Agent Payments
				</span>
			</div>

			{/* SDK Code Snippet */}
			<div className="mb-4 w-full">
				<div className="relative rounded-lg border bg-muted/30 min-w-0">
					<pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground">
						{CODE_SNIPPET}
					</pre>
					<Button
						variant="ghost"
						size="icon"
						className="absolute right-2 top-2 h-7 w-7 text-muted-foreground hover:text-foreground"
						onClick={() => copyToClipboard(CODE_SNIPPET, "code")}
					>
						{copiedCode ? (
							<Check className="h-3.5 w-3.5 text-emerald-500" />
						) : (
							<Copy className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			</div>

			{/* NPM Install */}
			<div className="mb-6 w-full">
				<div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5">
					<code className="flex-1 font-mono text-xs text-muted-foreground">
						{NPM_INSTALL}
					</code>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
						onClick={() => copyToClipboard(NPM_INSTALL, "npm")}
					>
						{copiedNpm ? (
							<Check className="h-3.5 w-3.5 text-emerald-500" />
						) : (
							<Copy className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			</div>

			{/* Links */}
			<div className="mb-6 flex items-center gap-4">
				<a
					href="https://github.com/cascade-protocol/splits"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<span>GitHub</span>
					<ExternalLink className="h-3.5 w-3.5" />
				</a>
				<a
					href="https://www.npmjs.com/package/@cascade-fyi/splits-sdk"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<span>NPM</span>
					<ExternalLink className="h-3.5 w-3.5" />
				</a>
				<a
					href="https://github.com/cascade-protocol/splits/blob/main/packages/splits-sdk/README.md"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<span>Docs</span>
					<ExternalLink className="h-3.5 w-3.5" />
				</a>
			</div>

			{/* Trust Line */}
			<p className="text-center text-xs text-muted-foreground">
				Permissionless · Non-custodial · 1% protocol fee
			</p>
		</div>
	);
}
