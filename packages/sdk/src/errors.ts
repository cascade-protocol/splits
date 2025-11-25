/**
 * SDK Error Classes
 * Use instanceof checks for specific error handling
 *
 * @example
 * ```typescript
 * try {
 *   const split = await sdk.getSplit(vault);
 * } catch (e) {
 *   if (e instanceof VaultNotFoundError) {
 *     console.log("Vault doesn't exist yet:", e.vault);
 *     toast.error(e.userMessage); // User-friendly message
 *   }
 *   if (e instanceof SplitsError) {
 *     // All SDK errors have a code for programmatic handling
 *     switch (e.code) {
 *       case 'VAULT_NOT_FOUND':
 *         // Handle specifically
 *         break;
 *     }
 *   }
 * }
 * ```
 */

/** Error codes for programmatic handling */
export type SplitsErrorCode =
	| "VAULT_NOT_FOUND"
	| "SPLIT_NOT_FOUND"
	| "PROTOCOL_NOT_INITIALIZED"
	| "VALIDATION_ERROR"
	| "UNCLAIMED_AMOUNTS_EXIST"
	| "VAULT_NOT_EMPTY"
	| "INVALID_TOKEN_ACCOUNT"
	| "PROTOCOL_UNCLAIMED_EXISTS"
	| "WALLET_NOT_CONNECTED"
	| "TRANSACTION_FAILED"
	| "TRANSACTION_EXPIRED";

/** Base class for all SDK errors */
export class SplitsError extends Error {
	readonly code: SplitsErrorCode;
	readonly userMessage: string;

	constructor(
		code: SplitsErrorCode,
		message: string,
		userMessage: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		Object.setPrototypeOf(this, new.target.prototype);
		this.name = this.constructor.name;
		this.code = code;
		this.userMessage = userMessage;
	}
}

/** Vault token account not found */
export class VaultNotFoundError extends SplitsError {
	constructor(
		public readonly vault: string,
		options?: ErrorOptions,
	) {
		super(
			"VAULT_NOT_FOUND",
			`Vault not found: ${vault}`,
			"The split vault could not be found. It may not exist yet.",
			options,
		);
	}
}

/** Split config account not found at the given address */
export class SplitNotFoundError extends SplitsError {
	constructor(
		public readonly address: string,
		options?: ErrorOptions,
	) {
		super(
			"SPLIT_NOT_FOUND",
			`Split config not found: ${address}`,
			"This split configuration does not exist.",
			options,
		);
	}
}

/** Protocol config not initialized */
export class ProtocolNotInitializedError extends SplitsError {
	constructor(options?: ErrorOptions) {
		super(
			"PROTOCOL_NOT_INITIALIZED",
			"Protocol config not found. Has the program been initialized?",
			"The protocol has not been initialized. Please contact support.",
			options,
		);
	}
}

/** Validation errors from Zod schemas */
export class ValidationError extends SplitsError {
	constructor(message: string, options?: ErrorOptions) {
		super("VALIDATION_ERROR", message, message, options);
	}
}

/** Cannot update/close split with unclaimed amounts */
export class UnclaimedAmountsError extends SplitsError {
	constructor(
		public readonly count: number,
		options?: ErrorOptions,
	) {
		super(
			"UNCLAIMED_AMOUNTS_EXIST",
			`Cannot modify split: ${count} unclaimed amount(s) exist. Execute split first.`,
			"Please distribute existing funds before making changes.",
			options,
		);
	}
}

/** Vault has balance - must execute before update/close */
export class NonEmptyVaultError extends SplitsError {
	constructor(
		public readonly balance: bigint,
		options?: ErrorOptions,
	) {
		super(
			"VAULT_NOT_EMPTY",
			`Vault has balance: ${balance}. Execute split before modifying.`,
			"Please distribute existing funds before making changes.",
			options,
		);
	}
}

/** Invalid token account data */
export class InvalidTokenAccountError extends SplitsError {
	constructor(
		public readonly address: string,
		options?: ErrorOptions,
	) {
		super(
			"INVALID_TOKEN_ACCOUNT",
			`Invalid token account data at: ${address}`,
			"The token account data is invalid or corrupted.",
			options,
		);
	}
}

/** Protocol has unclaimed fees - must execute before update/close */
export class ProtocolUnclaimedError extends SplitsError {
	constructor(
		public readonly amount: bigint,
		options?: ErrorOptions,
	) {
		super(
			"PROTOCOL_UNCLAIMED_EXISTS",
			`Protocol has unclaimed fees: ${amount}. Execute split to clear.`,
			"Please distribute existing funds before making changes.",
			options,
		);
	}
}

