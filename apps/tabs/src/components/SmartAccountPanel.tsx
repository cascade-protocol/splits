/**
 * Smart Account Panel - All smart account UI in one component.
 *
 * Handles: onboarding, balance display, deposits, withdrawals,
 * spending limits, and API key display.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@/lib/zod-resolver";
import {
	Copy,
	Check,
	Key,
	Wallet,
	ArrowUpRight,
	ArrowDownLeft,
	Settings,
	Loader2,
} from "lucide-react";

import { useSmartAccount } from "@/hooks/use-smart-account";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatUsdc, parseUsdc } from "@/lib/squads";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DialogType = "deposit" | "withdraw" | "limits" | null;

export function SmartAccountPanel() {
	const {
		account,
		apiKey,
		isLoading,
		isPending,
		createAccount,
		deposit,
		withdraw,
		setSpendingLimit,
		revokeSpendingLimit,
	} = useSmartAccount();

	const [openDialog, setOpenDialog] = useState<DialogType>(null);

	if (isLoading) {
		return <LoadingState />;
	}

	if (!account) {
		return (
			<OnboardingCard onCreateAccount={createAccount} isPending={isPending} />
		);
	}

	return (
		<div className="space-y-6">
			{/* Balance Card */}
			<BalanceCard
				balance={account.balance}
				vaultAddress={account.vaultAddress}
				onDeposit={() => setOpenDialog("deposit")}
				onWithdraw={() => setOpenDialog("withdraw")}
				isPending={isPending}
			/>

			{/* Spending Limit Card */}
			<SpendingLimitCard
				config={account.spendingLimit}
				onConfigure={() => setOpenDialog("limits")}
				onRevoke={revokeSpendingLimit}
				isPending={isPending}
			/>

			{/* API Key Card */}
			{apiKey && <ApiKeyCard apiKey={apiKey} />}

			{/* Dialogs */}
			<DepositDialog
				open={openDialog === "deposit"}
				onOpenChange={(open) => setOpenDialog(open ? "deposit" : null)}
				onSubmit={deposit}
				isPending={isPending}
			/>

			<WithdrawDialog
				open={openDialog === "withdraw"}
				onOpenChange={(open) => setOpenDialog(open ? "withdraw" : null)}
				onSubmit={withdraw}
				maxAmount={account.balance}
				isPending={isPending}
			/>

			<SpendingLimitDialog
				open={openDialog === "limits"}
				onOpenChange={(open) => setOpenDialog(open ? "limits" : null)}
				onSubmit={setSpendingLimit}
				currentConfig={account.spendingLimit}
				isPending={isPending}
			/>
		</div>
	);
}

// === Sub-components ===

function LoadingState() {
	return (
		<Card>
			<CardContent className="flex items-center justify-center py-12">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</CardContent>
		</Card>
	);
}

