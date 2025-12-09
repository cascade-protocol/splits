/**
 * Helper utilities for Squads Smart Account SDK.
 *
 * PDA derivation, sync message compilation, and common utilities.
 */

import {
  type Address,
  type Instruction,
  getProgramDerivedAddress,
  getAddressEncoder,
  getUtf8Encoder,
  getU128Encoder,
  getU8Encoder,
} from "@solana/kit";
import {
  SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
  getCreateSmartAccountInstruction,
  getAddSpendingLimitAsAuthorityInstruction,
  getRemoveSpendingLimitAsAuthorityInstruction,
  type SmartAccountSigner,
  type Period,
} from "./generated/index.js";
import {
  SEED_PREFIX,
  SEED_PROGRAM_CONFIG,
  SEED_SETTINGS,
  SEED_SMART_ACCOUNT,
  SEED_SPENDING_LIMIT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";

// =============================================================================
// Encoder instances (cached for performance)
// =============================================================================

const addressEncoder = getAddressEncoder();
const utf8Encoder = getUtf8Encoder();
const u128Encoder = getU128Encoder();
const u8Encoder = getU8Encoder();

// Pre-encoded seed bytes
const PREFIX_BYTES = utf8Encoder.encode(SEED_PREFIX);
const PROGRAM_CONFIG_BYTES = utf8Encoder.encode(SEED_PROGRAM_CONFIG);
const SETTINGS_BYTES = utf8Encoder.encode(SEED_SETTINGS);
const SMART_ACCOUNT_BYTES = utf8Encoder.encode(SEED_SMART_ACCOUNT);
const SPENDING_LIMIT_BYTES = utf8Encoder.encode(SEED_SPENDING_LIMIT);

// =============================================================================
// PDA Derivation
// =============================================================================

/**
 * Derive ProgramConfig PDA.
 *
 * Seeds: ["smart_account", "program_config"]
 */
export async function deriveProgramConfig(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    seeds: [PREFIX_BYTES, PROGRAM_CONFIG_BYTES],
  });
  return pda;
}

/**
 * Derive Settings PDA for a given account index.
 *
 * Seeds: ["smart_account", "settings", account_index (u128)]
 *
 * @param accountIndex - The account index from ProgramConfig
 */
export async function deriveSettings(accountIndex: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    seeds: [PREFIX_BYTES, SETTINGS_BYTES, u128Encoder.encode(accountIndex)],
  });
  return pda;
}

/**
 * Derive SmartAccount (vault) PDA.
 *
 * Seeds: ["smart_account", settings_pda, "smart_account", vault_index (u8)]
 *
 * @param settingsPda - The Settings PDA address
 * @param vaultIndex - Vault index (default 0)
 */
export async function deriveSmartAccount(
  settingsPda: Address,
  vaultIndex = 0,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    seeds: [
      PREFIX_BYTES,
      addressEncoder.encode(settingsPda),
      SMART_ACCOUNT_BYTES,
      u8Encoder.encode(vaultIndex),
    ],
  });
  return pda;
}

/**
 * Derive SpendingLimit PDA.
 *
 * Seeds: ["smart_account", settings_pda, "spending_limit", seed]
 *
 * @param settingsPda - The Settings PDA address
 * @param seed - Seed address (typically the executor pubkey)
 */
export async function deriveSpendingLimit(
  settingsPda: Address,
  seed: Address,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    seeds: [
      PREFIX_BYTES,
      addressEncoder.encode(settingsPda),
      SPENDING_LIMIT_BYTES,
      addressEncoder.encode(seed),
    ],
  });
  return pda;
}

/**
 * Derive an Associated Token Account address.
 *
 * @param owner - Owner of the ATA
 * @param mint - Token mint address
 * @param tokenProgram - Token program (default: SPL Token)
 */
export async function deriveAta(
  owner: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ID as Address,
): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(tokenProgram),
      addressEncoder.encode(mint),
    ],
  });
  return address;
}

// =============================================================================
// Synchronous Transaction Helpers
// =============================================================================

/**
 * Account metadata for sync transaction remaining accounts.
 */
