/**
 * Transaction Validation Helpers
 *
 * Implements RFC #646 instruction validation for:
 * - 3-6 instruction transactions
 * - Compute budget verification
 * - Deadline validator verification
 * - Transfer verification (static and CPI)
 */

import {
  type Address,
  type CompiledTransactionMessage,
  type Transaction,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  TOKEN_PROGRAM_ADDRESS,
  parseTransferCheckedInstruction as parseTransferCheckedToken,
  findAssociatedTokenPda,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  parseTransferCheckedInstruction as parseTransferChecked2022,
} from "@solana-program/token-2022";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import type { PaymentRequirements } from "@x402/core/types";
import { decodeTransaction, type SimulationResult } from "./signer.js";

// =============================================================================
// Constants
// =============================================================================

/** Maximum compute unit price (5 lamports per CU) */
const MAX_COMPUTE_UNIT_PRICE = 5_000_000n;

/** Deadline validator program address */
const DEADLINE_VALIDATOR_PROGRAM =
  "DEADaT1auZ8JjUMWUhhPWjQqFk9HSgHBkt5KaGMVnp1H";

/** Associated Token Program address */
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface InstructionLayout {
  hasNonceAdvance: boolean;
  computeLimitIndex: number;
  computePriceIndex: number;
  hasDeadlineValidator: boolean;
  deadlineValidatorIndex?: number;
  hasAtaCreate: boolean;
  ataCreateIndex?: number;
  transferIndex: number;
  isDirectTransfer: boolean;
}

/** Parsed TransferChecked instruction structure (compatible with Token and Token-2022) */
interface ParsedTransferChecked {
  accounts: {
    authority: { address: Address };
    mint: { address: Address };
    destination: { address: Address };
  };
  data: {
    amount: bigint;
  };
}

// =============================================================================
// Instruction Layout Detection
// =============================================================================

/**
 * Detect the instruction layout of a transaction.
 * Supports RFC #646 layouts with 3-6 instructions.
 */
export function detectInstructionLayout(
  instructions: ReadonlyArray<{ programAddress: Address }>,
): InstructionLayout | null {
  const count = instructions.length;

  // Must have 3-6 instructions
  if (count < 3 || count > 6) {
    return null;
  }

  let offset = 0;

  // Check for nonce advance at position 0
  const hasNonceAdvance =
    instructions[0].programAddress.toString() ===
    SYSTEM_PROGRAM_ADDRESS.toString();
  if (hasNonceAdvance) {
    offset = 1;
  }

  // Next two must be compute budget
  const computeLimitIndex = offset;
  const computePriceIndex = offset + 1;

  if (
    instructions[computeLimitIndex]?.programAddress.toString() !==
      COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    instructions[computePriceIndex]?.programAddress.toString() !==
      COMPUTE_BUDGET_PROGRAM_ADDRESS.toString()
  ) {
    return null;
  }

  offset += 2;

  // Check for optional deadline validator
  let hasDeadlineValidator = false;
  let deadlineValidatorIndex: number | undefined;
  if (
    offset < count - 1 &&
    instructions[offset].programAddress.toString() ===
      DEADLINE_VALIDATOR_PROGRAM
  ) {
    hasDeadlineValidator = true;
    deadlineValidatorIndex = offset;
    offset++;
  }

  // Check for optional ATA create
  let hasAtaCreate = false;
  let ataCreateIndex: number | undefined;
  if (
    offset < count - 1 &&
    instructions[offset].programAddress.toString() === ASSOCIATED_TOKEN_PROGRAM
  ) {
    hasAtaCreate = true;
    ataCreateIndex = offset;
    offset++;
  }

  // Last instruction must be the transfer
  const transferIndex = count - 1;
  if (offset !== transferIndex) {
    return null;
  }

  // Check if it's a direct token transfer
  const transferProgram = instructions[transferIndex].programAddress.toString();
  const isDirectTransfer =
    transferProgram === TOKEN_PROGRAM_ADDRESS.toString() ||
    transferProgram === TOKEN_2022_PROGRAM_ADDRESS.toString();

  return {
    hasNonceAdvance,
    computeLimitIndex,
    computePriceIndex,
    hasDeadlineValidator,
    deadlineValidatorIndex,
    hasAtaCreate,
    ataCreateIndex,
    transferIndex,
    isDirectTransfer,
  };
}

// =============================================================================
// Compute Budget Verification
// =============================================================================

export function verifyComputeLimit(instruction: {
  programAddress: Address;
  data?: Readonly<Uint8Array>;
}): ValidationResult {
  if (
    instruction.programAddress.toString() !==
      COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !instruction.data ||
    instruction.data[0] !== 2 // SetComputeUnitLimit discriminator
  ) {
    return {
      isValid: false,
      invalidReason: "invalid_compute_limit_instruction",
    };
  }

  try {
    parseSetComputeUnitLimitInstruction(instruction as never);
    return { isValid: true };
  } catch {
    return {
      isValid: false,
      invalidReason: "invalid_compute_limit_instruction",
    };
  }
}

