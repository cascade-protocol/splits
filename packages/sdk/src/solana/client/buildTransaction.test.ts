/**
 * Tests for buildTransaction utility
 *
 * Note: The actual transaction building is tested via integration tests.
 * These unit tests verify the function interface and options handling.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type {
	Address,
	Rpc,
	SolanaRpcApi,
	Instruction,
	Blockhash,
} from "@solana/kit";

// Mock @solana-program/compute-budget
vi.mock("@solana-program/compute-budget", () => ({
	getSetComputeUnitPriceInstruction: vi.fn(({ microLamports }) => ({
		programAddress: "ComputeBudget111111111111111111111111111111" as Address,
		accounts: [],
		data: new Uint8Array([Number(microLamports) % 256]),
	})),
	getSetComputeUnitLimitInstruction: vi.fn(({ units }) => ({
		programAddress: "ComputeBudget111111111111111111111111111111" as Address,
		accounts: [],
		data: new Uint8Array([units % 256]),
	})),
}));

import { buildTransaction } from "./buildTransaction.js";
import {
	getSetComputeUnitPriceInstruction,
	getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";

// =============================================================================
// Test Fixtures
// =============================================================================

type MockRpc = Rpc<SolanaRpcApi>;

const mockBlockhash =
	"GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi" as Blockhash;

const createMockRpc = (): MockRpc => {
	const rpc = {
		getLatestBlockhash: vi.fn(() => ({
			send: vi.fn(async () => ({
				value: {
					blockhash: mockBlockhash,
					lastValidBlockHeight: 1000n,
				},
			})),
		})),
	};
	return rpc as unknown as MockRpc;
};

const mockInstruction: Instruction = {
	programAddress: "SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB" as Address,
	accounts: [],
	data: new Uint8Array([1, 2, 3]),
};

const mockFeePayer = "A1ice111111111111111111111111111111111111111" as Address;

// =============================================================================
// Tests
// =============================================================================

describe("buildTransaction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("builds transaction message with single instruction", async () => {
		const rpc = createMockRpc();

		const message = await buildTransaction(rpc, mockFeePayer, [
			mockInstruction,
		]);

		expect(message).toBeDefined();
		expect(message.feePayer).toBe(mockFeePayer);
		expect(message.instructions).toHaveLength(1);
		expect(message.lifetimeConstraint.blockhash).toBe(mockBlockhash);
		expect(message.lifetimeConstraint.lastValidBlockHeight).toBe(1000n);
		expect(rpc.getLatestBlockhash).toHaveBeenCalled();
	});

	test("builds transaction message with multiple instructions", async () => {
		const rpc = createMockRpc();
		const instruction2: Instruction = {
			programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
			accounts: [],
			data: new Uint8Array([4, 5, 6]),
		};

		const message = await buildTransaction(rpc, mockFeePayer, [
			mockInstruction,
			instruction2,
		]);

		expect(message).toBeDefined();
		expect(message.instructions).toHaveLength(2);
	});

	test("adds compute unit price when specified", async () => {
		const rpc = createMockRpc();

		const message = await buildTransaction(
			rpc,
			mockFeePayer,
			[mockInstruction],
			{
				computeUnitPrice: 50000n,
			},
		);

		expect(getSetComputeUnitPriceInstruction).toHaveBeenCalledWith({
			microLamports: 50000n,
		});
		// Price instruction should be first
		expect(message.instructions).toHaveLength(2);
	});

	test("adds compute unit limit when specified", async () => {
		const rpc = createMockRpc();

		const message = await buildTransaction(
			rpc,
			mockFeePayer,
			[mockInstruction],
			{
				computeUnitLimit: 200000,
			},
		);

		expect(getSetComputeUnitLimitInstruction).toHaveBeenCalledWith({
			units: 200000,
		});
		// Limit instruction should be first
		expect(message.instructions).toHaveLength(2);
	});

	test("adds both compute budget instructions when both specified", async () => {
		const rpc = createMockRpc();

		const message = await buildTransaction(
			rpc,
			mockFeePayer,
			[mockInstruction],
			{
				computeUnitPrice: 50000n,
				computeUnitLimit: 200000,
			},
		);

		expect(getSetComputeUnitPriceInstruction).toHaveBeenCalled();
		expect(getSetComputeUnitLimitInstruction).toHaveBeenCalled();
		// Both compute budget + main instruction
		expect(message.instructions).toHaveLength(3);
	});

	test("does not add compute budget instructions when not specified", async () => {
		const rpc = createMockRpc();

		const message = await buildTransaction(rpc, mockFeePayer, [
			mockInstruction,
		]);

		expect(getSetComputeUnitPriceInstruction).not.toHaveBeenCalled();
		expect(getSetComputeUnitLimitInstruction).not.toHaveBeenCalled();
		expect(message.instructions).toHaveLength(1);
	});

	test("fetches latest blockhash from RPC", async () => {
		const rpc = createMockRpc();

		await buildTransaction(rpc, mockFeePayer, [mockInstruction]);

		expect(rpc.getLatestBlockhash).toHaveBeenCalled();
	});
});
