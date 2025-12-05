/**
 * Tests for executeAndConfirmSplit
 *
 * Uses Vitest mocking to test the transaction execution logic
 * without requiring WebSocket connections.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type {
	Address,
	TransactionSigner,
	Rpc,
	SolanaRpcApi,
	RpcSubscriptions,
	SignatureNotificationsApi,
	SlotNotificationsApi,
} from "@solana/kit";

// Mock @solana/kit at the top level
vi.mock("@solana/kit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@solana/kit")>();
	return {
		...actual,
		sendAndConfirmTransactionFactory: vi.fn(),
		createTransactionMessage: vi.fn(() => ({})),
		setTransactionMessageFeePayerSigner: vi.fn((_signer, msg) => msg),
		setTransactionMessageLifetimeUsingBlockhash: vi.fn(
			(_blockhash, msg) => msg,
		),
		appendTransactionMessageInstructions: vi.fn((_instructions, msg) => msg),
		signTransactionMessageWithSigners: vi.fn(async () => ({
			messageBytes: new Uint8Array(),
			signatures: {},
			lifetimeConstraint: {
				lastValidBlockHeight: 1000n,
			},
		})),
		getSignatureFromTransaction: vi.fn(
			() =>
				"5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
		),
		assertIsTransactionWithBlockhashLifetime: vi.fn(),
		pipe: vi.fn((initial, ...fns) => fns.reduce((acc, fn) => fn(acc), initial)),
	};
});

// Mock @solana-program/compute-budget
vi.mock("@solana-program/compute-budget", () => ({
	getSetComputeUnitLimitInstruction: vi.fn(() => ({
		programAddress: "ComputeBudget111111111111111111111111111111" as Address,
		accounts: [],
		data: new Uint8Array(),
	})),
	getSetComputeUnitPriceInstruction: vi.fn(() => ({
		programAddress: "ComputeBudget111111111111111111111111111111" as Address,
		accounts: [],
		data: new Uint8Array(),
	})),
}));

// Mock internal dependencies
vi.mock("./helpers.js", () => ({
	getVaultBalanceAndOwner: vi.fn(),
	invalidateProtocolConfigCache: vi.fn(),
}));

vi.mock("./instructions.js", () => ({
	executeSplit: vi.fn(),
}));

import {
	sendAndConfirmTransactionFactory,
	SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
	SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";
import {
	getVaultBalanceAndOwner,
	invalidateProtocolConfigCache,
} from "./helpers.js";
import { executeSplit } from "./instructions.js";
import { executeAndConfirmSplit } from "./execute.js";

// Note: Client uses hardcoded 6004 for InvalidProtocolFeeRecipient error detection
const INVALID_PROTOCOL_FEE_RECIPIENT_ERROR_CODE = 6004;

// =============================================================================
// Test Fixtures
// =============================================================================

const mockVault = "Vault1111111111111111111111111111111111111111" as Address;
const mockTokenProgram =
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

type MockRpc = Rpc<SolanaRpcApi>;
type MockRpcSubscriptions = RpcSubscriptions<
	SignatureNotificationsApi & SlotNotificationsApi
>;

const createMockRpc = (): MockRpc => {
	const rpc = {
		getLatestBlockhash: vi.fn(() => ({
			send: vi.fn(async () => ({
				value: {
					blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
					lastValidBlockHeight: 1000n,
				},
			})),
		})),
	};
	return rpc as unknown as MockRpc;
};

const createMockRpcSubscriptions = (): MockRpcSubscriptions => {
	return {} as MockRpcSubscriptions;
};

const createMockSigner = (): TransactionSigner => {
	return {
		address: "Signer111111111111111111111111111111111111111" as Address,
		signTransactions: vi.fn(),
	} as unknown as TransactionSigner;
};

// Helper to create mock error with code
interface MockSolanaError extends Error {
	__code: number;
	context?: { code: number };
}

const createMockSolanaError = (
	message: string,
	code: number,
	context?: { code: number },
): MockSolanaError => {
	const error = new Error(message) as MockSolanaError;
	error.__code = code;
	if (context) {
		error.context = context;
	}
	Object.defineProperty(error, Symbol.for("solana-error"), { value: true });
	return error;
};

// =============================================================================
// Tests
// =============================================================================

describe("executeAndConfirmSplit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("returns signature on success", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		expect(result.status).toBe("EXECUTED");
		if (result.status === "EXECUTED") {
			expect(result.signature).toBeDefined();
		}
	});

	test("returns not_found when vault doesn't exist", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue(null);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		expect(result).toEqual({ status: "SKIPPED", reason: "not_found" });
	});

	test("returns not_a_split when vault is not a split", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: false,
			reason: "not_a_split",
		});

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		expect(result).toEqual({ status: "SKIPPED", reason: "not_a_split" });
	});

	test("returns below_threshold when balance < minBalance", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 500_000n, // 0.5 USDC
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
			{ minBalance: 1_000_000n }, // 1 USDC threshold
		);

		expect(result).toEqual({ status: "SKIPPED", reason: "below_threshold" });
	});

	test("executes when balance >= minBalance", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 2_000_000n, // 2 USDC
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
			{ minBalance: 1_000_000n }, // 1 USDC threshold
		);

		expect(result.status).toBe("EXECUTED");
	});

	test("adds compute budget instructions when options set", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		const {
			getSetComputeUnitLimitInstruction,
			getSetComputeUnitPriceInstruction,
		} = await import("@solana-program/compute-budget");

		await executeAndConfirmSplit(rpc, rpcSubscriptions, mockVault, signer, {
			computeUnitLimit: 150_000,
			computeUnitPrice: 50_000n,
		});

		expect(getSetComputeUnitLimitInstruction).toHaveBeenCalledWith({
			units: 150_000,
		});
		expect(getSetComputeUnitPriceInstruction).toHaveBeenCalledWith({
			microLamports: 50_000n,
		});
	});

	test("returns expired when blockhash expires", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const blockHeightError = createMockSolanaError(
			"Transaction blockhash expired",
			SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
		);

		const mockSendAndConfirm = vi.fn().mockRejectedValue(blockHeightError);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		// Mock isSolanaError to return true for this specific error
		const kitModule = await import("@solana/kit");
		vi.spyOn(kitModule, "isSolanaError").mockImplementation(
			(e: unknown, code?: number) => {
				return code !== undefined && (e as MockSolanaError).__code === code;
			},
		);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		expect(result.status).toBe("FAILED");
		if (result.status === "FAILED") {
			expect(result.reason).toBe("transaction_expired");
		}
	});

	test("returns aborted when abortSignal is triggered", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const abortController = new AbortController();
		const abortError = new Error("Aborted");
		abortController.abort();

		const mockSendAndConfirm = vi.fn().mockRejectedValue(abortError);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
			{ abortSignal: abortController.signal },
		);

		expect(result.status).toBe("FAILED");
		if (result.status === "FAILED") {
			expect(result.reason).toBe("transaction_expired"); // Abort maps to expired in client impl
		}
	});

	test("auto-retries on InvalidProtocolFeeRecipient (stale fee_wallet)", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		// First call fails with InvalidProtocolFeeRecipient, second succeeds
		// Error message format that isProgramError detects: includes hex code
		const protocolFeeError = createMockSolanaError(
			`custom program error: 0x${INVALID_PROTOCOL_FEE_RECIPIENT_ERROR_CODE.toString(16)}`,
			SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
			{ code: INVALID_PROTOCOL_FEE_RECIPIENT_ERROR_CODE },
		);

		const mockSendAndConfirm = vi
			.fn()
			.mockRejectedValueOnce(protocolFeeError)
			.mockResolvedValueOnce(undefined);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		// Mock isSolanaError
		const kitModule = await import("@solana/kit");
		vi.spyOn(kitModule, "isSolanaError").mockImplementation(
			(e: unknown, code?: number) => {
				return code !== undefined && (e as MockSolanaError).__code === code;
			},
		);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		expect(invalidateProtocolConfigCache).toHaveBeenCalled();
		expect(result.status).toBe("EXECUTED");
	});

	test("does not retry more than once on InvalidProtocolFeeRecipient", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 1_000_000n,
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		// Both calls fail
		// Error message format that isProgramError detects: includes hex code
		const protocolFeeError = createMockSolanaError(
			`custom program error: 0x${INVALID_PROTOCOL_FEE_RECIPIENT_ERROR_CODE.toString(16)}`,
			SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
			{ code: INVALID_PROTOCOL_FEE_RECIPIENT_ERROR_CODE },
		);

		const mockSendAndConfirm = vi.fn().mockRejectedValue(protocolFeeError);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		// Mock isSolanaError
		const kitModule = await import("@solana/kit");
		vi.spyOn(kitModule, "isSolanaError").mockImplementation(
			(e: unknown, code?: number) => {
				return code !== undefined && (e as MockSolanaError).__code === code;
			},
		);

		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		// Should only be called once for invalidation (retry fails, no second invalidation)
		expect(invalidateProtocolConfigCache).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("FAILED");
		if (result.status === "FAILED") {
			expect(result.reason).toBe("program_error");
		}
	});

	test("executes even when vault balance is 0 (may have unclaimed amounts)", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getVaultBalanceAndOwner).mockResolvedValue({
			balance: 0n, // Empty vault
			tokenProgram: mockTokenProgram,
		});

		vi.mocked(executeSplit).mockResolvedValue({
			ok: true,
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
		});

		const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);

		// Without minBalance, should still execute (program handles unclaimed amounts)
		const result = await executeAndConfirmSplit(
			rpc,
			rpcSubscriptions,
			mockVault,
			signer,
		);

		expect(result.status).toBe("EXECUTED");
		expect(mockSendAndConfirm).toHaveBeenCalled();
	});
});
