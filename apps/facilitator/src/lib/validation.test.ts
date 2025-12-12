/**
 * Unit tests for transaction validation helpers
 */

import { describe, it, expect } from "vitest";
import type { Address } from "@solana/kit";
import type { PaymentRequirements } from "@x402/core/types";
import {
  detectInstructionLayout,
  verifyComputeLimit,
  verifyComputePrice,
  verifyDeadlineValidator,
  verifyNonceAuthority,
  verifyFeePayerSafety,
  verifyCpiTransfer,
} from "./validation.js";
import type { SimulationResult } from "./signer.js";

// =============================================================================
// Test Constants
// =============================================================================

const COMPUTE_BUDGET_PROGRAM =
  "ComputeBudget111111111111111111111111111111" as Address;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const TOKEN_2022_PROGRAM =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
const DEADLINE_VALIDATOR =
  "DEADaT1auZ8JjUMWUhhPWjQqFk9HSgHBkt5KaGMVnp1H" as Address;
const ASSOCIATED_TOKEN_PROGRAM =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
const SQUADS_PROGRAM = "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu" as Address;

const FEE_PAYER = "F2vVvFwrbGHtsBEqFkSkLvsM6SJmDMm7KqhiW2P64WxY" as Address;
const USER_WALLET = "8ACGYVcVNHToCa6anLweeFnBTV1Q2QQsvh21zWkW6N8i" as Address;

// =============================================================================
// Instruction Layout Detection Tests
// =============================================================================

describe("detectInstructionLayout", () => {
  it("detects minimal 3-instruction direct transfer", () => {
    const instructions = [
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout).not.toBeNull();
    expect(layout?.hasNonceAdvance).toBe(false);
    expect(layout?.computeLimitIndex).toBe(0);
    expect(layout?.computePriceIndex).toBe(1);
    expect(layout?.hasDeadlineValidator).toBe(false);
    expect(layout?.hasAtaCreate).toBe(false);
    expect(layout?.transferIndex).toBe(2);
    expect(layout?.isDirectTransfer).toBe(true);
  });

  it("detects Token-2022 direct transfer", () => {
    const instructions = [
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: TOKEN_2022_PROGRAM },
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout?.isDirectTransfer).toBe(true);
  });

  it("detects 4-instruction with nonce advance", () => {
    const instructions = [
      { programAddress: SYSTEM_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout).not.toBeNull();
    expect(layout?.hasNonceAdvance).toBe(true);
    expect(layout?.computeLimitIndex).toBe(1);
    expect(layout?.computePriceIndex).toBe(2);
    expect(layout?.transferIndex).toBe(3);
  });

  it("detects 4-instruction with deadline validator", () => {
    const instructions = [
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: DEADLINE_VALIDATOR },
      { programAddress: TOKEN_PROGRAM },
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout).not.toBeNull();
    expect(layout?.hasDeadlineValidator).toBe(true);
    expect(layout?.deadlineValidatorIndex).toBe(2);
    expect(layout?.transferIndex).toBe(3);
  });

  it("detects 4-instruction with ATA create", () => {
    const instructions = [
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: ASSOCIATED_TOKEN_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout).not.toBeNull();
    expect(layout?.hasAtaCreate).toBe(true);
    expect(layout?.ataCreateIndex).toBe(2);
    expect(layout?.transferIndex).toBe(3);
  });

  it("detects 6-instruction full layout", () => {
    const instructions = [
      { programAddress: SYSTEM_PROGRAM }, // nonce
      { programAddress: COMPUTE_BUDGET_PROGRAM }, // limit
      { programAddress: COMPUTE_BUDGET_PROGRAM }, // price
      { programAddress: DEADLINE_VALIDATOR }, // deadline
      { programAddress: ASSOCIATED_TOKEN_PROGRAM }, // ata create
      { programAddress: TOKEN_PROGRAM }, // transfer
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout).not.toBeNull();
    expect(layout?.hasNonceAdvance).toBe(true);
    expect(layout?.computeLimitIndex).toBe(1);
    expect(layout?.computePriceIndex).toBe(2);
    expect(layout?.hasDeadlineValidator).toBe(true);
    expect(layout?.deadlineValidatorIndex).toBe(3);
    expect(layout?.hasAtaCreate).toBe(true);
    expect(layout?.ataCreateIndex).toBe(4);
    expect(layout?.transferIndex).toBe(5);
    expect(layout?.isDirectTransfer).toBe(true);
  });

  it("detects CPI transfer (non-token program)", () => {
    const instructions = [
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: SQUADS_PROGRAM }, // Squads useSpendingLimit
    ];

    const layout = detectInstructionLayout(instructions);

    expect(layout?.isDirectTransfer).toBe(false);
  });

  it("rejects too few instructions", () => {
    const instructions = [
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
    ];

    expect(detectInstructionLayout(instructions)).toBeNull();
  });

  it("rejects too many instructions", () => {
    const instructions = [
      { programAddress: SYSTEM_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: COMPUTE_BUDGET_PROGRAM },
      { programAddress: DEADLINE_VALIDATOR },
      { programAddress: ASSOCIATED_TOKEN_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
      { programAddress: TOKEN_PROGRAM }, // 7th instruction
    ];

    expect(detectInstructionLayout(instructions)).toBeNull();
  });

  it("rejects missing compute budget", () => {
    const instructions = [
      { programAddress: TOKEN_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
      { programAddress: TOKEN_PROGRAM },
    ];

    expect(detectInstructionLayout(instructions)).toBeNull();
  });
});