function OnboardingCard({
	onCreateAccount,
	isPending,
}: {
	onCreateAccount: () => Promise<void>;
	isPending: boolean;
}) {
	return (
		<Card>
			<CardHeader className="text-center">
				<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
					<Wallet className="h-6 w-6 text-primary" />
				</div>
				<CardTitle>Create Your Smart Account</CardTitle>
				<CardDescription>
					Set up a non-custodial Smart Account powered by Squads to get your API
					key.
				</CardDescription>
			</CardHeader>
			<CardContent className="text-center">
				<Button onClick={onCreateAccount} disabled={isPending} size="lg">
					{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
					Create Smart Account
				</Button>
				<p className="mt-4 text-xs text-muted-foreground">
					This will create a Squads Smart Account with you as the owner.
				</p>
			</CardContent>
		</Card>
	);
}

function BalanceCard({
	balance,
	vaultAddress,
	onDeposit,
	onWithdraw,
	isPending,
}: {
	balance: bigint;
	vaultAddress: string;
	onDeposit: () => void;
	onWithdraw: () => void;
	isPending: boolean;
}) {
	const shortVault = `${vaultAddress.slice(0, 4)}...${vaultAddress.slice(-4)}`;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Wallet className="h-5 w-5" />
					Balance
				</CardTitle>
				<CardDescription>
					Vault: <code className="text-xs">{shortVault}</code>
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="mb-4">
					<p className="text-3xl font-bold">{formatUsdc(balance)} USDC</p>
				</div>
				<div className="flex gap-2">
					<Button onClick={onDeposit} disabled={isPending} variant="outline">
						<ArrowDownLeft className="h-4 w-4" />
						Deposit
					</Button>
					<Button
						onClick={onWithdraw}
						disabled={isPending || balance === 0n}
						variant="outline"
					>
						<ArrowUpRight className="h-4 w-4" />
						Withdraw
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function SpendingLimitCard({
	config,
	onConfigure,
	onRevoke,
	isPending,
}: {
	config: {
		dailyLimit: bigint;
		perTxLimit: bigint;
		remainingToday: bigint;
	} | null;
	onConfigure: () => void;
	onRevoke: () => Promise<void>;
	isPending: boolean;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Settings className="h-5 w-5" />
					Spending Limit
				</CardTitle>
				<CardDescription>
					{config
						? "Controls how much the facilitator can spend on your behalf"
						: "Set a spending limit to generate your API key"}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{config ? (
					<>
						<div className="mb-4 grid gap-2 text-sm">
							<div className="flex justify-between">
								<span className="text-muted-foreground">Daily Limit</span>
								<span className="font-mono">
									{formatUsdc(config.dailyLimit)} USDC
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Per Transaction</span>
								<span className="font-mono">
									{formatUsdc(config.perTxLimit)} USDC
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Remaining Today</span>
								<span className="font-mono">
									{formatUsdc(config.remainingToday)} USDC
								</span>
							</div>
						</div>
						<div className="flex gap-2">
							<Button
								onClick={onConfigure}
								disabled={isPending}
								variant="outline"
							>
								Update Limits
							</Button>
							<Button
								onClick={onRevoke}
								disabled={isPending}
								variant="destructive"
								size="sm"
							>
								Revoke
							</Button>
						</div>
					</>
				) : (
					<Button onClick={onConfigure} disabled={isPending}>
						<Key className="h-4 w-4" />
						Set Spending Limit
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

function ApiKeyCard({ apiKey }: { apiKey: string }) {
	const { isCopied, copyToClipboard } = useCopyToClipboard();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Key className="h-5 w-5" />
					API Key
				</CardTitle>
				<CardDescription>
					Use this key to access x402-enabled APIs
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center gap-2">
					<code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm break-all">
						{apiKey}
					</code>
					<Button
						variant="outline"
						size="icon"
						onClick={() => copyToClipboard(apiKey)}
					>
						{isCopied ? (
							<Check className="h-4 w-4 text-green-500" />
						) : (
							<Copy className="h-4 w-4" />
						)}
					</Button>
				</div>
				<p className="mt-2 text-xs text-muted-foreground">
					Keep this key secret. Anyone with this key can spend up to your
					per-transaction limit.
				</p>
			</CardContent>
		</Card>
	);
}

// === Dialogs ===

const amountSchema = z.object({
	amount: z.string().min(1, "Amount is required"),
});

function DepositDialog({
	open,
	onOpenChange,
	onSubmit,
	isPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (amount: bigint) => Promise<void>;
	isPending: boolean;
}) {
	const form = useForm({
		resolver: zodResolver(amountSchema),
		defaultValues: { amount: "" },
	});

	const handleSubmit = form.handleSubmit(async (data) => {
		const amount = parseUsdc(data.amount);
		await onSubmit(amount);
		form.reset();
		onOpenChange(false);
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Deposit USDC</DialogTitle>
					<DialogDescription>
						Transfer USDC from your wallet to the Smart Account vault.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="deposit-amount">Amount (USDC)</Label>
							<Input
								id="deposit-amount"
								placeholder="0.00"
								{...form.register("amount")}
							/>
							{form.formState.errors.amount && (
								<p className="text-sm text-destructive">
									{form.formState.errors.amount.message}
								</p>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							Deposit
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function WithdrawDialog({
	open,
	onOpenChange,
	onSubmit,
	maxAmount,
	isPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (amount: bigint) => Promise<void>;
	maxAmount: bigint;
	isPending: boolean;
}) {
	const form = useForm({
		resolver: zodResolver(amountSchema),
		defaultValues: { amount: "" },
	});

	const handleSubmit = form.handleSubmit(async (data) => {
		const amount = parseUsdc(data.amount);
		if (amount > maxAmount) {
			form.setError("amount", { message: "Exceeds available balance" });
			return;
		}
		await onSubmit(amount);
		form.reset();
		onOpenChange(false);
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Withdraw USDC</DialogTitle>
					<DialogDescription>
						Transfer USDC from the vault back to your wallet.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="withdraw-amount">Amount (USDC)</Label>
							<Input
								id="withdraw-amount"
								placeholder="0.00"
								{...form.register("amount")}
							/>
							<p className="text-xs text-muted-foreground">
								Available: {formatUsdc(maxAmount)} USDC
							</p>
							{form.formState.errors.amount && (
								<p className="text-sm text-destructive">
									{form.formState.errors.amount.message}
								</p>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							Withdraw
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

const limitsSchema = z.object({
	dailyLimit: z.string().min(1, "Daily limit is required"),
	perTxLimit: z.string().min(1, "Per-transaction limit is required"),
});

function SpendingLimitDialog({
	open,
	onOpenChange,
	onSubmit,
	currentConfig,
	isPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (dailyLimit: bigint, perTxLimit: bigint) => Promise<void>;
	currentConfig: { dailyLimit: bigint; perTxLimit: bigint } | null;
	isPending: boolean;
}) {
	const form = useForm({
		resolver: zodResolver(limitsSchema),
		defaultValues: {
			dailyLimit: currentConfig ? formatUsdc(currentConfig.dailyLimit) : "",
			perTxLimit: currentConfig ? formatUsdc(currentConfig.perTxLimit) : "",
		},
	});

	const handleSubmit = form.handleSubmit(async (data) => {
		const dailyLimit = parseUsdc(data.dailyLimit);
		const perTxLimit = parseUsdc(data.perTxLimit);

		if (perTxLimit > dailyLimit) {
			form.setError("perTxLimit", {
				message: "Per-transaction limit cannot exceed daily limit",
			});
			return;
		}

		await onSubmit(dailyLimit, perTxLimit);
		form.reset();
		onOpenChange(false);
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{currentConfig ? "Update Spending Limit" : "Set Spending Limit"}
					</DialogTitle>
					<DialogDescription>
						Configure how much the facilitator can spend per day and per
						transaction.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="daily-limit">Daily Limit (USDC)</Label>
							<Input
								id="daily-limit"
								placeholder="100.00"
								{...form.register("dailyLimit")}
							/>
							{form.formState.errors.dailyLimit && (
								<p className="text-sm text-destructive">
									{form.formState.errors.dailyLimit.message}
								</p>
							)}
						</div>
						<div className="grid gap-2">
							<Label htmlFor="per-tx-limit">Per Transaction Limit (USDC)</Label>
							<Input
								id="per-tx-limit"
								placeholder="10.00"
								{...form.register("perTxLimit")}
							/>
							{form.formState.errors.perTxLimit && (
								<p className="text-sm text-destructive">
									{form.formState.errors.perTxLimit.message}
								</p>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							{currentConfig ? "Update" : "Set Limit"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