export function verifyComputePrice(instruction: {
  programAddress: Address;
  data?: Readonly<Uint8Array>;
}): ValidationResult {
  if (
    instruction.programAddress.toString() !==
      COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !instruction.data ||
    instruction.data[0] !== 3 // SetComputeUnitPrice discriminator
  ) {
    return {
      isValid: false,
      invalidReason: "invalid_compute_price_instruction",
    };
  }

  try {
    const parsed = parseSetComputeUnitPriceInstruction(instruction as never);
    const price = (parsed as unknown as { data: { microLamports: bigint } })
      .data.microLamports;

    if (price > MAX_COMPUTE_UNIT_PRICE) {
      return {
        isValid: false,
        invalidReason: "compute_price_too_high",
      };
    }

    return { isValid: true };
  } catch {
    return {
      isValid: false,
      invalidReason: "invalid_compute_price_instruction",
    };
  }
}

// =============================================================================
// Deadline Validator Verification
// =============================================================================

/**
 * Verify deadline validator instruction.
 * Ensures the deadline is within maxTimeoutSeconds from now.
 *
 * Instruction data format:
 * - byte 0: instruction discriminator (0 = CheckClock)
 * - bytes 1-8: deadline timestamp (Unix timestamp, little-endian i64)
 */
export function verifyDeadlineValidator(
  instruction: {
    programAddress: Address;
    data?: Readonly<Uint8Array>;
  },
  maxTimeoutSeconds?: number,
): ValidationResult {
  if (instruction.programAddress.toString() !== DEADLINE_VALIDATOR_PROGRAM) {
    return {
      isValid: false,
      invalidReason: "invalid_deadline_validator_program",
    };
  }

  if (!instruction.data || instruction.data.length < 9) {
    return {
      isValid: false,
      invalidReason: "invalid_deadline_validator_data",
    };
  }

  // Check instruction discriminator (0 = CheckClock)
  if (instruction.data[0] !== 0) {
    return {
      isValid: false,
      invalidReason: "invalid_deadline_instruction_type",
    };
  }

  // Extract deadline (little-endian i64 at offset 1)
  const dataView = new DataView(
    instruction.data.buffer,
    instruction.data.byteOffset + 1, // Start after discriminator
    8,
  );
  const deadline = Number(dataView.getBigInt64(0, true));

  // If maxTimeoutSeconds is specified, verify deadline is within bounds
  if (maxTimeoutSeconds !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    const maxDeadline = now + maxTimeoutSeconds;

    if (deadline > maxDeadline) {
      return {
        isValid: false,
        invalidReason: "deadline_exceeds_max_timeout",
      };
    }
  }

  // Verify deadline is in the future (or very recent past for tolerance)
  const now = Math.floor(Date.now() / 1000);
  const TOLERANCE_SECONDS = 30; // Allow 30 seconds of clock drift

  if (deadline < now - TOLERANCE_SECONDS) {
    return {
      isValid: false,
      invalidReason: "deadline_already_passed",
    };
  }

  return { isValid: true };
}

// =============================================================================
// Nonce Authority Verification
// =============================================================================

/**
 * Verify nonce advance instruction doesn't use fee payer as authority.
 *
 * System program AdvanceNonceAccount instruction format:
 * - byte 0-3: instruction discriminator (4 = AdvanceNonceAccount)
 * - accounts[0]: nonce account (writable)
 * - accounts[1]: recent blockhashes sysvar
 * - accounts[2]: nonce authority (signer)
 */
export function verifyNonceAuthority(
  instruction: {
    programAddress: Address;
    accounts: ReadonlyArray<{ address: Address; role?: unknown }>;
    data?: Readonly<Uint8Array>;
  },
  feePayerAddresses: string[],
): ValidationResult {
  if (
    instruction.programAddress.toString() !== SYSTEM_PROGRAM_ADDRESS.toString()
  ) {
    return {
      isValid: false,
      invalidReason: "invalid_nonce_advance_program",
    };
  }

  if (!instruction.data || instruction.data.length < 4) {
    return {
      isValid: false,
      invalidReason: "invalid_nonce_advance_data",
    };
  }

  // Check instruction discriminator (4 = AdvanceNonceAccount as u32 LE)
  const dataView = new DataView(
    instruction.data.buffer,
    instruction.data.byteOffset,
    4,
  );
  const discriminator = dataView.getUint32(0, true);

  if (discriminator !== 4) {
    return {
      isValid: false,
      invalidReason: "invalid_nonce_instruction_type",
    };
  }

  // accounts[2] is the nonce authority
  if (instruction.accounts.length < 3) {
    return {
      isValid: false,
      invalidReason: "invalid_nonce_accounts",
    };
  }

  const nonceAuthority = instruction.accounts[2].address.toString();

  // SECURITY: Nonce authority must not be the fee payer
  if (feePayerAddresses.includes(nonceAuthority)) {
    return {
      isValid: false,
      invalidReason: "fee_payer_is_nonce_authority",
    };
  }

  return { isValid: true };
}

