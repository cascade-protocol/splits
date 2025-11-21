import { FlowBar } from "@/components/flow-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Copy, Plus, X } from "lucide-react";
import { useState } from "react";

interface Recipient {
	address: string;
	share: number;
}

export function LandingPage({ onConnect }: { onConnect: () => void }) {
	const [recipients, setRecipients] = useState<Recipient[]>([
		{ address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", share: 60 },
		{ address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH", share: 40 },
	]);
	const [simulatedAmount, setSimulatedAmount] = useState(1000);

	// Calculate total percentage
	const totalPercentage = recipients.reduce((sum, r) => sum + r.share, 0);
	const isValid = totalPercentage === 100;

	// Mock vault address (deterministic from recipients)
	const vaultAddress = "8yTz4mK2pF9vQr3nLx7Hs5Kp2Jw6Rt8Bm4Cv9Xz1Aq3";

	const handleAddRecipient = () => {
		const newShare = Math.floor(100 / (recipients.length + 1));
		const updatedRecipients = recipients.map((r) => ({
			...r,
			share: newShare,
		}));
		setRecipients([...updatedRecipients, { address: "", share: newShare }]);
	};

	const handleRemoveRecipient = (index: number) => {
		if (recipients.length <= 1) return;
		const updated = recipients.filter((_, i) => i !== index);
		// Rebalance remaining recipients
		const sharePerRecipient = Math.floor(100 / updated.length);
		const rebalanced = updated.map((r, i) => ({
			...r,
			share:
				i === updated.length - 1
					? 100 - sharePerRecipient * (updated.length - 1)
					: sharePerRecipient,
		}));
		setRecipients(rebalanced);
	};

	const handleAddressChange = (index: number, value: string) => {
		const updated = [...recipients];
		updated[index].address = value;
		setRecipients(updated);
	};

	const handleShareChange = (index: number, value: string) => {
		const share = parseInt(value, 10) || 0;
		const updated = [...recipients];
		updated[index].share = Math.max(0, Math.min(99, share));
		setRecipients(updated);
	};

	const handleCopyVault = () => {
		navigator.clipboard.writeText(vaultAddress);
	};

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			{/* Hero */}
			<div className="space-y-4 text-center">
				<h1 className="text-4xl font-bold md:text-5xl">
					Split Solana Payments. Automatically.
				</h1>
				<p className="text-lg text-muted-foreground md:text-xl">
					One address receives. Multiple wallets paid.
				</p>
			</div>

			{/* Interactive Builder */}
			<Card>
				<CardHeader>
					<CardTitle>Create Your Split</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					{/* Vault Preview */}
					<div className="rounded-lg border bg-muted/50 p-4">
						<div className="mb-2 text-sm text-muted-foreground">
							Payments arrive at:
						</div>
						<div className="flex items-center gap-2">
							<code className="flex-1 text-sm">
								{vaultAddress.slice(0, 8)}...{vaultAddress.slice(-8)}
							</code>
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								onClick={handleCopyVault}
							>
								<Copy className="size-4" />
								<span className="sr-only">Copy vault address</span>
							</Button>
						</div>
					</div>

					{/* Automatically split to: */}
					<div className="space-y-4">
						<div className="text-sm font-medium">Automatically split to:</div>

						{recipients.map((recipient, index) => (
							<div
								key={recipient.address || `recipient-${index}`}
								className="space-y-3"
							>
								<div className="flex gap-2">
									<Input
										placeholder="Solana address"
										value={recipient.address}
										onChange={(e) => handleAddressChange(index, e.target.value)}
										className="flex-1 font-mono text-sm"
									/>
									<Input
										type="number"
										min="1"
										max="99"
										value={recipient.share}
										onChange={(e) => handleShareChange(index, e.target.value)}
										className="w-20 text-center"
									/>
									<span className="flex items-center text-sm text-muted-foreground">
										%
									</span>
									{recipients.length > 1 && (
										<Button
											variant="ghost"
											size="icon"
											onClick={() => handleRemoveRecipient(index)}
										>
											<X className="size-4" />
											<span className="sr-only">Remove recipient</span>
										</Button>
									)}
								</div>

								{/* Flow Bar Preview */}
								{recipient.address && (
									<FlowBar
										address={recipient.address}
										share={recipient.share}
										amount={Math.floor(
											(simulatedAmount * recipient.share) / 100,
										)}
									/>
								)}
							</div>
						))}

						<Button
							variant="outline"
							onClick={handleAddRecipient}
							className="w-full"
						>
							<Plus className="size-4" />
							Add Recipient
						</Button>
					</div>

					{/* Total Percentage */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<span className="text-sm font-medium">Total:</span>
						<span
							className={`text-lg font-bold ${isValid ? "text-green-500" : "text-destructive"}`}
						>
							{totalPercentage}%{isValid && " ✓"}
							{!isValid && ` (must equal 100%)`}
						</span>
					</div>

					{/* Simulation Amount */}
					<div className="space-y-2">
						<label htmlFor="simulation-amount" className="text-sm font-medium">
							Simulate with amount (USDC):
						</label>
						<Input
							id="simulation-amount"
							type="number"
							value={simulatedAmount}
							onChange={(e) =>
								setSimulatedAmount(parseInt(e.target.value, 10) || 0)
							}
							className="w-full"
						/>
					</div>
				</CardContent>
			</Card>

			{/* CTA */}
			<div className="space-y-4 text-center">
				<p className="text-sm text-muted-foreground">
					{isValid
						? "Your split is ready to deploy!"
						: "Adjust percentages to total 100%"}
				</p>
				<Button size="lg" onClick={onConnect} disabled={!isValid}>
					Connect Wallet to Deploy
				</Button>
			</div>
		</div>
	);
}
