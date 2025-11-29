import { useState } from "react";
import { Plus } from "lucide-react";
import type { Recipient } from "@cascade-fyi/splits-sdk";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { CreateSplitForm } from "./create-split-form";

interface CreateSplitDialogProps {
	onSubmit: (recipients: Recipient[]) => Promise<void>;
	isPending: boolean;
}

export function CreateSplitDialog({
	onSubmit,
	isPending,
}: CreateSplitDialogProps) {
	const [open, setOpen] = useState(false);

	const handleSubmit = async (recipients: Recipient[]) => {
		await onSubmit(recipients);
		setOpen(false);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<Plus className="h-4 w-4" />
					New Split
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Create New Split</DialogTitle>
				</DialogHeader>
				<CreateSplitForm onSubmit={handleSubmit} isPending={isPending} />
			</DialogContent>
		</Dialog>
	);
}