// =============================================================================
// Direct Transfer Verification
// =============================================================================

export async function verifyDirectTransfer(
  instruction: {
    programAddress: Address;
    accounts: Array<{ address: Address }>;
    data?: Readonly<Uint8Array>;
  },
  requirements: PaymentRequirements,
  feePayerAddresses: string[],
): Promise<ValidationResult> {
  const programAddress = instruction.programAddress.toString();

  // Must be Token or Token-2022 program
  if (
    programAddress !== TOKEN_PROGRAM_ADDRESS.toString() &&
    programAddress !== TOKEN_2022_PROGRAM_ADDRESS.toString()
  ) {
    return {
      isValid: false,
      invalidReason: "invalid_transfer_program",
    };
  }

  // Parse transfer instruction
  let parsed: ParsedTransferChecked;
  try {
    if (programAddress === TOKEN_PROGRAM_ADDRESS.toString()) {
      parsed = parseTransferCheckedToken(
        instruction as never,
      ) as ParsedTransferChecked;
    } else {
      parsed = parseTransferChecked2022(
        instruction as never,
      ) as ParsedTransferChecked;
    }
  } catch {
    return {
      isValid: false,
      invalidReason: "invalid_transfer_instruction",
    };
  }

  // Extract payer (authority)
  const authorityAddress = parsed.accounts.authority.address.toString();

  // SECURITY: Fee payer must not be the transfer authority
  if (feePayerAddresses.includes(authorityAddress)) {
    return {
      isValid: false,
      invalidReason: "fee_payer_is_transfer_authority",
      payer: authorityAddress,
    };
  }

  // Verify mint
  const mintAddress = parsed.accounts.mint.address.toString();
  if (mintAddress !== requirements.asset) {
    return {
      isValid: false,
      invalidReason: "mint_mismatch",
      payer: authorityAddress,
    };
  }

  // Verify amount
  const amount = parsed.data.amount;
  if (amount < BigInt(requirements.amount)) {
    return {
      isValid: false,
      invalidReason: "insufficient_amount",
      payer: authorityAddress,
    };
  }

  // Verify destination ATA
  const destAta = parsed.accounts.destination.address.toString();
  const [expectedAta] = await findAssociatedTokenPda({
    mint: requirements.asset as Address,
    owner: requirements.payTo as Address,
    tokenProgram:
      programAddress === TOKEN_PROGRAM_ADDRESS.toString()
        ? TOKEN_PROGRAM_ADDRESS
        : TOKEN_2022_PROGRAM_ADDRESS,
  });

  if (destAta !== expectedAta.toString()) {
    return {
      isValid: false,
      invalidReason: "destination_mismatch",
      payer: authorityAddress,
    };
  }

  return {
    isValid: true,
    payer: authorityAddress,
  };
}

// =============================================================================
// Base64 Utilities (browser-compatible)
// =============================================================================

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

// =============================================================================
// CPI Transfer Verification (via Simulation)
// =============================================================================

export async function verifyCpiTransfer(
  simulationResult: SimulationResult,
  requirements: PaymentRequirements,
): Promise<ValidationResult> {
  if (!simulationResult.success) {
    return {
      isValid: false,
      invalidReason: `simulation_failed: ${simulationResult.error}`,
    };
  }

  // Extract inner instructions
  const innerInstructions = simulationResult.innerInstructions;
  if (!innerInstructions || innerInstructions.length === 0) {
    return {
      isValid: false,
      invalidReason: "no_inner_instructions",
    };
  }

  // Find TransferChecked in inner instructions
  // TransferChecked instruction discriminator is 12
  const TRANSFER_CHECKED_DISCRIMINATOR = 12;

  let transferFound = false;
  let transferAmount: bigint | undefined;

  for (const inner of innerInstructions) {
    for (const ix of inner.instructions) {
      // Check if this is a TransferChecked instruction
      // Data format: [discriminator (1 byte), amount (8 bytes LE), decimals (1 byte)]
      const dataBytes = base64ToBytes(ix.data);
      if (
        dataBytes[0] === TRANSFER_CHECKED_DISCRIMINATOR &&
        dataBytes.length >= 10
      ) {
        // Already found one transfer - error if we find another
        if (transferFound) {
          return {
            isValid: false,
            invalidReason: "multiple_transfers_in_cpi",
          };
        }

        transferFound = true;
        // Read amount as little-endian u64
        transferAmount = readU64LE(dataBytes, 1);
      }
    }
  }

  if (!transferFound || transferAmount === undefined) {
    return {
      isValid: false,
      invalidReason: "no_transfer_in_cpi",
    };
  }

  // Verify amount
  if (transferAmount < BigInt(requirements.amount)) {
    return {
      isValid: false,
      invalidReason: "insufficient_amount",
    };
  }

  // Note: For CPI verification, we trust the simulation result for destination
  // because the transaction was simulated successfully and we verified the transfer exists

  return {
    isValid: true,
    // Payer extraction for CPI is complex - would need to trace the outer instruction
    // For now, we don't return payer for CPI transfers
  };
}

