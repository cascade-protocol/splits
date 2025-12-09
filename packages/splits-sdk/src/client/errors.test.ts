/**
 * Tests for error handling utilities
 */

import { describe, test, expect } from "vitest";
import { handleTransactionError } from "./errors.js";
import {
	WalletDisconnectedError,
	WalletRejectedError,
} from "./wallet-errors.js";

describe("handleTransactionError", () => {
	test("handles WalletRejectedError", () => {
		const error = new WalletRejectedError();
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("wallet_rejected");
		expect(result.message).toContain("rejected");
		expect(result.error).toBe(error);
	});

	test("handles WalletDisconnectedError", () => {
		const error = new WalletDisconnectedError();
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("wallet_disconnected");
		expect(result.message).toContain("disconnected");
		expect(result.error).toBe(error);
	});

	test("handles blockhash expired error", () => {
		const error = new Error("Blockhash not found");
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("transaction_expired");
		expect(result.message).toContain("expired");
	});

	test("handles transaction expired error", () => {
		const error = new Error("Transaction expired before confirmation");
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("transaction_expired");
	});

	test("handles network error", () => {
		const error = new Error("Network request failed");
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("network_error");
		expect(result.message).toContain("Network");
	});

	test("handles fetch error", () => {
		const error = new Error("fetch failed");
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("network_error");
	});

	test("handles connection refused error", () => {
		const error = new Error("ECONNREFUSED");
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("network_error");
	});

	test("handles generic program error", () => {
		const error = new Error("Custom program error: 0x1771");
		const result = handleTransactionError(error);

		expect(result.status).toBe("failed");
		expect(result.reason).toBe("program_error");
		expect(result.message).toBe("Custom program error: 0x1771");
		expect(result.error).toBe(error);
	});

	test("re-throws non-Error objects", () => {
		const nonError = { weird: "object" };

		expect(() => handleTransactionError(nonError)).toThrow();
	});

	test("re-throws string errors", () => {
		expect(() => handleTransactionError("string error")).toThrow();
	});
});
