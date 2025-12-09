/**
 * Squads Smart Account integration for Cascade Tabs.
 *
 * This is a thin app-specific layer on top of @cascade-fyi/tabs-sdk.
 * Contains USDC constants, API key encoding, transaction builders, and UX helpers.
 */

import {
  type Address,
  type Instruction,
  type TransactionSigner,
  type Rpc,
  type SolanaRpcApi,
  type Signature,
  type Commitment,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  // Generated instructions
  SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
  getUseSpendingLimitInstruction,
  getExecuteTransactionSyncInstruction,
  fetchProgramConfig,
  type SmartAccountSigner,
  // Generated errors
  getSquadsSmartAccountProgramErrorMessage,
  type SquadsSmartAccountProgramError,
  // SDK helpers
  deriveProgramConfig,
  compileToSynchronousMessage,
  type SyncAccountMeta,
  // SDK constants
  PERMISSION_OWNER,
  // SDK discovery
  fetchSmartAccountStateByOwner as sdkFetchSmartAccountStateByOwner,
  type SmartAccountState,
  // SDK instruction builders
  buildCreateSmartAccountInstruction,
} from "@cascade-fyi/tabs-sdk";
import {
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// =============================================================================
// Re-exports from SDK
// =============================================================================

export type { SmartAccountState } from "@cascade-fyi/tabs-sdk";

// Re-export SDK instruction builders and types for direct use
export {
  buildAddSpendingLimitInstruction,
  buildRemoveSpendingLimitInstruction,
  Period,
} from "@cascade-fyi/tabs-sdk";

// =============================================================================
// App-specific Constants
// =============================================================================

/** USDC mint on Solana mainnet */
export const USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;

/** USDC decimals */
export const USDC_DECIMALS = 6;

/** Executor pubkey - the Tabs facilitator that can execute spending limit txs */
export const EXECUTOR_PUBKEY =
  "CMdouXzA7neGHzUcX5ZwKrceqhQK6duTpLA56cwZfVF6" as Address;

/** Program ID (re-exported for convenience) */
export const PROGRAM_ID = SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS;

// =============================================================================
// Account Discovery (App-specific wrappers)
// =============================================================================

/**
 * Fetch smart account state by owner address.
 * Uses app-specific USDC_MINT and EXECUTOR_PUBKEY.
 */
export async function fetchSmartAccountStateByOwner(
  rpc: Rpc<SolanaRpcApi>,
  ownerAddress: Address,
): Promise<SmartAccountState | null> {
  return sdkFetchSmartAccountStateByOwner(
    rpc,
    ownerAddress,
    EXECUTOR_PUBKEY || undefined,
    USDC_MINT,
  );
}

// =============================================================================
// API Key Encoding (App-specific)
// =============================================================================

export interface ApiKeyPayload {
  /** Smart account settings PDA */
  settingsPda: string;
  /** Spending limit PDA */
  spendingLimitPda: string;
  /** Per-transaction max in USDC base units */
  perTxMax: bigint;
  /** Version for future compatibility */
  version: number;
}

const API_KEY_PREFIX = "tabs_";
const API_KEY_VERSION = 1;

/**
 * Encode smart account info into an API key.
 * Format: tabs_<base64url(json)>
 */
export function encodeApiKey(payload: Omit<ApiKeyPayload, "version">): string {
  const fullPayload: ApiKeyPayload = {
    ...payload,
    perTxMax: payload.perTxMax,
    version: API_KEY_VERSION,
  };

  // Convert bigint to string for JSON serialization
  const serializable = {
    ...fullPayload,
    perTxMax: fullPayload.perTxMax.toString(),
  };

  const json = JSON.stringify(serializable);
  const base64 = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${API_KEY_PREFIX}${base64}`;
}

/**
 * Decode an API key back to payload.
 * Returns null if invalid.
 */
export function decodeApiKey(key: string): ApiKeyPayload | null {
  if (!key.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  try {
    const base64 = key
      .slice(API_KEY_PREFIX.length)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const json = atob(base64);
    const parsed = JSON.parse(json);

    return {
      settingsPda: parsed.settingsPda,
      spendingLimitPda: parsed.spendingLimitPda,
      perTxMax: BigInt(parsed.perTxMax),
      version: parsed.version,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format USDC amount from base units to display string.
 */
export function formatUsdc(amount: bigint): string {
  const whole = amount / BigInt(10 ** USDC_DECIMALS);
  const fraction = amount % BigInt(10 ** USDC_DECIMALS);
  const fractionStr = fraction.toString().padStart(USDC_DECIMALS, "0");
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fractionStr.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

/**
 * Parse USDC display string to base units.
 */
export function parseUsdc(display: string): bigint {
  const [whole, fraction = ""] = display.split(".");
  const paddedFraction = fraction
    .slice(0, USDC_DECIMALS)
    .padEnd(USDC_DECIMALS, "0");
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(paddedFraction);
}

// =============================================================================
// Account Role Helpers
// =============================================================================

/** Account role values for instruction accounts */
const AccountRole = {
  READONLY: 0,
  WRITABLE: 1,
  READONLY_SIGNER: 2,
  WRITABLE_SIGNER: 3,
} as const;

/**
 * Determine account role from account metadata.
 * Handles various account meta formats from different Solana libraries.
 */
function getAccountRole(acc: {
  isSigner?: boolean;
  isWritable?: boolean;
  role?: number;
}): number {
  // If role is already specified, use it
  if (typeof acc.role === "number") {
    return acc.role;
  }
  // Otherwise derive from flags
  const isSigner = acc.isSigner ?? false;
  const isWritable = acc.isWritable ?? false;
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

/**
 * Extract address from account meta (handles different formats).
 */
function getAccountAddress(acc: {
  address?: Address;
  pubkey?: Address;
}): Address {
  const addr = acc.address ?? acc.pubkey;
  if (!addr) throw new Error("Account meta must have address or pubkey");
  return addr;
}

// =============================================================================
// Transaction Confirmation
// =============================================================================

const CONFIRMATION_POLL_INTERVAL_MS = 500;
const MAX_CONFIRMATION_ATTEMPTS = 60; // 30 seconds max

/** Commitment level ordering for comparison */
const COMMITMENT_LEVELS: Record<string, number> = {
  processed: 0,
  confirmed: 1,
  finalized: 2,
};

/**
 * Check if actual commitment meets or exceeds required commitment.
 * e.g., "finalized" meets "confirmed", but "confirmed" doesn't meet "finalized"
 */
function meetsCommitment(actual: string, required: Commitment): boolean {
  const actualLevel = COMMITMENT_LEVELS[actual] ?? -1;
  const requiredLevel = COMMITMENT_LEVELS[required] ?? 1;
  return actualLevel >= requiredLevel;
}

/**
 * Poll for transaction confirmation.
 * Framework-kit's prepareAndSend doesn't wait for confirmation.
 */
export async function waitForConfirmation(
  rpc: Rpc<SolanaRpcApi>,
  signature: Signature,
  commitment: Commitment = "confirmed",
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CONFIRMATION_ATTEMPTS; attempt++) {
    const response = await rpc.getSignatureStatuses([signature]).send();

    const status = response.value[0];
    if (status !== null) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      // Check if confirmation level is met
      // Levels are ordered: processed (0) < confirmed (1) < finalized (2)
      const confirmationStatus = status.confirmationStatus;
      if (
        confirmationStatus &&
        meetsCommitment(confirmationStatus, commitment)
      ) {
        return;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS),
    );
  }

  throw new Error("Transaction confirmation timeout");
}

// =============================================================================
// Transaction Simulation
// =============================================================================

export interface SimulationResult {
  success: boolean;
  error?: string;
  logs?: string[];
}

/**
 * Simulate a transaction before signing to catch errors early.
 * This prevents the wallet popup from appearing for transactions that will fail.
 */
export async function simulateTransaction(
  rpc: Rpc<SolanaRpcApi>,
  instructions: Instruction[],
  payer: Address,
): Promise<SimulationResult> {
  try {
    // Get recent blockhash
    const { value: blockhash } = await rpc.getLatestBlockhash().send();

    // Build transaction message using pipe (idiomatic @solana/kit pattern)
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(blockhash, msg),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    // Compile to wire format
    const tx = compileTransaction(message);

    // Encode full transaction (with signatures prefix) to base64
    const txBase64 = getBase64EncodedWireTransaction(tx);

    // Simulate (skip signature verification since we haven't signed)
    const result = await rpc
      .simulateTransaction(txBase64, {
        sigVerify: false,
        commitment: "confirmed",
        encoding: "base64",
      })
      .send();

    if (result.value.err) {
      return {
        success: false,
        error: parseSimulationError(result.value.err, result.value.logs ?? []),
        logs: result.value.logs ?? undefined,
      };
    }

    return { success: true, logs: result.value.logs ?? undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Simulation failed",
    };
  }
}

/**
 * Parse simulation error into user-friendly message.
 */
function parseSimulationError(err: unknown, logs: readonly string[]): string {
  // Check logs for common error patterns
  const logStr = logs.join("\n");

  if (
    logStr.includes("insufficient funds") ||
    logStr.includes("insufficient lamports")
  ) {
    return "Insufficient SOL for transaction fees";
  }

  if (logStr.includes("Error: insufficient funds")) {
    return "Insufficient token balance";
  }

  if (logStr.includes("owner does not match")) {
    return "Token account ownership mismatch";
  }

  if (logStr.includes("Account not found")) {
    return "Required account does not exist";
  }

  // Extract custom program error from logs
  const customErrorMatch = logStr.match(
    /Custom program error: (0x[0-9a-fA-F]+)/,
  );
  if (customErrorMatch) {
    const errorCode = Number.parseInt(customErrorMatch[1], 16);
    const message = getSquadsSmartAccountProgramErrorMessage(
      errorCode as SquadsSmartAccountProgramError,
    );
    if (message) {
      return message;
    }
  }

  // Parse InstructionError JSON structure: {"InstructionError":["0",{"Custom":"6024"}]}
  if (typeof err === "object" && err !== null && "InstructionError" in err) {
    const instructionError = (err as { InstructionError: unknown[] })
      .InstructionError;
    if (Array.isArray(instructionError) && instructionError.length >= 2) {
      const errorDetail = instructionError[1];
      if (
        typeof errorDetail === "object" &&
        errorDetail !== null &&
        "Custom" in errorDetail
      ) {
        const customCode = (errorDetail as { Custom: string | number }).Custom;
        const errorCode =
          typeof customCode === "string"
            ? Number.parseInt(customCode, 10)
            : customCode;
        const message = getSquadsSmartAccountProgramErrorMessage(
          errorCode as SquadsSmartAccountProgramError,
        );
        if (message) {
          return message;
        }
        return `Program error code: ${errorCode}`;
      }
    }
  }

  // Fall back to JSON representation
  return `Transaction failed: ${JSON.stringify(err)}`;
}

// =============================================================================
// Transaction Builders
// =============================================================================

/**
 * Get the next available account index from ProgramConfig.
 */
export async function getNextAccountIndex(
  rpc: Parameters<typeof fetchProgramConfig>[0],
): Promise<bigint> {
  const programConfigPda = await deriveProgramConfig();
  const programConfig = await fetchProgramConfig(rpc, programConfigPda);
  return programConfig.data.smartAccountIndex + 1n;
}

/**
 * Build instruction to create a new Smart Account.
 * Fetches program config and uses SDK's instruction builder.
 */
export async function buildCreateAccountInstruction(
  rpc: Parameters<typeof fetchProgramConfig>[0],
  creatorAddress: Address,
  accountIndex: bigint,
): Promise<{
  instruction: Instruction;
  settingsAddress: Address;
  vaultAddress: Address;
}> {
  const programConfigPda = await deriveProgramConfig();
  const programConfig = await fetchProgramConfig(rpc, programConfigPda);

  // Owner signer with standard permissions (INITIATE | VOTE | EXECUTE)
  const ownerSigner: SmartAccountSigner = {
    key: creatorAddress,
    permissions: { mask: PERMISSION_OWNER },
  };

  return buildCreateSmartAccountInstruction(accountIndex, {
    programConfigAddress: programConfigPda,
    treasuryAddress: programConfig.data.treasury,
    creatorAddress,
    settingsAuthority: creatorAddress,
    threshold: 1,
    signers: [ownerSigner],
    timeLock: 0,
    rentCollector: creatorAddress,
  });
}

/**
 * Build instruction to use a spending limit (transfer from vault).
 */
export function buildUseSpendingLimitInstruction(
  settingsAddress: Address,
  signer: TransactionSigner,
  spendingLimitAddress: Address,
  smartAccountAddress: Address,
  mint: Address,
  smartAccountTokenAccount: Address,
  destination: Address,
  destinationTokenAccount: Address,
  amount: bigint,
  decimals: number = USDC_DECIMALS,
): Instruction {
  return getUseSpendingLimitInstruction({
    settings: settingsAddress,
    signer,
    spendingLimit: spendingLimitAddress,
    smartAccount: smartAccountAddress,
    destination,
    mint,
    smartAccountTokenAccount,
    destinationTokenAccount,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
    program: PROGRAM_ID,
    amount,
    decimals,
    memo: null,
  });
}

// =============================================================================
// Withdrawal
// =============================================================================

/**
 * Build instruction to withdraw USDC from the vault using executeTransactionSync.
 *
 * This wraps an SPL transfer instruction and executes it synchronously
 * through the smart account. Works for controlled accounts (owner = settingsAuthority).
 */
export async function buildWithdrawInstruction(
  settingsAddress: Address,
  vaultAddress: Address,
  vaultAtaAddress: Address,
  ownerAddress: Address,
  destinationAtaAddress: Address,
  amount: bigint,
): Promise<Instruction> {
  // Build inner SPL transfer instruction (vault ATA → owner ATA)
  // The vault PDA will sign this via CPI
  const transferIx = getTransferCheckedInstruction({
    source: vaultAtaAddress,
    mint: USDC_MINT,
    destination: destinationAtaAddress,
    authority: vaultAddress, // Vault PDA signs via CPI
    amount,
    decimals: USDC_DECIMALS,
  });

  // Convert @solana-program/token instruction format to our internal format
  const innerInstruction = {
    programAddress: TOKEN_PROGRAM_ADDRESS,
    accounts: transferIx.accounts.map((acc) => ({
      address: getAccountAddress(
        acc as { address?: Address; pubkey?: Address },
      ),
      role: getAccountRole(acc as { isSigner?: boolean; isWritable?: boolean }),
    })),
    // Copy to mutable Uint8Array (transferIx.data is ReadonlyUint8Array)
    data: new Uint8Array(transferIx.data),
  };

  // Compile to sync message format
  const { instructions: serializedIx, accounts } = compileToSynchronousMessage(
    vaultAddress,
    [ownerAddress], // Owner is the signer
    [innerInstruction],
  );

  // Build executeTransactionSync instruction with remaining accounts
  const syncIx = getExecuteTransactionSyncInstruction({
    settings: settingsAddress,
    program: PROGRAM_ID,
    accountIndex: 0, // Vault index
    numSigners: 1,
    instructions: serializedIx,
  });

  // Add remaining accounts to the instruction
  const accountMetas = accounts.map((acc: SyncAccountMeta) => ({
    address: acc.pubkey,
    role: getAccountRole(acc),
  }));

  return {
    ...syncIx,
    accounts: [...syncIx.accounts, ...accountMetas],
  } as Instruction;
}
