import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@/lib/zod-resolver";
import { AlertCircle, Check, Loader2, Minus, Plus } from "lucide-react";
import type { SplitWithBalance, ShareRecipient } from "@cascade-fyi/splits-sdk";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

const MAX_RECIPIENTS = 20;

function isValidSolanaAddress(address: string): boolean {
	const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
	return base58Regex.test(address);
}

const recipientSchema = z.object({
	address: z
		.string()
		.min(1, "Address is required")
		.refine(isValidSolanaAddress, "Invalid Solana address"),
	share: z
		.number()
		.int("Must be a whole number")
		.min(1, "Must be at least 1%")
		.max(100, "Must be at most 100%"),
});

const updateSplitSchema = z
	.object({
		recipients: z
			.array(recipientSchema)
			.min(1, "Add at least one recipient")
			.max(MAX_RECIPIENTS, `Maximum ${MAX_RECIPIENTS} recipients`),
	})
	.refine(
		(data) => {
			const total = data.recipients.reduce((sum, r) => sum + r.share, 0);
			return total === 100;
		},
		{
			message: "Shares must total exactly 100%",
			path: ["recipients"],
		},
	)
	.refine(
		(data) => {
			const addresses = data.recipients
				.map((r) => r.address)
				.filter((a) => a.length > 0);
			return new Set(addresses).size === addresses.length;
		},
		{
			message: "Duplicate addresses not allowed",
			path: ["recipients"],
		},
	);

type UpdateSplitFormData = z.infer<typeof updateSplitSchema>;

interface UpdateSplitDialogProps {
	split: SplitWithBalance | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (vault: string, recipients: ShareRecipient[]) => Promise<void>;
	isPending: boolean;
}

export function UpdateSplitDialog({
	split,
	open,
	onOpenChange,
	onSubmit,
	isPending,
}: UpdateSplitDialogProps) {
	const [error, setError] = useState<string | null>(null);

	const form = useForm<UpdateSplitFormData>({
		resolver: zodResolver(updateSplitSchema),
		defaultValues: {
			recipients: [],
		},
		mode: "onChange",
	});

	const { fields, append, remove } = useFieldArray({
		control: form.control,
		name: "recipients",
	});

	// Reset form and error when split changes or dialog opens
	useEffect(() => {
		if (split && open) {
			setError(null);
			form.reset({
				recipients: split.recipients.map((r) => ({
					address: r.address,
					share: r.share,
				})),
			});
		}
	}, [split, open, form]);

	const watchedRecipients = form.watch("recipients");
	const totalShare = watchedRecipients.reduce(
		(sum, r) => sum + (r.share || 0),
		0,
	);
	const isComplete = totalShare === 100;

	const handleFormSubmit = async (data: UpdateSplitFormData) => {
		if (!split) return;
		setError(null);

		const recipients: ShareRecipient[] = data.recipients.map((r) => ({
			address: r.address,
			share: r.share,
		}));

		try {
			await onSubmit(split.vault, recipients);
			onOpenChange(false); // Only close on success
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update split");
			// Don't close - let user retry
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Update Recipients</DialogTitle>
				</DialogHeader>

				{split && (
					<div className="rounded-md bg-muted p-3 text-sm mb-4">
						<div className="font-mono text-xs text-muted-foreground mb-1">
							Vault
						</div>
						<div className="font-mono text-xs break-all">{split.vault}</div>
					</div>
				)}

				<form
					onSubmit={form.handleSubmit(handleFormSubmit)}
					className="space-y-3"
				>
					{fields.map((field, index) => (
						<div key={field.id} className="flex items-center gap-2">
							<Controller
								name={`recipients.${index}.address`}
								control={form.control}
								render={({ field: controllerField, fieldState }) => (
									<Input
										{...controllerField}
										placeholder="Enter address..."
										aria-invalid={fieldState.invalid}
										className="flex-1 font-mono text-sm"
										autoComplete="off"
										data-1p-ignore
									/>
								)}
							/>

							<Controller
								name={`recipients.${index}.share`}
								control={form.control}
								render={({ field: controllerField, fieldState }) => (
									<div className="relative w-20 shrink-0">
										<Input
											type="number"
											min={1}
											max={100}
											value={controllerField.value}
											onChange={(e) =>
												controllerField.onChange(
													Number.parseInt(e.target.value, 10) || 0,
												)
											}
											aria-invalid={fieldState.invalid}
											className="pr-6 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
										/>
										<span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
											%
										</span>
									</div>
								)}
							/>

							{fields.length > 1 && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => remove(index)}
									className="shrink-0 h-9 w-9 rounded-full text-muted-foreground hover:text-destructive"
									aria-label={`Remove recipient ${index + 1}`}
								>
									<Minus className="h-4 w-4" />
								</Button>
							)}
						</div>
					))}

					<button
						type="button"
						onClick={() => append({ address: "", share: 0 })}
						disabled={fields.length >= MAX_RECIPIENTS}
						className="text-primary text-sm font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<Plus className="h-4 w-4 inline mr-1" />
						Add recipient
					</button>

					<div className="flex items-center gap-4 pt-2">
						<div className="flex items-center gap-2">
							{isComplete ? (
								<Check className="h-4 w-4 text-green-500" />
							) : (
								<span className="h-4 w-4 rounded-full border-2 border-muted-foreground/50" />
							)}
							<span
								className={`text-sm font-medium ${isComplete ? "text-green-500" : "text-muted-foreground"}`}
							>
								{totalShare}%
							</span>
						</div>
					</div>

					{form.formState.errors.recipients?.root && (
						<p className="text-destructive text-sm">
							{form.formState.errors.recipients.root.message}
						</p>
					)}

					{/* Mutation error */}
					{error && (
						<div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
							<AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
							<span>{error}</span>
						</div>
					)}

					<Button
						type="submit"
						size="lg"
						disabled={!isComplete || !form.formState.isValid || isPending}
						className="w-full mt-6"
					>
						{isPending ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Updating...
							</>
						) : (
							"Update Recipients"
						)}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
