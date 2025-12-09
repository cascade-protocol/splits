/**
 * Instruction builders for Cascade Splits
 *
 * Thin wrappers over generated code that add:
 * - Share (1-100) to percentageBps conversion
 * - SplitConfig-centric API (user provides splitConfig, vault is derived)
 * - Convenience return values (addresses on create)
 */

import type { Address, Instruction, Rpc, SolanaRpcApi } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { PROGRAM_ID, USDC_MINT } from "./constants.js";
import { type Recipient, toPercentageBps } from "./recipients.js";
import {
  getCreateSplitConfigInstructionDataEncoder,
  getExecuteSplitInstructionDataEncoder,
  getUpdateSplitConfigInstructionDataEncoder,
  getCloseSplitConfigInstructionDataEncoder,
} from "./generated/instructions/index.js";
import {
  getSplitConfig,
  getProtocolConfig,
  deriveSplitConfig,
  deriveAta,
  deriveVault,
  generateUniqueId,
  detectTokenProgram,
  type SplitConfig,
} from "./helpers.js";

// =============================================================================
// Account Roles (for manual instruction building)
// =============================================================================

const WRITABLE_SIGNER = 3;
const SIGNER = 2;
const WRITABLE = 1;
const READONLY = 0;

// =============================================================================
// Helpers
// =============================================================================

/** Convert SDK recipients to on-chain format */
function toOnChainRecipients(
  recipients: Recipient[],
): Array<{ address: Address; percentageBps: number }> {
  return recipients.map((r) => ({
    address: r.address as Address,
    percentageBps: toPercentageBps(r),
  }));
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of createSplitConfig
 */
export interface CreateSplitConfigResult {
  /** The instruction to send */
  instruction: Instruction;
  /**
   * The split configuration PDA address.
   *
   * **For x402 integration:** Use this as your `payTo` address.
   * Facilitators automatically derive the vault ATA from this.
   */
  splitConfig: Address;
  /**
   * The vault ATA address where funds are held.
   *
   * **⚠️ WARNING:** Do NOT use this as x402 `payTo`.
   * Using vault as payTo creates a nested ATA (funds unrecoverable).
   * This is for direct transfers and internal use only.
   */
  vault: Address;
}

/**
 * Result of executeSplit - discriminated union for type-safe handling
 */
export type ExecuteSplitResult =
  | { status: "success"; instruction: Instruction }
  | { status: "not_found"; splitConfig: Address }
  | { status: "not_a_split"; splitConfig: Address };

// =============================================================================
// Create Split Config
// =============================================================================

/**
 * Build instruction to create a new split configuration.
 *
 * @example
 * ```typescript
 * const { instruction, splitConfig } = await createSplitConfig({
 *   authority: myWallet,
 *   recipients: [
 *     { address: alice, share: 60 },
 *     { address: bob, share: 40 },
 *   ],
 * });
 * // Use splitConfig as your x402 payTo address
 * ```
 */
export async function createSplitConfig(params: {
  /** Authority that will control this split */
  authority: Address;
  /** Recipients with share (1-100) or percentageBps (1-9900) */
  recipients: Recipient[];
  /** Token mint (defaults to USDC) */
  mint?: Address;
  /** Unique ID (auto-generated if not provided) */
  uniqueId?: Address;
  /** Token program (defaults to SPL Token) */
  tokenProgram?: Address;
  /** Payer for rent (defaults to authority) */
  payer?: Address;
}): Promise<CreateSplitConfigResult> {
  const {
    authority,
    recipients,
    mint = USDC_MINT,
    uniqueId = generateUniqueId(),
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    payer = authority,
  } = params;

  const onChainRecipients = toOnChainRecipients(recipients);

  // Derive addresses
  const splitConfig = await deriveSplitConfig(authority, mint, uniqueId);
  const vault = await deriveVault(splitConfig, mint, tokenProgram);

  // Derive recipient ATAs (required for validation in remaining accounts)
  const recipientAtas = await Promise.all(
    onChainRecipients.map((r) => deriveAta(r.address, mint, tokenProgram)),
  );

  // Encode instruction data
  const data = getCreateSplitConfigInstructionDataEncoder().encode({
    mint,
    recipients: onChainRecipients,
  });

  const instruction: Instruction = {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: splitConfig, role: WRITABLE },
      { address: uniqueId, role: READONLY },
      { address: authority, role: SIGNER },
      { address: payer, role: WRITABLE_SIGNER },
      { address: mint, role: READONLY },
      { address: vault, role: WRITABLE },
      { address: tokenProgram, role: READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: READONLY },
      // Remaining accounts: recipient ATAs for validation
      ...recipientAtas.map((ata) => ({ address: ata, role: READONLY })),
    ],
    data,
  };

  return { instruction, splitConfig, vault };
}

// =============================================================================
// Execute Split
// =============================================================================

/**
 * Build instruction to execute a split (distribute vault balance).
 *
 * @example
 * ```typescript
 * const result = await executeSplit({
 *   rpc,
 *   splitConfig,
 *   executor: wallet.address,
 * });
 * if (result.status === "success") {
 *   await sendTransaction(result.instruction);
 * }
 * ```
 */
