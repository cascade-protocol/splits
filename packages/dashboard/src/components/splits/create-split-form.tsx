import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@/lib/zod-resolver";
import { Check, Minus, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { ShareRecipient } from "@cascade-fyi/splits-sdk";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Constants
const MAX_RECIPIENTS = 20;

/**
 * Validates a Solana address (base58, 32-44 chars)
 */
function isValidSolanaAddress(address: string): boolean {
	const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
	return base58Regex.test(address);
}

// Zod schema for split creation
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

const createSplitSchema = z
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

type CreateSplitFormData = z.infer<typeof createSplitSchema>;

interface CreateSplitFormProps {
	onSubmit?: (data: ShareRecipient[]) => void;
}

export function CreateSplitForm({ onSubmit }: CreateSplitFormProps) {
	const form = useForm<CreateSplitFormData>({
		resolver: zodResolver(createSplitSchema),
		defaultValues: {
			recipients: [
				{ address: "", share: 10 },
				{ address: "", share: 90 },
			],
		},
		mode: "onChange",
	});

	const { fields, append, remove } = useFieldArray({
		control: form.control,
		name: "recipients",
	});

	const watchedRecipients = form.watch("recipients");
	const totalShare = watchedRecipients.reduce(
		(sum, r) => sum + (r.share || 0),
		0,
	);
	const isComplete = totalShare === 100;

	const handleFormSubmit = (data: CreateSplitFormData) => {
		const recipients: ShareRecipient[] = data.recipients.map((r) => ({
			address: r.address,
			share: r.share,
		}));

		toast.success("Split configuration ready!", {
			description: "Connect your wallet to create the split on-chain.",
		});
		onSubmit?.(recipients);
	};

	return (
		<div className="w-full max-w-xl mx-auto">
			<h2 className="text-xl font-semibold mb-1">Recipients</h2>
			<p className="text-muted-foreground text-sm mb-6">
				Enter wallet addresses and their share percentage.
			</p>

			<form
				onSubmit={form.handleSubmit(handleFormSubmit)}
				className="space-y-3"
			>
				{fields.map((field, index) => (
					<div key={field.id} className="flex items-center gap-2">
						{/* Address input */}
						<Controller
							name={`recipients.${index}.address`}
							control={form.control}
							render={({ field: controllerField, fieldState }) => (
								<Input
									{...controllerField}
									placeholder="Enter address..."
									aria-invalid={fieldState.invalid}
									className="flex-1 font-mono text-sm"
								/>
							)}
						/>

						{/* Share input */}
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

						{/* Remove button */}
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

				{/* Add recipient */}
				<button
					type="button"
					onClick={() => append({ address: "", share: 0 })}
					disabled={fields.length >= MAX_RECIPIENTS}
					className="text-primary text-sm font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<Plus className="h-4 w-4 inline mr-1" />
					Add recipient
				</button>

				{/* Total indicator */}
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

				{/* Error message */}
				{form.formState.errors.recipients?.root && (
					<p className="text-destructive text-sm">
						{form.formState.errors.recipients.root.message}
					</p>
				)}

				{/* Submit */}
				<Button
					type="submit"
					size="lg"
					disabled={!isComplete || !form.formState.isValid}
					className="w-full mt-6"
				>
					<Wallet className="h-4 w-4 mr-2" />
					Create Split
				</Button>
			</form>
		</div>
	);
}
