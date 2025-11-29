/**
 * SDK Error Classes
 *
 * @example
 * ```typescript
 * import { VaultNotFoundError } from '@cascade-fyi/splits-sdk';
 *
 * try {
 *   const split = await getSplitConfigFromVault(rpc, vault);
 * } catch (e) {
 *   if (e instanceof VaultNotFoundError) {
 *     console.log("Vault doesn't exist:", e.vault);
 *   }
 * }
 * ```
 */

// =============================================================================
// Error Codes
// =============================================================================

/** Error codes for programmatic handling */
export type SplitsErrorCode =
	| "VAULT_NOT_FOUND"
	| "SPLIT_NOT_FOUND"
	| "PROTOCOL_NOT_INITIALIZED"
	| "INVALID_RECIPIENTS"
	| "INVALID_TOKEN_ACCOUNT";

// =============================================================================
// SDK Errors
// =============================================================================

/** Base class for all SDK errors */
export class SplitsError extends Error {
	readonly code: SplitsErrorCode;

	constructor(code: SplitsErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		Object.setPrototypeOf(this, new.target.prototype);
		this.name = this.constructor.name;
		this.code = code;
	}
}

/** Vault token account not found */
export class VaultNotFoundError extends SplitsError {
	constructor(
		public readonly vault: string,
		options?: ErrorOptions,
	) {
		super("VAULT_NOT_FOUND", `Vault not found: ${vault}`, options);
	}
}

/** SplitConfig account not found */
export class SplitConfigNotFoundError extends SplitsError {
	constructor(
		public readonly address: string,
		options?: ErrorOptions,
	) {
		super("SPLIT_NOT_FOUND", `SplitConfig not found: ${address}`, options);
	}
}

/** Protocol config not initialized */
export class ProtocolNotInitializedError extends SplitsError {
	constructor(options?: ErrorOptions) {
		super(
			"PROTOCOL_NOT_INITIALIZED",
			"Protocol config not found. Has the program been initialized?",
			options,
		);
	}
}

/** Invalid recipients configuration */
export class InvalidRecipientsError extends SplitsError {
	constructor(message: string, options?: ErrorOptions) {
		super("INVALID_RECIPIENTS", message, options);
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
			`Invalid token account data: ${address}`,
			options,
		);
	}
}

// =============================================================================
// Program Errors (re-exported from generated code)
// =============================================================================

export {
	CASCADE_SPLITS_ERROR__INVALID_RECIPIENT_COUNT,
	CASCADE_SPLITS_ERROR__INVALID_SPLIT_TOTAL,
	CASCADE_SPLITS_ERROR__DUPLICATE_RECIPIENT,
	CASCADE_SPLITS_ERROR__ZERO_ADDRESS,
	CASCADE_SPLITS_ERROR__ZERO_PERCENTAGE,
	CASCADE_SPLITS_ERROR__VAULT_NOT_EMPTY,
	CASCADE_SPLITS_ERROR__INVALID_VAULT,
	CASCADE_SPLITS_ERROR__MATH_OVERFLOW,
	CASCADE_SPLITS_ERROR__UNAUTHORIZED,
	CASCADE_SPLITS_ERROR__ALREADY_INITIALIZED,
	CASCADE_SPLITS_ERROR__UNCLAIMED_NOT_EMPTY,
	CASCADE_SPLITS_ERROR__INVALID_TOKEN_PROGRAM,
	CASCADE_SPLITS_ERROR__NO_PENDING_TRANSFER,
	CASCADE_SPLITS_ERROR__INVALID_RENT_DESTINATION,
	type CascadeSplitsError,
	getCascadeSplitsErrorMessage,
} from "./solana/generated/errors/index.js";
