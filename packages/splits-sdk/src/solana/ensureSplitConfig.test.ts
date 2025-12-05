/**
 * Tests for ensureSplitConfig
 *
 * Uses Vitest mocking to test idempotent create/update logic
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

// Mock @solana/kit transaction functions
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
			lifetimeConstraint: { lastValidBlockHeight: 1000n },
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
	getSetComputeUnitPriceInstruction: vi.fn(() => ({
		programAddress: "ComputeBudget111111111111111111111111111111" as Address,
		accounts: [],
		data: new Uint8Array(),
	})),
}));

// Mock helpers
vi.mock("./helpers.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./helpers.js")>();
	return {
		...actual,
		deriveSplitConfig: vi.fn(),
		deriveVault: vi.fn(),
		getSplitConfigFromVault: vi.fn(),
		getVaultBalance: vi.fn(),
		checkRecipientAtas: vi.fn(),
		detectTokenProgram: vi.fn(),
		recipientsEqual: actual.recipientsEqual, // Use real implementation
	};
});

// Mock instructions
vi.mock("./instructions.js", () => ({
	createSplitConfig: vi.fn(),
	updateSplitConfig: vi.fn(),
}));

import { sendAndConfirmTransactionFactory } from "@solana/kit";
import {
	deriveSplitConfig,
	deriveVault,
	getSplitConfigFromVault,
	getVaultBalance,
	checkRecipientAtas,
	detectTokenProgram,
	type SplitRecipient,
} from "./helpers.js";
import { createSplitConfig, updateSplitConfig } from "./instructions.js";
import { ensureSplitConfig } from "./ensureSplitConfig.js";
import { VaultNotFoundError } from "../errors.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockSplitConfig =
	"SpCfg111111111111111111111111111111111111111" as Address;
const mockVault = "Vault111111111111111111111111111111111111111" as Address;
const mockTokenProgram =
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const mockToken2022Program =
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const mockAlice = "A1ice111111111111111111111111111111111111111" as Address;
const mockBob = "Bob11111111111111111111111111111111111111111" as Address;
const mockUsdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const mockCustomSeed =
	"Seed1111111111111111111111111111111111111111" as Address;

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
		getMinimumBalanceForRentExemption: vi.fn(() => ({
			send: vi.fn(async () => 14616000n),
		})),
	};
	return rpc as unknown as MockRpc;
};

const createMockRpcSubscriptions = (): MockRpcSubscriptions => {
	return {} as MockRpcSubscriptions;
};

const createMockSigner = (address: Address = mockAlice): TransactionSigner => {
	return {
		address,
		signTransactions: vi.fn(),
	} as unknown as TransactionSigner;
};

const createMockSplitConfig = (overrides?: {
	recipients?: SplitRecipient[];
	unclaimedAmounts?: Array<{
		recipient: Address;
		amount: bigint;
		timestamp: bigint;
	}>;
	protocolUnclaimed?: bigint;
}): {
	address: Address;
	version: number;
	authority: Address;
	mint: Address;
	vault: Address;
	uniqueId: Address;
	bump: number;
	recipients: SplitRecipient[];
	unclaimedAmounts: Array<{
		recipient: Address;
		amount: bigint;
		timestamp: bigint;
	}>;
	protocolUnclaimed: bigint;
	lastActivity: bigint;
	rentPayer: Address;
} => ({
	address: mockSplitConfig,
	version: 1,
	authority: mockAlice,
	mint: mockUsdc,
	vault: mockVault,
	uniqueId: "11111111111111111111111111111111" as Address,
	bump: 255,
	recipients: overrides?.recipients ?? [
		{ address: mockAlice, percentageBps: 6930, share: 70 },
		{ address: mockBob, percentageBps: 2871, share: 29 },
	],
	unclaimedAmounts: overrides?.unclaimedAmounts ?? [],
	protocolUnclaimed: overrides?.protocolUnclaimed ?? 0n,
	lastActivity: 0n,
	rentPayer: mockAlice,
});

// =============================================================================
// Tests
// =============================================================================

describe("ensureSplitConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Default mock implementations
		vi.mocked(deriveSplitConfig).mockResolvedValue(mockSplitConfig);
		vi.mocked(deriveVault).mockResolvedValue(mockVault);
		vi.mocked(detectTokenProgram).mockResolvedValue(mockTokenProgram);
		vi.mocked(checkRecipientAtas).mockResolvedValue([]);
		vi.mocked(getVaultBalance).mockResolvedValue(0n);

		// Default send and confirm
		const mockSendAndConfirm = vi.fn().mockResolvedValue(undefined);
		vi.mocked(sendAndConfirmTransactionFactory).mockReturnValue(
			mockSendAndConfirm,
		);
	});

	test("returns CREATED for new config", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getSplitConfigFromVault).mockRejectedValue(
			new VaultNotFoundError(mockVault),
		);
		vi.mocked(createSplitConfig).mockResolvedValue({
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
			vault: mockVault,
			splitConfig: mockSplitConfig,
		});

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 70 },
				{ address: mockBob as string, share: 29 },
			],
		});

		expect(result.status).toBe("CREATED");
		if (result.status === "CREATED") {
			expect(result.vault).toBe(mockVault);
			expect(result.splitConfig).toBe(mockSplitConfig);
			expect(result.signature).toBeDefined();
		}
	});

	test("returns NO_CHANGE when recipients match (same order)", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig();
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 70 },
				{ address: mockBob as string, share: 29 },
			],
		});

		expect(result.status).toBe("NO_CHANGE");
		if (result.status === "NO_CHANGE") {
			expect(result.vault).toBe(mockVault);
		}
	});

	test("returns NO_CHANGE when recipients match (different order)", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig();
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);

		// Recipients in different order
		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockBob as string, share: 29 },
				{ address: mockAlice as string, share: 70 },
			],
		});

		expect(result.status).toBe("NO_CHANGE");
	});

	test("returns UPDATED when recipients differ and vault empty", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig();
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);
		vi.mocked(getVaultBalance).mockResolvedValue(0n);
		vi.mocked(updateSplitConfig).mockResolvedValue({
			programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
			accounts: [],
			data: new Uint8Array(),
		});

		// Different shares
		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 60 },
				{ address: mockBob as string, share: 39 },
			],
		});

		expect(result.status).toBe("UPDATED");
		if (result.status === "UPDATED") {
			expect(result.signature).toBeDefined();
		}
	});

	test("returns BLOCKED vault_not_empty when vault has balance", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig();
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);
		vi.mocked(getVaultBalance).mockResolvedValue(1_000_000n); // 1 USDC

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 60 },
				{ address: mockBob as string, share: 39 },
			],
		});

		expect(result.status).toBe("BLOCKED");
		if (result.status === "BLOCKED") {
			expect(result.reason).toBe("vault_not_empty");
		}
	});

	test("returns BLOCKED unclaimed_pending when unclaimed exists", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig({
			unclaimedAmounts: [
				{ recipient: mockAlice, amount: 100_000n, timestamp: 0n },
			],
		});
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);
		vi.mocked(getVaultBalance).mockResolvedValue(0n);

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 60 },
				{ address: mockBob as string, share: 39 },
			],
		});

		expect(result.status).toBe("BLOCKED");
		if (result.status === "BLOCKED") {
			expect(result.reason).toBe("unclaimed_pending");
		}
	});

	test("returns BLOCKED recipient_atas_missing on create with missing ATAs", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getSplitConfigFromVault).mockRejectedValue(
			new VaultNotFoundError(mockVault),
		);
		vi.mocked(checkRecipientAtas).mockResolvedValue([
			{ recipient: mockAlice as string, ata: "MissingAta1" as string },
		]);

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [{ address: mockAlice as string, share: 99 }],
		});

		expect(result.status).toBe("BLOCKED");
		if (result.status === "BLOCKED") {
			expect(result.reason).toBe("recipient_atas_missing");
		}
	});

	test("returns BLOCKED recipient_atas_missing on update with missing ATAs", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig();
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);
		vi.mocked(checkRecipientAtas).mockResolvedValue([
			{ recipient: mockAlice as string, ata: "MissingAta1" as string },
		]);

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 60 },
				{ address: mockBob as string, share: 39 },
			],
		});

		expect(result.status).toBe("BLOCKED");
		if (result.status === "BLOCKED") {
			expect(result.reason).toBe("recipient_atas_missing");
		}
	});

	test("uses default seed when not provided", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getSplitConfigFromVault).mockRejectedValue(
			new VaultNotFoundError(mockVault),
		);
		vi.mocked(createSplitConfig).mockResolvedValue({
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
			vault: mockVault,
			splitConfig: mockSplitConfig,
		});

		await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [{ address: mockAlice as string, share: 99 }],
		});

		// deriveSplitConfig should be called with default seed (System Program ID)
		expect(deriveSplitConfig).toHaveBeenCalledWith(
			signer.address,
			mockUsdc,
			"11111111111111111111111111111111", // SYSTEM_PROGRAM_ID
		);
	});

	test("uses custom seed when provided", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(getSplitConfigFromVault).mockRejectedValue(
			new VaultNotFoundError(mockVault),
		);
		vi.mocked(createSplitConfig).mockResolvedValue({
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
			vault: mockVault,
			splitConfig: mockSplitConfig,
		});

		await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [{ address: mockAlice as string, share: 99 }],
			seed: mockCustomSeed,
		});

		expect(deriveSplitConfig).toHaveBeenCalledWith(
			signer.address,
			mockUsdc,
			mockCustomSeed,
		);
	});

	test("auto-detects Token-2022 from mint", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		vi.mocked(detectTokenProgram).mockResolvedValue(mockToken2022Program);
		vi.mocked(getSplitConfigFromVault).mockRejectedValue(
			new VaultNotFoundError(mockVault),
		);
		vi.mocked(createSplitConfig).mockResolvedValue({
			instruction: {
				programAddress:
					"SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
				accounts: [],
				data: new Uint8Array(),
			},
			vault: mockVault,
			splitConfig: mockSplitConfig,
		});

		await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [{ address: mockAlice as string, share: 99 }],
		});

		// deriveVault should be called with Token-2022 program
		expect(deriveVault).toHaveBeenCalledWith(
			mockSplitConfig,
			mockUsdc,
			mockToken2022Program,
		);

		// createSplitConfig should be called with Token-2022 program
		expect(createSplitConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				tokenProgram: mockToken2022Program,
			}),
		);
	});

	test("returns BLOCKED unclaimed_pending when protocolUnclaimed > 0", async () => {
		const rpc = createMockRpc();
		const rpcSubscriptions = createMockRpcSubscriptions();
		const signer = createMockSigner();

		const existingConfig = createMockSplitConfig({
			protocolUnclaimed: 50_000n,
		});
		vi.mocked(getSplitConfigFromVault).mockResolvedValue(existingConfig);
		vi.mocked(getVaultBalance).mockResolvedValue(0n);

		const result = await ensureSplitConfig(rpc, rpcSubscriptions, signer, {
			recipients: [
				{ address: mockAlice as string, share: 60 },
				{ address: mockBob as string, share: 39 },
			],
		});

		expect(result.status).toBe("BLOCKED");
		if (result.status === "BLOCKED") {
			expect(result.reason).toBe("unclaimed_pending");
		}
	});
});