// =============================================================================
// Compute Budget Tests
// =============================================================================

describe("verifyComputeLimit", () => {
  it("accepts valid SetComputeUnitLimit instruction", () => {
    // Discriminator 2 = SetComputeUnitLimit, followed by u32 limit
    const data = new Uint8Array([2, 0x40, 0x42, 0x0f, 0x00]); // 1_000_000 units
    const instruction = {
      programAddress: COMPUTE_BUDGET_PROGRAM,
      data,
    };

    const result = verifyComputeLimit(instruction);
    expect(result.isValid).toBe(true);
  });

  it("rejects wrong discriminator", () => {
    const data = new Uint8Array([3, 0x40, 0x42, 0x0f, 0x00]); // Wrong discriminator
    const instruction = {
      programAddress: COMPUTE_BUDGET_PROGRAM,
      data,
    };

    const result = verifyComputeLimit(instruction);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_compute_limit_instruction");
  });

  it("rejects wrong program", () => {
    const data = new Uint8Array([2, 0x40, 0x42, 0x0f, 0x00]);
    const instruction = {
      programAddress: TOKEN_PROGRAM,
      data,
    };

    const result = verifyComputeLimit(instruction);
    expect(result.isValid).toBe(false);
  });
});

describe("verifyComputePrice", () => {
  it("accepts valid low price", () => {
    // Discriminator 3 = SetComputeUnitPrice, followed by u64 microLamports
    // 1_000_000 microLamports = 1 lamport/CU (well under 5 limit)
    const data = new Uint8Array([
      3, 0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const instruction = {
      programAddress: COMPUTE_BUDGET_PROGRAM,
      data,
    };

    const result = verifyComputePrice(instruction);
    expect(result.isValid).toBe(true);
  });

  it("accepts price at max limit (5 lamports/CU)", () => {
    // 5_000_000 microLamports = 5 lamports/CU (max allowed)
    const data = new Uint8Array([
      3, 0x40, 0x4b, 0x4c, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const instruction = {
      programAddress: COMPUTE_BUDGET_PROGRAM,
      data,
    };

    const result = verifyComputePrice(instruction);
    expect(result.isValid).toBe(true);
  });

  it("rejects price above max limit", () => {
    // 10_000_000 microLamports = 10 lamports/CU (over limit)
    // Use DataView to ensure correct little-endian encoding
    const data = new Uint8Array(9);
    data[0] = 3; // SetComputeUnitPrice discriminator
    const view = new DataView(data.buffer);
    view.setBigUint64(1, 10_000_000n, true); // 10M microLamports

    const instruction = {
      programAddress: COMPUTE_BUDGET_PROGRAM,
      data,
    };

    const result = verifyComputePrice(instruction);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("compute_price_too_high");
  });

  it("rejects wrong discriminator", () => {
    const data = new Uint8Array([
      2, 0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const instruction = {
      programAddress: COMPUTE_BUDGET_PROGRAM,
      data,
    };

    const result = verifyComputePrice(instruction);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_compute_price_instruction");
  });
});

// =============================================================================
// Deadline Validator Tests
// =============================================================================

describe("verifyDeadlineValidator", () => {
  it("accepts valid future deadline", () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
    const data = new Uint8Array(9);
    data[0] = 0; // CheckClock discriminator
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(futureTimestamp), true);

    const instruction = {
      programAddress: DEADLINE_VALIDATOR,
      data,
    };

    const result = verifyDeadlineValidator(instruction);
    expect(result.isValid).toBe(true);
  });

  it("accepts deadline within tolerance (recent past)", () => {
    const recentPast = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
    const data = new Uint8Array(9);
    data[0] = 0;
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(recentPast), true);

    const instruction = {
      programAddress: DEADLINE_VALIDATOR,
      data,
    };

    const result = verifyDeadlineValidator(instruction);
    expect(result.isValid).toBe(true);
  });

  it("rejects deadline too far in past", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    const data = new Uint8Array(9);
    data[0] = 0;
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(oldTimestamp), true);

    const instruction = {
      programAddress: DEADLINE_VALIDATOR,
      data,
    };

    const result = verifyDeadlineValidator(instruction);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("deadline_already_passed");
  });

  it("rejects deadline exceeding maxTimeoutSeconds", () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
    const data = new Uint8Array(9);
    data[0] = 0;
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(futureTimestamp), true);

    const instruction = {
      programAddress: DEADLINE_VALIDATOR,
      data,
    };

    const result = verifyDeadlineValidator(instruction, 60); // Max 60 seconds
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("deadline_exceeds_max_timeout");
  });

  it("accepts deadline within maxTimeoutSeconds", () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now
    const data = new Uint8Array(9);
    data[0] = 0;
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(futureTimestamp), true);

    const instruction = {
      programAddress: DEADLINE_VALIDATOR,
      data,
    };

    const result = verifyDeadlineValidator(instruction, 60); // Max 60 seconds
    expect(result.isValid).toBe(true);
  });

  it("rejects wrong program", () => {
    const data = new Uint8Array(9);
    data[0] = 0;
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(Math.floor(Date.now() / 1000) + 60), true);

    const instruction = {
      programAddress: TOKEN_PROGRAM,
      data,
    };

    const result = verifyDeadlineValidator(instruction);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_deadline_validator_program");
  });

  it("rejects invalid instruction discriminator", () => {
    const data = new Uint8Array(9);
    data[0] = 1; // Wrong discriminator (not CheckClock)
    const view = new DataView(data.buffer);
    view.setBigInt64(1, BigInt(Math.floor(Date.now() / 1000) + 60), true);

    const instruction = {
      programAddress: DEADLINE_VALIDATOR,
      data,
    };

    const result = verifyDeadlineValidator(instruction);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_deadline_instruction_type");
  });
});

