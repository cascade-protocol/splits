/**
 * Tests for actionable error messages
 */

import { describe, test, expect } from "vitest";
import {
	vaultNotEmptyMessage,
	unclaimedPendingMessage,
	notAuthorityMessage,
	recipientAtasMissingMessage,
	walletRejectedMessage,
	walletDisconnectedMessage,
	networkErrorMessage,
	transactionExpiredMessage,
	programErrorMessage,
	notFoundMessage,
	notASplitMessage,
} from "./messages.js";

describe("messages", () => {
	describe("vaultNotEmptyMessage", () => {
		test("shows raw balance", () => {
			const message = vaultNotEmptyMessage(1_500_000n);
			expect(message).toContain("1500000 tokens (raw)");
			expect(message).toContain("Execute the split first");
		});
	});

	describe("unclaimedPendingMessage", () => {
		test("singular recipient", () => {
			const message = unclaimedPendingMessage(1, 100_000n);
			expect(message).toContain("1 recipient has");
			expect(message).toContain("100000 tokens (raw)");
		});

		test("multiple recipients", () => {
			const message = unclaimedPendingMessage(3, 500_000n);
			expect(message).toContain("3 recipients have");
			expect(message).toContain("500000 tokens (raw)");
		});
	});

	describe("notAuthorityMessage", () => {
		test("truncates addresses", () => {
			const message = notAuthorityMessage(
				"A1ice111111111111111111111111111111111111111",
				"Bob11111111111111111111111111111111111111111",
			);
			expect(message).toContain("A1ic...1111");
			expect(message).toContain("Bob1...1111");
			expect(message).toContain("Only the split authority");
		});
	});

	describe("recipientAtasMissingMessage", () => {
		test("single missing recipient", () => {
			const message = recipientAtasMissingMessage([
				"A1ice111111111111111111111111111111111111111",
			]);
			expect(message).toContain("Recipient A1ic...1111");
			expect(message).toContain("doesn't have a token account");
		});

		test("multiple missing recipients", () => {
			const message = recipientAtasMissingMessage([
				"A1ice111111111111111111111111111111111111111",
				"Bob11111111111111111111111111111111111111111",
			]);
			expect(message).toContain("2 recipients");
			expect(message).toContain("A1ic...1111");
			expect(message).toContain("Bob1...1111");
		});

		test("more than 3 missing recipients shows count", () => {
			const message = recipientAtasMissingMessage([
				"A1ice111111111111111111111111111111111111111",
				"Bob11111111111111111111111111111111111111111",
				"Carol111111111111111111111111111111111111111",
				"Dave1111111111111111111111111111111111111111",
			]);
			expect(message).toContain("4 recipients");
			expect(message).toContain("and 2 more");
		});
	});

	describe("wallet error messages", () => {
		test("walletRejectedMessage", () => {
			const message = walletRejectedMessage();
			expect(message).toContain("rejected");
			expect(message).toContain("try again");
		});

		test("walletDisconnectedMessage", () => {
			const message = walletDisconnectedMessage();
			expect(message).toContain("disconnected");
			expect(message).toContain("reconnect");
		});

		test("networkErrorMessage without detail", () => {
			const message = networkErrorMessage();
			expect(message).toContain("Network error");
			expect(message).toContain("try again");
		});

		test("networkErrorMessage with detail", () => {
			const message = networkErrorMessage("timeout after 30s");
			expect(message).toContain("timeout after 30s");
		});

		test("transactionExpiredMessage", () => {
			const message = transactionExpiredMessage();
			expect(message).toContain("expired");
			expect(message).toContain("congested");
		});

		test("programErrorMessage", () => {
			const message = programErrorMessage(6001, "Invalid authority");
			expect(message).toContain("6001");
			expect(message).toContain("Invalid authority");
		});
	});

	describe("skip messages", () => {
		test("notFoundMessage", () => {
			const message = notFoundMessage(
				"Vault111111111111111111111111111111111111111",
			);
			expect(message).toContain("Vaul...1111");
			expect(message).toContain("not found");
		});

		test("notASplitMessage", () => {
			const message = notASplitMessage(
				"Addr1111111111111111111111111111111111111111",
			);
			expect(message).toContain("Addr...1111");
			expect(message).toContain("not a Cascade split");
		});
	});
});
