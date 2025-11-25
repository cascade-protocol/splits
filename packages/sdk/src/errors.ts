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
 *   }
 *   if (e instanceof SplitNotFoundError) {
 *     console.log("Split config missing:", e.address);
 *   }
 * }
 * ```
 */

/** Base class for all SDK errors */
export class SplitsError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		Object.setPrototypeOf(this, new.target.prototype);
		this.name = this.constructor.name;
	}
}

/** Vault token account not found */
export class VaultNotFoundError extends SplitsError {
	constructor(
		public readonly vault: string,
		options?: ErrorOptions,
	) {
		super(`Vault not found: ${vault}`, options);
	}
}

/** Split config account not found at the given address */
export class SplitNotFoundError extends SplitsError {
	constructor(
		public readonly address: string,
		options?: ErrorOptions,
	) {
		super(`Split config not found: ${address}`, options);
	}
}

/** Protocol config not initialized */
export class ProtocolNotInitializedError extends SplitsError {
	constructor(options?: ErrorOptions) {
		super(
			"Protocol config not found. Has the program been initialized?",
			options,
		);
	}
}

/** Validation errors from Zod schemas */
export class ValidationError extends SplitsError {}

/** Cannot update/close split with unclaimed amounts */
export class UnclaimedAmountsError extends SplitsError {
	constructor(
		public readonly count: number,
		options?: ErrorOptions,
	) {
		super(
			`Cannot modify split: ${count} unclaimed amount(s) exist. Execute split first.`,
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
			`Vault has balance: ${balance}. Execute split before modifying.`,
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
		super(`Invalid token account data at: ${address}`, options);
	}
}

/** Protocol has unclaimed fees - must execute before update/close */
export class ProtocolUnclaimedError extends SplitsError {
	constructor(
		public readonly amount: bigint,
		options?: ErrorOptions,
	) {
		super(
			`Protocol has unclaimed fees: ${amount}. Execute split to clear.`,
			options,
		);
	}
}