// =============================================================================
// Nonce Authority Tests
// =============================================================================

describe("verifyNonceAuthority", () => {
  it("accepts valid nonce authority (not fee payer)", () => {
    // AdvanceNonceAccount discriminator is 4 (u32 LE)
    const data = new Uint8Array([4, 0, 0, 0]);
    const instruction = {
      programAddress: SYSTEM_PROGRAM,
      accounts: [
        { address: "NonceAccount11111111111111111111111111111111" as Address },
        { address: "SysvarRecentB1ockHashes11111111111111111111" as Address },
        { address: USER_WALLET }, // Authority is user, not fee payer
      ],
      data,
    };

    const result = verifyNonceAuthority(instruction, [FEE_PAYER.toString()]);
    expect(result.isValid).toBe(true);
  });

  it("rejects fee payer as nonce authority", () => {
    const data = new Uint8Array([4, 0, 0, 0]);
    const instruction = {
      programAddress: SYSTEM_PROGRAM,
      accounts: [
        { address: "NonceAccount11111111111111111111111111111111" as Address },
        { address: "SysvarRecentB1ockHashes11111111111111111111" as Address },
        { address: FEE_PAYER }, // Fee payer as authority - BAD
      ],
      data,
    };

    const result = verifyNonceAuthority(instruction, [FEE_PAYER.toString()]);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("fee_payer_is_nonce_authority");
  });

  it("rejects wrong instruction discriminator", () => {
    const data = new Uint8Array([3, 0, 0, 0]); // Not AdvanceNonceAccount
    const instruction = {
      programAddress: SYSTEM_PROGRAM,
      accounts: [
        { address: "NonceAccount11111111111111111111111111111111" as Address },
        { address: "SysvarRecentB1ockHashes11111111111111111111" as Address },
        { address: USER_WALLET },
      ],
      data,
    };

    const result = verifyNonceAuthority(instruction, [FEE_PAYER.toString()]);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_nonce_instruction_type");
  });
});

// =============================================================================
// Fee Payer Safety Tests
// =============================================================================

