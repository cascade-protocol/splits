/**
 * Smart Account Panel - All smart account UI in one component.
 *
 * Handles: onboarding, balance display, deposits, withdrawals,
 * spending limits, and API key display.
 */

import { useState, useEffect } from "react";
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
	RefreshCw,
} from "lucide-react";

import { useSmartAccount } from "@/hooks/use-smart-account";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatUsdc, parseUsdc } from "@/lib/squads";
import { TransactionHistory } from "./TransactionHistory";

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
		refresh,
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
		<div className="space-y-4 md:space-y-6">
			{/* Primary row: Balance + Spending side-by-side on md+ */}
			<div className="grid gap-4 md:grid-cols-2">
				<BalanceCard
					balance={account.balance}
					vaultAddress={account.vaultAddress}
					onDeposit={() => setOpenDialog("deposit")}
					onWithdraw={() => setOpenDialog("withdraw")}
					onRefresh={refresh}
					isPending={isPending}
					isRefreshing={isLoading}
				/>
				<SpendingLimitCard
					config={account.spendingLimit}
					onConfigure={() => setOpenDialog("limits")}
					onRevoke={revokeSpendingLimit}
					isPending={isPending}
				/>
			</div>

			{/* Secondary: API Key (truncated by default) */}
			{apiKey && <ApiKeyCard apiKey={apiKey} />}

			{/* Tertiary: Transaction History (collapsible on mobile) */}
			<TransactionHistory
				vaultAtaAddress={account.vaultAtaAddress}
				vaultOwnerAddress={account.vaultAddress}
			/>

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
		<div className="space-y-6">
			{/* Hero */}
			<Card>
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
						<Wallet className="h-6 w-6 text-primary" />
					</div>
					<CardTitle>Create Your Smart Account</CardTitle>
					<CardDescription>
						A non-custodial Squads account that lets you control API spending
					</CardDescription>
				</CardHeader>
			</Card>

			{/* How it works */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">How it works</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex gap-3">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
							1
						</div>
						<div>
							<p className="font-medium">Create Account</p>
							<p className="text-sm text-muted-foreground">
								Creates a Squads smart account with you as the sole owner
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
							2
						</div>
						<div>
							<p className="font-medium">Deposit USDC</p>
							<p className="text-sm text-muted-foreground">
								Fund your vault with USDC from your wallet
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
							3
						</div>
						<div>
							<p className="font-medium">Set Spending Limit</p>
							<p className="text-sm text-muted-foreground">
								Configure daily limits to get your API key
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
							4
						</div>
						<div>
							<p className="font-medium">Use API Key</p>
							<p className="text-sm text-muted-foreground">
								Third-party services can charge within your limits
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* CTA */}
			<Card>
				<CardContent className="pt-6">
					<Button
						onClick={onCreateAccount}
						disabled={isPending}
						className="w-full"
						size="lg"
					>
						{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						Create Smart Account
					</Button>
					<p className="mt-3 text-center text-xs text-muted-foreground">
						You'll always retain full control. Withdraw anytime.
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

function BalanceCard({
	balance,
	vaultAddress,
	onDeposit,
	onWithdraw,
	onRefresh,
	isPending,
	isRefreshing,
}: {
	balance: bigint;
	vaultAddress: string;
	onDeposit: () => void;
	onWithdraw: () => void;
	onRefresh: () => Promise<void>;
	isPending: boolean;
	isRefreshing: boolean;
}) {
	const { isCopied, copyToClipboard } = useCopyToClipboard();

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
				<div className="flex-1 min-w-0">
					<CardTitle className="text-base flex items-center gap-2">
						<Wallet className="size-4" />
						Balance
					</CardTitle>
					<div className="flex items-center gap-1 mt-1">
						<code className="text-[10px] font-mono text-muted-foreground break-all">
							{vaultAddress}
						</code>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => copyToClipboard(vaultAddress)}
							title="Copy vault address"
							className="size-5 shrink-0"
						>
							{isCopied ? (
								<Check className="size-3 text-green-500" />
							) : (
								<Copy className="size-3" />
							)}
						</Button>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onClick={onRefresh}
					disabled={isRefreshing}
					title="Refresh balance"
					className="size-8 shrink-0"
				>
					<RefreshCw
						className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
					/>
				</Button>
			</CardHeader>
			<CardContent>
				<p className="text-2xl md:text-3xl font-bold mb-3">
					{formatUsdc(balance)} USDC
				</p>
				<div className="flex gap-2">
					<Button
						onClick={onDeposit}
						disabled={isPending}
						variant="outline"
						size="sm"
					>
						<ArrowDownLeft className="size-4" />
						Deposit
					</Button>
					<Button
						onClick={onWithdraw}
						disabled={isPending || balance === 0n}
						variant="outline"
						size="sm"
					>
						<ArrowUpRight className="size-4" />
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
		remainingToday: bigint;
	} | null;
	onConfigure: () => void;
	onRevoke: () => Promise<void>;
	isPending: boolean;
}) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-base flex items-center gap-2">
					<Settings className="size-4" />
					Spending Limit
				</CardTitle>
				<p className="text-xs text-muted-foreground">
					{config
						? "Facilitator spending allowance"
						: "Set a limit to get your API key"}
				</p>
			</CardHeader>
			<CardContent>
				{config ? (
					<>
						<div className="mb-3 grid gap-1.5 text-sm">
							<div className="flex justify-between">
								<span className="text-muted-foreground">Daily Limit</span>
								<span className="font-mono">
									{formatUsdc(config.dailyLimit)} USDC
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Remaining</span>
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
								size="sm"
							>
								Update
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
					<Button onClick={onConfigure} disabled={isPending} size="sm">
						<Key className="size-4" />
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
			<CardHeader className="py-4">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base flex items-center gap-2">
						<Key className="size-4" />
						API Key
					</CardTitle>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => copyToClipboard(apiKey)}
						title="Copy API key"
						className="size-8"
					>
						{isCopied ? (
							<Check className="size-4 text-green-500" />
						) : (
							<Copy className="size-4" />
						)}
					</Button>
				</div>
			</CardHeader>
			<CardContent className="pt-0">
				<code className="block rounded bg-muted px-3 py-2 font-mono text-xs break-all">
					{apiKey}
				</code>
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
							<div className="flex gap-2">
								<Input
									id="withdraw-amount"
									placeholder="0.00"
									{...form.register("amount")}
								/>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => form.setValue("amount", formatUsdc(maxAmount))}
								>
									Max
								</Button>
							</div>
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
});

