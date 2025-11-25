import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@/lib/zod-resolver";
import { Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { ShareRecipient } from "@cascade-fyi/splits-sdk";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// Constants
const MAX_RECIPIENTS = 20;

/**
 * Validates a Solana address (base58, 32-44 chars)
 */
function isValidSolanaAddress(address: string): boolean {
	const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
	return base58Regex.test(address);
}

// Zod schema for split creation (uses 100% share model)
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
				{ address: "", share: 50 },
				{ address: "", share: 50 },
			],
		},
		mode: "onChange",
	});

	const { fields, append, remove } = useFieldArray({
		control: form.control,
		name: "recipients",
	});

	// Calculate remaining percentage (out of 100%)
	const watchedRecipients = form.watch("recipients");
	const totalShare = watchedRecipients.reduce(
		(sum, r) => sum + (r.share || 0),
		0,
	);
	const remainingShare = 100 - totalShare;

	const handleFormSubmit = (data: CreateSplitFormData) => {
		// Convert form data to SDK format (ShareRecipient[])
		const recipients: ShareRecipient[] = data.recipients.map((r) => ({
			address: r.address,
			share: r.share,
		}));

		toast.success("Split configuration ready!", {
			description: "Connect your wallet to create the split on-chain.",
		});
		onSubmit?.(recipients);
	};

	const handleAddRecipient = () => {
		if (fields.length >= MAX_RECIPIENTS) return;

		// Default new recipient to remaining share or 1%
		const defaultShare = Math.max(1, Math.min(remainingShare, 99));
		append({ address: "", share: defaultShare });
	};

	return (
		<Card className="w-full max-w-2xl mx-auto">
			<CardHeader>
				<CardTitle>Create a Split</CardTitle>
				<CardDescription>
					Distribute USDC payments automatically to multiple recipients.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					id="create-split-form"
					onSubmit={form.handleSubmit(handleFormSubmit)}
				>
					<FieldSet>
						<FieldLegend variant="label">Recipients</FieldLegend>
						<FieldDescription>
							Add wallet addresses and their share percentage. Total must equal
							100%.
						</FieldDescription>

						<FieldGroup className="gap-4">
							{fields.map((field, index) => (
								<div
									key={field.id}
									className="flex flex-col gap-2 sm:flex-row sm:items-start"
								>
									{/* Address Input */}
									<Controller
										name={`recipients.${index}.address`}
										control={form.control}
										render={({ field: controllerField, fieldState }) => (
											<Field
												className="flex-1"
												data-invalid={fieldState.invalid}
											>
												<Input
													{...controllerField}
													placeholder="Solana wallet address"
													aria-invalid={fieldState.invalid}
													className="font-mono text-sm"
												/>
												{fieldState.invalid && (
													<FieldError errors={[fieldState.error]} />
												)}
											</Field>
										)}
									/>

									{/* Share Input + Remove Button row */}
									<div className="flex gap-2 items-start">
										<Controller
											name={`recipients.${index}.share`}
											control={form.control}
											render={({ field: controllerField, fieldState }) => (
												<Field
													className="w-24 shrink-0"
													data-invalid={fieldState.invalid}
												>
													<div className="relative">
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
															className="pr-7 text-right"
														/>
														<span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
															%
														</span>
													</div>
													{fieldState.invalid && (
														<FieldError errors={[fieldState.error]} />
													)}
												</Field>
											)}
										/>

										{/* Remove Button */}
										{fields.length > 1 && (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => remove(index)}
												className="shrink-0 text-muted-foreground hover:text-destructive"
												aria-label={`Remove recipient ${index + 1}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										)}
									</div>
								</div>
							))}
						</FieldGroup>

						{/* Add Recipient Button */}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleAddRecipient}
							disabled={fields.length >= MAX_RECIPIENTS}
							className="w-fit"
						>
							<Plus className="h-4 w-4 mr-1" />
							Add Recipient
						</Button>

						{/* Form-level errors */}
						{form.formState.errors.recipients?.root && (
							<FieldError
								errors={[form.formState.errors.recipients.root]}
								className="mt-2"
							/>
						)}
					</FieldSet>
				</form>
			</CardContent>

			<Separator />

			<CardFooter className="flex justify-between items-center pt-6">
				{/* Remaining Share Indicator */}
				<div className="flex items-center gap-2">
					<span className="text-sm text-muted-foreground">Remaining:</span>
					<Badge variant={remainingShare === 0 ? "secondary" : "destructive"}>
						{remainingShare}%
					</Badge>
				</div>

				{/* Submit Button */}
				<Button
					type="submit"
					form="create-split-form"
					disabled={remainingShare !== 0 || !form.formState.isValid}
				>
					<Wallet className="h-4 w-4 mr-2" />
					Create Split
				</Button>
			</CardFooter>
		</Card>
	);
}