describe("verifyFeePayerSafety", () => {
  const layout = {
    hasNonceAdvance: false,
    computeLimitIndex: 0,
    computePriceIndex: 1,
    hasDeadlineValidator: false,
    hasAtaCreate: false,
    transferIndex: 2,
    isDirectTransfer: true,
  };

  it("accepts when fee payer not in instruction accounts", () => {
    const compiled = {
      staticAccounts: [FEE_PAYER, USER_WALLET, TOKEN_PROGRAM],
      instructions: [
        { accountIndices: [] }, // compute limit
        { accountIndices: [] }, // compute price
        { accountIndices: [1] }, // transfer - only user wallet
      ],
    };

    const result = verifyFeePayerSafety(
      compiled as never,
      [FEE_PAYER.toString()],
      layout,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects fee payer in transfer accounts", () => {
    const compiled = {
      staticAccounts: [FEE_PAYER, USER_WALLET, TOKEN_PROGRAM],
      instructions: [
        { accountIndices: [] }, // compute limit
        { accountIndices: [] }, // compute price
        { accountIndices: [0, 1] }, // transfer includes fee payer - BAD
      ],
    };

    const result = verifyFeePayerSafety(
      compiled as never,
      [FEE_PAYER.toString()],
      layout,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("fee_payer_in_instruction_accounts");
  });

  it("allows fee payer in compute budget instruction accounts", () => {
    const compiled = {
      staticAccounts: [FEE_PAYER, USER_WALLET, TOKEN_PROGRAM],
      instructions: [
        { accountIndices: [0] }, // compute limit - fee payer OK here
        { accountIndices: [0] }, // compute price - fee payer OK here
        { accountIndices: [1] }, // transfer - no fee payer
      ],
    };

    const result = verifyFeePayerSafety(
      compiled as never,
      [FEE_PAYER.toString()],
      layout,
    );
    expect(result.isValid).toBe(true);
  });
});

// =============================================================================
// CPI Transfer Verification Tests
// =============================================================================

describe("verifyCpiTransfer", () => {
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    amount: "1000000", // 1 USDC
    asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    payTo: USER_WALLET.toString(),
    maxTimeoutSeconds: 90,
    extra: {},
  };

  // Helper to create TransferChecked instruction data
  function createTransferCheckedData(amount: bigint): string {
    const data = new Uint8Array(10);
    data[0] = 12; // TransferChecked discriminator
    const view = new DataView(data.buffer);
    view.setBigUint64(1, amount, true);
    data[9] = 6; // decimals
    // Convert to base64
    return btoa(String.fromCharCode(...data));
  }

  it("accepts valid CPI transfer with correct amount", async () => {
    const simulationResult: SimulationResult = {
      success: true,
      logs: ["Program log: Transfer"],
      innerInstructions: [
        {
          index: 2,
          instructions: [
            {
              programIdIndex: 3,
              accounts: [1, 2, 3, 4],
              data: createTransferCheckedData(1000000n),
            },
          ],
        },
      ],
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(true);
  });

  it("accepts CPI transfer with higher amount", async () => {
    const simulationResult: SimulationResult = {
      success: true,
      innerInstructions: [
        {
          index: 2,
          instructions: [
            {
              programIdIndex: 3,
              accounts: [1, 2, 3, 4],
              data: createTransferCheckedData(2000000n), // 2x required
            },
          ],
        },
      ],
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(true);
  });

  it("rejects CPI transfer with insufficient amount", async () => {
    const simulationResult: SimulationResult = {
      success: true,
      innerInstructions: [
        {
          index: 2,
          instructions: [
            {
              programIdIndex: 3,
              accounts: [1, 2, 3, 4],
              data: createTransferCheckedData(500000n), // Only 0.5 USDC
            },
          ],
        },
      ],
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("insufficient_amount");
  });

  it("rejects failed simulation", async () => {
    const simulationResult: SimulationResult = {
      success: false,
      error: "InstructionError: [2, InsufficientFunds]",
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toContain("simulation_failed");
  });

  it("rejects no inner instructions", async () => {
    const simulationResult: SimulationResult = {
      success: true,
      innerInstructions: [],
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("no_inner_instructions");
  });

  it("rejects no transfer in inner instructions", async () => {
    const simulationResult: SimulationResult = {
      success: true,
      innerInstructions: [
        {
          index: 2,
          instructions: [
            {
              programIdIndex: 3,
              accounts: [1, 2],
              data: btoa(String.fromCharCode(5, 0, 0, 0)), // Not TransferChecked
            },
          ],
        },
      ],
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("no_transfer_in_cpi");
  });

  it("rejects multiple transfers in CPI", async () => {
    const transferData = createTransferCheckedData(1000000n);
    const simulationResult: SimulationResult = {
      success: true,
      innerInstructions: [
        {
          index: 2,
          instructions: [
            {
              programIdIndex: 3,
              accounts: [1, 2, 3, 4],
              data: transferData,
            },
            {
              programIdIndex: 3,
              accounts: [5, 6, 7, 8],
              data: transferData, // Second transfer - BAD
            },
          ],
        },
      ],
    };

    const result = await verifyCpiTransfer(simulationResult, requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("multiple_transfers_in_cpi");
  });
});