export interface SyncAccountMeta {
  pubkey: Address;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * Result from compiling instructions for synchronous execution.
 */
export interface SyncMessageResult {
  /** Serialized instructions in SmallVec<u8, CompiledInstruction> format */
  instructions: Uint8Array;
  /** Remaining accounts for the outer instruction */
  accounts: SyncAccountMeta[];
}

/**
 * Serialize a compiled instruction in the SmallVec format expected by Squads.
 *
 * Format:
 * - u8: program_id_index
 * - SmallVec<u8, u8>: account_indexes (u8 length prefix + u8[] indices)
 * - SmallVec<u16, u8>: data (u16 LE length prefix + u8[] data)
 */
function serializeCompiledInstruction(
  programIdIndex: number,
  accountIndexes: number[],
  data: Uint8Array,
): Uint8Array {
  const size = 1 + 1 + accountIndexes.length + 2 + data.length;
  const buffer = new Uint8Array(size);
  let offset = 0;

  // Program ID index (u8)
  buffer[offset++] = programIdIndex;

  // Account indexes as SmallVec<u8, u8>
  buffer[offset++] = accountIndexes.length;
  for (const idx of accountIndexes) {
    buffer[offset++] = idx;
  }

  // Data as SmallVec<u16, u8> (little-endian u16 length prefix)
  const dataView = new DataView(buffer.buffer);
  dataView.setUint16(offset, data.length, true);
  offset += 2;
  buffer.set(data, offset);

  return buffer;
}

/**
 * Compile instructions for synchronous execution through a smart account.
 *
 * This is ported from the Squads SDK's compileToSynchronousMessage utility.
 * It serializes inner instructions into the format expected by executeTransactionSync.
 *
 * @param vaultPda - The vault PDA that will sign the inner instructions via CPI
 * @param members - Signers for the outer instruction (typically just the owner)
 * @param instructions - Inner instructions to execute (e.g., SPL transfer)
 *
 * @example
 * ```typescript
 * // Build an SPL transfer to be executed via the smart account
 * const transferIx = getTransferCheckedInstruction({
 *   source: vaultAta,
 *   mint: USDC_MINT,
 *   destination: userAta,
 *   authority: vaultPda, // Vault signs via CPI
 *   amount: 1_000_000n,
 *   decimals: 6,
 * });
 *
 * const { instructions, accounts } = compileToSynchronousMessage(
 *   vaultPda,
 *   [ownerAddress],
 *   [{ programAddress: TOKEN_PROGRAM, accounts: [...], data: transferIx.data }]
 * );
 *
 * // Pass to executeTransactionSync
 * const syncIx = getExecuteTransactionSyncInstruction({
 *   settings: settingsAddress,
 *   accountIndex: 0,
 *   numSigners: 1,
 *   instructions,
 * });
 * // Add remaining accounts...
 * ```
 */
export function compileToSynchronousMessage(
  vaultPda: Address,
  members: Address[],
  instructions: Array<{
    programAddress: Address;
    accounts: Array<{ address: Address; role: number }>; // role: 0=readonly, 1=writable, 2=signer, 3=writable+signer
    data: Uint8Array;
  }>,
): SyncMessageResult {
  // Build unique account list: signers first, then instruction accounts
  const accountMap = new Map<string, SyncAccountMeta>();

  // Add signers first (they go at the beginning of remaining_accounts)
  for (const member of members) {
    accountMap.set(member, {
      pubkey: member,
      isSigner: true,
      isWritable: false,
    });
  }

  // Collect all accounts from instructions
  for (const ix of instructions) {
    // Add program ID
    if (!accountMap.has(ix.programAddress)) {
      accountMap.set(ix.programAddress, {
        pubkey: ix.programAddress,
        isSigner: false,
        isWritable: false,
      });
    }

    // Add instruction accounts
    for (const acc of ix.accounts) {
      const existing = accountMap.get(acc.address);
      const isWritable = acc.role === 1 || acc.role === 3;
      const isSigner = acc.role === 2 || acc.role === 3;

      if (existing) {
        // Merge: writable wins, signer wins (but vault shouldn't be signer)
        if (acc.address !== vaultPda) {
          existing.isWritable = existing.isWritable || isWritable;
          existing.isSigner = existing.isSigner || isSigner;
        } else {
          // Vault is never a signer in remaining_accounts (it signs via CPI)
          existing.isWritable = existing.isWritable || isWritable;
        }
      } else {
        accountMap.set(acc.address, {
          pubkey: acc.address,
          isSigner: acc.address !== vaultPda && isSigner,
          isWritable,
        });
      }
    }
  }

  // Convert to array (signers first, then others)
  const remainingAccounts: SyncAccountMeta[] = [];
  const signerAccounts: SyncAccountMeta[] = [];
  const nonSignerAccounts: SyncAccountMeta[] = [];

  for (const acc of accountMap.values()) {
    if (members.includes(acc.pubkey)) {
      signerAccounts.push(acc);
    } else {
      nonSignerAccounts.push(acc);
    }
  }

  remainingAccounts.push(...signerAccounts, ...nonSignerAccounts);

  // Create pubkey to index mapping
  const pubkeyToIndex = new Map<string, number>();
  remainingAccounts.forEach((acc, idx) => {
    pubkeyToIndex.set(acc.pubkey, idx);
  });

  // Serialize instructions
  // Format: [num_instructions: u8][...compiled instructions]
  const serializedInstructions: Uint8Array[] = [];

  // Length prefix
  serializedInstructions.push(new Uint8Array([instructions.length]));

  // Serialize each instruction
  for (const ix of instructions) {
    const programIdIndex = pubkeyToIndex.get(ix.programAddress);
    if (programIdIndex === undefined) {
      throw new Error(`Program ${ix.programAddress} not found in accounts`);
    }

    const accountIndexes = ix.accounts.map((acc) => {
      const idx = pubkeyToIndex.get(acc.address);
      if (idx === undefined) {
        throw new Error(`Account ${acc.address} not found in accounts`);
      }
      return idx;
    });

    serializedInstructions.push(
      serializeCompiledInstruction(programIdIndex, accountIndexes, ix.data),
    );
  }

  // Concatenate all serialized parts
  const totalLength = serializedInstructions.reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of serializedInstructions) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return {
    instructions: result,
    accounts: remainingAccounts,
  };
}