const LIMIT_PRESETS = [
	{ label: "$10", value: "10" },
	{ label: "$50", value: "50" },
	{ label: "$100", value: "100" },
];

function SpendingLimitDialog({
	open,
	onOpenChange,
	onSubmit,
	currentConfig,
	isPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (dailyLimit: bigint) => Promise<void>;
	currentConfig: { dailyLimit: bigint } | null;
	isPending: boolean;
}) {
	const form = useForm({
		resolver: zodResolver(limitsSchema),
		defaultValues: {
			dailyLimit: currentConfig ? formatUsdc(currentConfig.dailyLimit) : "",
		},
	});

	// Reset form when dialog opens or config changes
	useEffect(() => {
		if (open) {
			form.reset({
				dailyLimit: currentConfig ? formatUsdc(currentConfig.dailyLimit) : "",
			});
		}
	}, [open, currentConfig, form]);

	const handleSubmit = form.handleSubmit(async (data) => {
		const dailyLimit = parseUsdc(data.dailyLimit);
		await onSubmit(dailyLimit);
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
						Configure how much the facilitator can spend per day.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						{/* Preset buttons */}
						<div className="flex gap-2">
							{LIMIT_PRESETS.map((preset) => (
								<Button
									key={preset.value}
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										form.setValue("dailyLimit", preset.value);
									}}
								>
									{preset.label}
								</Button>
							))}
						</div>
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