export async function executeSplit(input: {
  /** RPC client */
  rpc: Rpc<SolanaRpcApi>;
  /** SplitConfig PDA address */
  splitConfig: Address;
  /** Executor address (pays for transaction) */
  executor: Address;
  /** Token program (auto-detected if not provided) */
  tokenProgram?: Address;
}): Promise<ExecuteSplitResult> {
  const { rpc, splitConfig: splitConfigAddress, executor } = input;

  // Fetch split config
  let config: SplitConfig;
  try {
    config = await getSplitConfig(rpc, splitConfigAddress);
  } catch {
    return { status: "not_found", splitConfig: splitConfigAddress };
  }

  // Auto-detect token program if not provided
  const tokenProgram =
    input.tokenProgram ?? (await detectTokenProgram(rpc, config.mint));

  // Fetch protocol config for fee wallet
  const protocolConfig = await getProtocolConfig(rpc);

  // Derive all ATAs: recipients + protocol (protocol MUST be last)
  const recipientAtas = await Promise.all(
    config.recipients.map((r) =>
      deriveAta(r.address, config.mint, tokenProgram),
    ),
  );
  const protocolAta = await deriveAta(
    protocolConfig.feeWallet,
    config.mint,
    tokenProgram,
  );

  // Encode instruction data
  const data = getExecuteSplitInstructionDataEncoder().encode({});

  const instruction: Instruction = {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: config.address, role: WRITABLE },
      { address: config.vault, role: WRITABLE },
      { address: config.mint, role: READONLY },
      { address: protocolConfig.address, role: READONLY },
      { address: executor, role: READONLY },
      { address: tokenProgram, role: READONLY },
      // Remaining accounts: recipient ATAs + protocol ATA (last)
      ...recipientAtas.map((ata) => ({ address: ata, role: WRITABLE })),
      { address: protocolAta, role: WRITABLE },
    ],
    data,
  };

  return { status: "success", instruction };
}

// =============================================================================
// Update Split Config
// =============================================================================

/**
 * Build instruction to update split recipients.
 *
 * @example
 * ```typescript
 * const instruction = await updateSplitConfig({
 *   rpc,
 *   splitConfig,
 *   authority: myWallet,
 *   recipients: [{ address: newRecipient, share: 100 }],
 * });
 * ```
 */
export async function updateSplitConfig(input: {
  /** RPC client */
  rpc: Rpc<SolanaRpcApi>;
  /** SplitConfig PDA address */
  splitConfig: Address;
  /** Authority (must be signer) */
  authority: Address;
  /** New recipients with share (1-100) or percentageBps (1-9900) */
  recipients: Recipient[];
  /** Token program (auto-detected if not provided) */
  tokenProgram?: Address;
}): Promise<Instruction> {
  const { rpc, splitConfig: splitConfigAddress, authority, recipients } = input;

  // Fetch existing config
  const config = await getSplitConfig(rpc, splitConfigAddress);

  // Auto-detect token program if not provided
  const tokenProgram =
    input.tokenProgram ?? (await detectTokenProgram(rpc, config.mint));

  const onChainRecipients = toOnChainRecipients(recipients);

  // Derive ATAs for new recipients (for validation)
  const recipientAtas = await Promise.all(
    onChainRecipients.map((r) =>
      deriveAta(r.address, config.mint, tokenProgram),
    ),
  );

  // Encode instruction data
  const data = getUpdateSplitConfigInstructionDataEncoder().encode({
    newRecipients: onChainRecipients,
  });

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: config.address, role: WRITABLE },
      { address: config.vault, role: READONLY },
      { address: config.mint, role: READONLY },
      { address: authority, role: SIGNER },
      { address: tokenProgram, role: READONLY },
      // Remaining accounts: recipient ATAs for validation
      ...recipientAtas.map((ata) => ({ address: ata, role: READONLY })),
    ],
    data,
  };
}

// =============================================================================
// Close Split Config
// =============================================================================

/**
 * Build instruction to close a split and recover rent.
 *
 * @example
 * ```typescript
 * const instruction = await closeSplitConfig({
 *   rpc,
 *   splitConfig,
 *   authority: myWallet,
 * });
 * ```
 */
export async function closeSplitConfig(input: {
  /** RPC client */
  rpc: Rpc<SolanaRpcApi>;
  /** SplitConfig PDA address */
  splitConfig: Address;
  /** Authority (must be signer) */
  authority: Address;
  /** Rent receiver (defaults to authority) */
  rentReceiver?: Address;
  /** Token program (auto-detected if not provided) */
  tokenProgram?: Address;
}): Promise<Instruction> {
  const { rpc, splitConfig: splitConfigAddress, authority } = input;
  const rentReceiver = input.rentReceiver ?? authority;

  // Fetch existing config
  const config = await getSplitConfig(rpc, splitConfigAddress);

  // Auto-detect token program if not provided
  const tokenProgram =
    input.tokenProgram ?? (await detectTokenProgram(rpc, config.mint));

  // Encode instruction data
  const data = getCloseSplitConfigInstructionDataEncoder().encode({});

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: config.address, role: WRITABLE },
      { address: config.vault, role: WRITABLE },
      { address: authority, role: SIGNER },
      { address: rentReceiver, role: WRITABLE },
      { address: tokenProgram, role: READONLY },
    ],
    data,
  };
}