// =============================================================================
// Common Utilities
// =============================================================================

/** Decode base64 string to Uint8Array (browser-native) */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Read little-endian u64 from Uint8Array at offset */
export function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true);
}

// =============================================================================
// Instruction Builders (Address-accepting wrappers)
// =============================================================================

/** Account role constants */
const AccountRole = {
  READONLY: 0,
  WRITABLE: 1,
} as const;

/**
 * Input for buildCreateSmartAccountInstruction.
 * Uses Address instead of TransactionSigner for external signing support.
 */
export interface CreateSmartAccountInput {
  /** ProgramConfig PDA address */
  programConfigAddress: Address;
  /** Treasury address from ProgramConfig */
  treasuryAddress: Address;
  /** Creator/payer address (will sign externally) */
  creatorAddress: Address;
  /** Settings authority address */
  settingsAuthority: Address;
  /** Approval threshold (typically 1 for single-owner) */
  threshold: number;
  /** Signers with permissions */
  signers: SmartAccountSigner[];
  /** Time lock in seconds (0 for none) */
  timeLock: number;
  /** Rent collector address (typically same as creator) */
  rentCollector: Address;
  /** Optional memo for indexing */
  memo?: string | null;
}

/**
 * Result from buildCreateSmartAccountInstruction.
 */
export interface CreateSmartAccountResult {
  /** The instruction to execute */
  instruction: Instruction;
  /** The settings PDA address */
  settingsAddress: Address;
  /** The vault (smart account) PDA address */
  vaultAddress: Address;
}

/**
 * Build a createSmartAccount instruction with proper remaining accounts.
 *
 * This wrapper:
 * - Accepts Address instead of TransactionSigner (signing happens externally)
 * - Derives and includes the settings PDA as a remaining account
 * - Returns the derived addresses for convenience
 *
 * @param accountIndex - The account index for this smart account
 * @param input - Creation parameters
 */