/** Wallet not connected */
export class WalletNotConnectedError extends SplitsError {
	constructor(options?: ErrorOptions) {
		super(
			"WALLET_NOT_CONNECTED",
			"Wallet not connected",
			"Please connect your wallet to continue.",
			options,
		);
	}
}

/** Transaction failed */
export class TransactionFailedError extends SplitsError {
	constructor(
		public readonly signature: string | undefined,
		cause?: Error,
	) {
		super(
			"TRANSACTION_FAILED",
			cause?.message ?? "Transaction failed",
			"The transaction failed. Please try again.",
			{ cause },
		);
	}
}

/** Transaction expired before confirmation */
export class TransactionExpiredError extends SplitsError {
	constructor(options?: ErrorOptions) {
		super(
			"TRANSACTION_EXPIRED",
			"Transaction expired before confirmation",
			"The transaction took too long. Please try again.",
			options,
		);
	}
}

// ============================================================================
// Program Error Codes (on-chain errors)
// ============================================================================

/** On-chain program error codes from the Cascade Splits program */
export enum ProgramErrorCode {
	InvalidAuthority = 0,
	InvalidRecipientCount = 1,
	InvalidShareSum = 2,
	VaultNotEmpty = 3,
	UnclaimedAmountsExist = 4,
	ProtocolUnclaimedExists = 5,
	AlreadyInitialized = 6,
	NotInitialized = 7,
	InvalidMint = 8,
	InvalidVault = 9,
}

/** User-friendly messages for program error codes */
export const PROGRAM_ERROR_MESSAGES: Record<ProgramErrorCode, string> = {
	[ProgramErrorCode.InvalidAuthority]:
		"You are not authorized to perform this action.",
	[ProgramErrorCode.InvalidRecipientCount]:
		"Number of recipients must be between 1 and 20.",
	[ProgramErrorCode.InvalidShareSum]:
		"Recipient shares must sum to exactly 100.",
	[ProgramErrorCode.VaultNotEmpty]:
		"Please distribute existing funds before making changes.",
	[ProgramErrorCode.UnclaimedAmountsExist]:
		"Please distribute existing funds before making changes.",
	[ProgramErrorCode.ProtocolUnclaimedExists]:
		"Please distribute existing funds before making changes.",
	[ProgramErrorCode.AlreadyInitialized]: "This split has already been created.",
	[ProgramErrorCode.NotInitialized]: "This split does not exist.",
	[ProgramErrorCode.InvalidMint]: "Invalid token mint address.",
	[ProgramErrorCode.InvalidVault]: "Invalid vault address.",
};

/**
 * Parse a program error from transaction failure.
 * Extracts the error code and returns a user-friendly SplitsError.
 *
 * @param error - The raw error from transaction send/confirm
 * @returns A SplitsError if parseable, null otherwise
 */
export function parseProgramError(error: unknown): SplitsError | null {
	if (!error || typeof error !== "object") return null;

	const err = error as Record<string, unknown>;

	// Handle SendTransactionError format (logs array)
	if ("logs" in err && Array.isArray(err.logs)) {
		const customErrorLog = err.logs.find(
			(log: string) =>
				typeof log === "string" && log.includes("Custom program error:"),
		);
		if (customErrorLog && typeof customErrorLog === "string") {
			const match = customErrorLog.match(/Custom program error: (\d+)/);
			if (match?.[1]) {
				const code = parseInt(match[1], 10) as ProgramErrorCode;
				const message = PROGRAM_ERROR_MESSAGES[code];
				if (message) {
					return new SplitsError(
						"TRANSACTION_FAILED",
						`Program error ${code}`,
						message,
					);
				}
			}
		}
	}

	// Handle InstructionError format
	if ("InstructionError" in err) {
		const instrErr = err.InstructionError as [number, { Custom?: number }];
		if (Array.isArray(instrErr) && instrErr[1]?.Custom !== undefined) {
			const code = instrErr[1].Custom as ProgramErrorCode;
			const message = PROGRAM_ERROR_MESSAGES[code];
			if (message) {
				return new SplitsError(
					"TRANSACTION_FAILED",
					`Program error ${code}`,
					message,
				);
			}
		}
	}

	return null;
}
