/**
 * Actionable error messages for the Splits client
 *
 * All messages tell the user:
 * 1. What happened
 * 2. Why it happened
 * 3. What they can do about it
 */

// =============================================================================
// Blocked Messages (user action required)
// =============================================================================

/**
 * Generate message for vault_not_empty block reason.
 */
export function vaultNotEmptyMessage(
	balance: bigint,
	decimals: number,
	symbol: string,
): string {
	const formatted = formatTokenAmount(balance, decimals);
	return `Vault has ${formatted} ${symbol}. Execute the split first to distribute funds, then try again.`;
}

/**
 * Generate message for unclaimed_pending block reason.
 */
export function unclaimedPendingMessage(
	recipientCount: number,
	totalUnclaimed: bigint,
	decimals: number,
	symbol: string,
): string {
	const formatted = formatTokenAmount(totalUnclaimed, decimals);
	const recipientText =
		recipientCount === 1
			? "1 recipient has"
			: `${recipientCount} recipients have`;
	return `${recipientText} ${formatted} ${symbol} unclaimed. Execute the split to clear unclaimed amounts, then try again.`;
}

/**
 * Generate message for not_authority block reason.
 */
export function notAuthorityMessage(
	expectedAuthority: string,
	actualSigner: string,
): string {
	const expected = truncateAddress(expectedAuthority);
	const actual = truncateAddress(actualSigner);
	return `Only the split authority (${expected}) can perform this action. Connected wallet is ${actual}.`;
}

/**
 * Generate message for recipient_atas_missing block reason.
 */
export function recipientAtasMissingMessage(
	missingAddresses: string[],
): string {
	const count = missingAddresses.length;
	if (count === 1 && missingAddresses[0] !== undefined) {
		const addr = truncateAddress(missingAddresses[0]);
		return `Recipient ${addr} doesn't have a token account. They need to create one before receiving funds.`;
	}
	const firstTwo = missingAddresses.slice(0, 2).map(truncateAddress).join(", ");
	const suffix = count > 2 ? ` and ${count - 2} more` : "";
	return `${count} recipients don't have token accounts: ${firstTwo}${suffix}. They need to create accounts before receiving funds.`;
}

// =============================================================================
// Failed Messages (errors)
// =============================================================================

/**
 * Generate message for wallet_rejected failure.
 */
export function walletRejectedMessage(): string {
	return "Transaction was rejected. Please try again and approve the transaction in your wallet.";
}

/**
 * Generate message for wallet_disconnected failure.
 */
export function walletDisconnectedMessage(): string {
	return "Wallet disconnected. Please reconnect your wallet and try again.";
}

/**
 * Generate message for network_error failure.
 */
export function networkErrorMessage(detail?: string): string {
	if (detail) {
		return `Network error: ${detail}. Check your connection and try again.`;
	}
	return "Network error. Check your connection and try again.";
}

/**
 * Generate message for transaction_expired failure.
 */
export function transactionExpiredMessage(): string {
	return "Transaction expired before confirmation. The network may be congested. Please try again.";
}

/**
 * Generate message for program_error failure.
 */
export function programErrorMessage(code: number, description: string): string {
	return `Transaction failed: ${description} (error code ${code}).`;
}

// =============================================================================
// Skipped Messages (expected conditions, not errors)
// =============================================================================

/**
 * Generate message for not_found skip reason.
 */
export function notFoundMessage(vault: string): string {
	const addr = truncateAddress(vault);
	return `Vault ${addr} not found. It may not exist or has been closed.`;
}

/**
 * Generate message for below_threshold skip reason.
 */
export function belowThresholdMessage(
	balance: bigint,
	threshold: bigint,
	decimals: number,
	symbol: string,
): string {
	const balanceFormatted = formatTokenAmount(balance, decimals);
	const thresholdFormatted = formatTokenAmount(threshold, decimals);
	return `Vault balance (${balanceFormatted} ${symbol}) is below threshold (${thresholdFormatted} ${symbol}). Skipping execution.`;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format token amount with decimals.
 * Example: formatTokenAmount(1_500_000n, 6) => "1.5"
 */
function formatTokenAmount(amount: bigint, decimals: number): string {
	const divisor = BigInt(10 ** decimals);
	const whole = amount / divisor;
	const fraction = amount % divisor;

	if (fraction === 0n) {
		return whole.toString();
	}

	// Pad fraction to correct number of decimal places
	const fractionStr = fraction.toString().padStart(decimals, "0");
	// Remove trailing zeros
	const trimmedFraction = fractionStr.replace(/0+$/, "");

	return `${whole}.${trimmedFraction}`;
}

/**
 * Truncate an address for display.
 * Example: truncateAddress("So11111...111111") => "So11...1111"
 */
function truncateAddress(address: string): string {
	if (address.length <= 12) {
		return address;
	}
	return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