export async function buildCreateSmartAccountInstruction(
  accountIndex: bigint,
  input: CreateSmartAccountInput,
): Promise<CreateSmartAccountResult> {
  const settingsAddress = await deriveSettings(accountIndex);
  const vaultAddress = await deriveSmartAccount(settingsAddress, 0);

  // Create fake signer objects that the generated code will extract addresses from
  const creatorSigner = { address: input.creatorAddress } as Parameters<
    typeof getCreateSmartAccountInstruction
  >[0]["creator"];

  const baseInstruction = getCreateSmartAccountInstruction({
    programConfig: input.programConfigAddress,
    treasury: input.treasuryAddress,
    creator: creatorSigner,
    program: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    settingsAuthority: input.settingsAuthority,
    threshold: input.threshold,
    signers: input.signers,
    timeLock: input.timeLock,
    rentCollector: input.rentCollector,
    memo: input.memo ?? null,
  });

  // Add settings PDA as writable remaining account
  const instruction = {
    ...baseInstruction,
    accounts: [
      ...baseInstruction.accounts,
      { address: settingsAddress, role: AccountRole.WRITABLE },
    ],
  } as Instruction;

  return { instruction, settingsAddress, vaultAddress };
}

/**
 * Input for buildAddSpendingLimitInstruction.
 * Uses Address instead of TransactionSigner for external signing support.
 */
export interface AddSpendingLimitInput {
  /** Settings PDA address */
  settingsAddress: Address;
  /** Settings authority address (will sign externally) */
  settingsAuthorityAddress: Address;
  /** Executor address (used as seed and authorized signer) */
  executorAddress: Address;
  /** Token mint address */
  mint: Address;
  /** Amount limit per period */
  amount: bigint;
  /** Reset period */
  period: Period;
  /** Destination restrictions (empty = any destination) */
  destinations?: Address[];
  /** Expiration timestamp (i64::MAX for non-expiring) */
  expiration?: bigint;
  /** Optional memo for indexing */
  memo?: string | null;
}

/**
 * Result from buildAddSpendingLimitInstruction.
 */
export interface AddSpendingLimitResult {
  /** The instruction to execute */
  instruction: Instruction;
  /** The spending limit PDA address */
  spendingLimitAddress: Address;
}

/** Maximum i64 value for non-expiring spending limits */
const I64_MAX = BigInt("9223372036854775807");

/**
 * Build an addSpendingLimitAsAuthority instruction.
 *
 * This wrapper:
 * - Accepts Address instead of TransactionSigner (signing happens externally)
 * - Derives the spending limit PDA
 * - Sets sensible defaults for optional parameters
 *
 * @param input - Spending limit parameters
 */
export async function buildAddSpendingLimitInstruction(
  input: AddSpendingLimitInput,
): Promise<AddSpendingLimitResult> {
  const spendingLimitAddress = await deriveSpendingLimit(
    input.settingsAddress,
    input.executorAddress,
  );

  // Create fake signer objects
  const settingsAuthoritySigner = {
    address: input.settingsAuthorityAddress,
  } as Parameters<
    typeof getAddSpendingLimitAsAuthorityInstruction
  >[0]["settingsAuthority"];
  const rentPayerSigner = {
    address: input.settingsAuthorityAddress,
  } as Parameters<
    typeof getAddSpendingLimitAsAuthorityInstruction
  >[0]["rentPayer"];

  const instruction = getAddSpendingLimitAsAuthorityInstruction({
    settings: input.settingsAddress,
    settingsAuthority: settingsAuthoritySigner,
    spendingLimit: spendingLimitAddress,
    rentPayer: rentPayerSigner,
    program: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    seed: input.executorAddress,
    accountIndex: 0,
    mint: input.mint,
    amount: input.amount,
    period: input.period,
    signers: [input.executorAddress],
    destinations: input.destinations ?? [],
    expiration: input.expiration ?? I64_MAX,
    memo: input.memo ?? null,
  });

  return { instruction, spendingLimitAddress };
}

/**
 * Input for buildRemoveSpendingLimitInstruction.
 */