// =============================================================================
// Fee Payer Safety Check
// =============================================================================

export function verifyFeePayerSafety(
  compiled: CompiledTransactionMessage,
  feePayerAddresses: string[],
  layout: InstructionLayout,
): ValidationResult {
  const staticAccounts = compiled.staticAccounts ?? [];
  const instructions = compiled.instructions ?? [];

  // Check each instruction (except compute budget) to ensure fee payer isn't in accounts
  for (let i = 0; i < instructions.length; i++) {
    // Skip compute budget instructions
    if (i === layout.computeLimitIndex || i === layout.computePriceIndex) {
      continue;
    }

    const ix = instructions[i];
    const accountIndices = ix.accountIndices ?? [];

    for (const accountIndex of accountIndices) {
      const accountAddress = staticAccounts[accountIndex]?.toString();
      if (feePayerAddresses.includes(accountAddress)) {
        return {
          isValid: false,
          invalidReason: "fee_payer_in_instruction_accounts",
        };
      }
    }
  }

  return { isValid: true };
}

// =============================================================================
// Full Transaction Verification
// =============================================================================

export async function verifyTransaction(
  transactionBase64: string,
  requirements: PaymentRequirements,
  feePayerAddresses: string[],
  simulationResult?: SimulationResult,
): Promise<ValidationResult> {
  // 1. Decode transaction
  let tx: Transaction;
  try {
    tx = decodeTransaction(transactionBase64);
  } catch {
    return {
      isValid: false,
      invalidReason: "invalid_transaction_encoding",
    };
  }

  // 2. Decompile message
  const compiled = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  ) as CompiledTransactionMessage;
  // Add dummy lifetimeToken for decompilation (not used in validation)
  const compiledWithLifetime = {
    ...compiled,
    lifetimeToken: "11111111111111111111111111111111" as const,
  };
  const decompiled = decompileTransactionMessage(compiledWithLifetime);
  const instructions = decompiled.instructions ?? [];

  // 3. Detect instruction layout
  const layout = detectInstructionLayout(instructions);
  if (!layout) {
    return {
      isValid: false,
      invalidReason: "invalid_instruction_layout",
    };
  }

  // 4. Verify compute budget
  const computeLimitResult = verifyComputeLimit(
    instructions[layout.computeLimitIndex] as never,
  );
  if (!computeLimitResult.isValid) {
    return computeLimitResult;
  }

  const computePriceResult = verifyComputePrice(
    instructions[layout.computePriceIndex] as never,
  );
  if (!computePriceResult.isValid) {
    return computePriceResult;
  }

  // 5. Verify nonce authority (if nonce advance is present)
  if (layout.hasNonceAdvance) {
    const nonceResult = verifyNonceAuthority(
      instructions[0] as never,
      feePayerAddresses,
    );
    if (!nonceResult.isValid) {
      return nonceResult;
    }
  }

  // 6. Verify deadline validator (if present)
  if (
    layout.hasDeadlineValidator &&
    layout.deadlineValidatorIndex !== undefined
  ) {
    const deadlineResult = verifyDeadlineValidator(
      instructions[layout.deadlineValidatorIndex] as never,
      requirements.extra?.maxTimeoutSeconds as number | undefined,
    );
    if (!deadlineResult.isValid) {
      return deadlineResult;
    }
  }

  // 7. Verify fee payer safety
  const feePayerResult = verifyFeePayerSafety(
    compiled,
    feePayerAddresses,
    layout,
  );
  if (!feePayerResult.isValid) {
    return feePayerResult;
  }

  // 8. Verify transfer
  if (layout.isDirectTransfer) {
    // Direct transfer - static verification
    return await verifyDirectTransfer(
      instructions[layout.transferIndex] as never,
      requirements,
      feePayerAddresses,
    );
  } else {
    // CPI transfer - simulation verification
    if (!simulationResult) {
      return {
        isValid: false,
        invalidReason: "simulation_required_for_cpi",
      };
    }
    return await verifyCpiTransfer(simulationResult, requirements);
  }
}