export interface RemoveSpendingLimitInput {
  /** Settings PDA address */
  settingsAddress: Address;
  /** Settings authority address (will sign externally) */
  settingsAuthorityAddress: Address;
  /** Spending limit PDA to remove */
  spendingLimitAddress: Address;
  /** Address to receive rent refund */
  rentCollector: Address;
  /** Optional memo for indexing */
  memo?: string | null;
}

/**
 * Build a removeSpendingLimitAsAuthority instruction.
 *
 * @param input - Removal parameters
 */
export function buildRemoveSpendingLimitInstruction(
  input: RemoveSpendingLimitInput,
): Instruction {
  const settingsAuthoritySigner = {
    address: input.settingsAuthorityAddress,
  } as Parameters<
    typeof getRemoveSpendingLimitAsAuthorityInstruction
  >[0]["settingsAuthority"];

  return getRemoveSpendingLimitAsAuthorityInstruction({
    settings: input.settingsAddress,
    settingsAuthority: settingsAuthoritySigner,
    spendingLimit: input.spendingLimitAddress,
    rentCollector: input.rentCollector,
    program: SQUADS_SMART_ACCOUNT_PROGRAM_PROGRAM_ADDRESS,
    memo: input.memo ?? null,
  });
}

// =============================================================================
// Base58 Utilities
// =============================================================================

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Decode a base58 string to bytes.
 * Used for decoding Solana secret keys stored as base58 strings.
 */
export function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base58 character: ${char}`);

    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] as number) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Handle leading zeros
  for (const char of str) {
    if (char !== "1") break;
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

// =============================================================================
// API Key Encoding/Decoding
// =============================================================================

const API_KEY_PREFIX = "tabs_";
const API_KEY_VERSION = 1;

/**
 * Decoded Tabs API key payload.
 */
export interface TabsApiKeyPayload {
  /** Settings PDA address (base58) */
  settingsPda: string;
  /** Spending limit PDA address (base58) */
  spendingLimitPda: string;
  /** Maximum amount per transaction (in base units) */
  perTxMax: bigint;
  /** API key version */
  version: number;
}

/**
 * Decode a Tabs API key into its payload.
 *
 * @param key - The API key string (starts with 'tabs_')
 * @returns The decoded payload, or null if invalid
 *
 * @example
 * ```typescript
 * const payload = decodeTabsApiKey('tabs_eyJzZXR0aW5nc1BkYS...');
 * if (payload) {
 *   console.log('Settings PDA:', payload.settingsPda);
 *   console.log('Per-tx max:', payload.perTxMax);
 * }
 * ```
 */
export function decodeTabsApiKey(key: string): TabsApiKeyPayload | null {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  try {
    const base64 = key
      .slice(API_KEY_PREFIX.length)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const parsed = JSON.parse(atob(base64));
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

/**
 * Input for encoding a Tabs API key.
 */
export interface EncodeTabsApiKeyInput {
  /** Settings PDA address (base58) */
  settingsPda: string;
  /** Spending limit PDA address (base58) */
  spendingLimitPda: string;
  /** Maximum amount per transaction (in base units) */
  perTxMax: bigint;
}

/**
 * Encode a Tabs API key from its components.
 *
 * @param input - The API key components
 * @returns The encoded API key string (starts with 'tabs_')
 *
 * @example
 * ```typescript
 * const apiKey = encodeTabsApiKey({
 *   settingsPda: '5T1d69cj2r89PqsUs9CHMQheGY5zs1vJEbwqhTE31Frp',
 *   spendingLimitPda: '4cocmbXwdUTmbcVVWUovJhAEhsvCFhksiB3i3c3FuXVM',
 *   perTxMax: 10_000_000n, // 10 USDC
 * });
 * ```
 */
export function encodeTabsApiKey(input: EncodeTabsApiKeyInput): string {
  const payload = {
    settingsPda: input.settingsPda,
    spendingLimitPda: input.spendingLimitPda,
    perTxMax: input.perTxMax.toString(),
    version: API_KEY_VERSION,
  };
  const base64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return API_KEY_PREFIX + base64;
}
