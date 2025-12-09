/**
 * Helper utilities for Cascade Splits
 */

import {
  type Address,
  type Rpc,
  type SolanaRpcApi,
  getProgramDerivedAddress,
  getAddressEncoder,
  getAddressDecoder,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from "./constants.js";
import {
  PROGRAM_ID,
  PROTOCOL_CONFIG_SEED,
  SPLIT_CONFIG_SEED,
} from "./constants.js";
import {
  percentageBpsToShares,
  toPercentageBps,
  type Recipient,
} from "./recipients.js";
import {
  VaultNotFoundError,
  InvalidTokenAccountError,
  SplitConfigNotFoundError,
  ProtocolNotInitializedError,
  MintNotFoundError,
} from "./errors.js";
import { fetchMaybeSplitConfig } from "./generated/accounts/splitConfig.js";
import { fetchProtocolConfig } from "./generated/accounts/protocolConfig.js";

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// =============================================================================
// Browser-compatible utilities (no Node.js Buffer dependency)
// =============================================================================

/** Decode base64 string to Uint8Array (browser-native) */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Read little-endian u64 from Uint8Array at offset */
function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true); // true = little-endian
}

// =============================================================================
// Types
// =============================================================================

/**
 * Recipient with both percentageBps (on-chain) and share (convenience)
 */
export interface SplitRecipient {
  address: Address;
  percentageBps: number;
  share: number;
}

/**
 * Unclaimed amount for a recipient
 */
export interface UnclaimedAmount {
  recipient: Address;
  amount: bigint;
  timestamp: bigint;
}

/**
 * Split configuration returned by getSplitConfigFromVault
 */
export interface SplitConfig {
  /** The splitConfig PDA address */
  address: Address;
  /** Schema version */
  version: number;
  /** Authority that can update/close */
  authority: Address;
  /** Token mint */
  mint: Address;
  /** Vault address (where payments are sent) */
  vault: Address;
  /** Unique identifier */
  uniqueId: Address;
  /** PDA bump */
  bump: number;
  /** Active recipients with both percentageBps and share */
  recipients: SplitRecipient[];
  /** Non-zero unclaimed amounts */
  unclaimedAmounts: UnclaimedAmount[];
  /** Protocol fees awaiting claim */
  protocolUnclaimed: bigint;
  /** Last execution timestamp */
  lastActivity: bigint;
  /** Account that paid rent */
  rentPayer: Address;
}

/**
 * Protocol configuration
 */
export interface ProtocolConfig {
  address: Address;
  authority: Address;
  pendingAuthority: Address;
  feeWallet: Address;
  bump: number;
}

// =============================================================================
// Address Encoding (internal)
// =============================================================================

/** Decode raw bytes to Address (internal utility) */
function decodeAddress(bytes: Uint8Array): Address {
  return addressDecoder.decode(bytes);
}

// =============================================================================
// Caches
// =============================================================================

/**
 * Cache for isCascadeSplit results.
 *
 * Caching behavior:
 * - Positive results (is a split): cached indefinitely
 * - Negative results (existing account, not a split): cached indefinitely
 * - Non-existent accounts: NOT cached (could be created as split later)
 * - RPC errors: NOT cached (transient failures)
 *
 * In Node.js: persists for process lifetime (full benefit)
 * In Browser: persists for page session (limited benefit)
 */
const splitCache = new Map<string, boolean>();

/**
 * Cached protocol config (rarely changes).
 * Auto-invalidated on InvalidProtocolFeeRecipient error.
 */
let cachedProtocolConfig: ProtocolConfig | null = null;

/**
 * @internal
 * Invalidate cache entry for a specific vault.
 * Call after closeSplitConfig if immediate re-detection is needed.
 */
export function invalidateSplitCache(vault: Address): void {
  splitCache.delete(vault as string);
}

/**
 * @internal
 * Clear entire split detection cache.
 */
export function clearSplitCache(): void {
  splitCache.clear();
}

/**
 * @internal
 * Invalidate protocol config cache.
 * Called automatically on InvalidProtocolFeeRecipient error during execution.
 */
export function invalidateProtocolConfigCache(): void {
  cachedProtocolConfig = null;
}

// =============================================================================
// PDA Derivation
// =============================================================================

/**
 * Derive the protocol config PDA
 */
export async function deriveProtocolConfig(): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [PROTOCOL_CONFIG_SEED],
  });
  return address;
}

/**
 * Derive a split config PDA
 */
export async function deriveSplitConfig(
  authority: Address,
  mint: Address,
  uniqueId: Address,
): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      SPLIT_CONFIG_SEED,
      addressEncoder.encode(authority),
      addressEncoder.encode(mint),
      addressEncoder.encode(uniqueId),
    ],
  });
  return address;
}

/**
 * Derive an Associated Token Account address
 *
 * Seeds: [owner, tokenProgram, mint] with Associated Token Program as program ID
 */
export async function deriveAta(
  owner: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ADDRESS,
): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(tokenProgram),
      addressEncoder.encode(mint),
    ],
  });
  return address;
}

/**
 * Derive the vault address (ATA owned by splitConfig PDA)
 */
export async function deriveVault(
  splitConfig: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ADDRESS,
): Promise<Address> {
  return deriveAta(splitConfig, mint, tokenProgram);
}

// =============================================================================
// Read Functions
// =============================================================================

/**
 * Get split configuration from splitConfig PDA address.
 *
 * This is the primary read function - takes the splitConfig PDA
 * and returns the full split configuration with recipients.
 */
export async function getSplitConfig(
  rpc: Rpc<SolanaRpcApi>,
  splitConfig: Address,
): Promise<SplitConfig> {
  const maybeAccount = await fetchMaybeSplitConfig(rpc, splitConfig);

  if (!maybeAccount.exists) {
    throw new SplitConfigNotFoundError(splitConfig);
  }

  const data = maybeAccount.data;

  // Transform to clean output with both percentageBps and share
  return {
    address: splitConfig,
    version: data.version,
    authority: data.authority,
    mint: data.mint,
    vault: data.vault,
    uniqueId: data.uniqueId,
    bump: data.bump,
    recipients: data.recipients.slice(0, data.recipientCount).map((r) => ({
      address: r.address,
      percentageBps: r.percentageBps,
      share: percentageBpsToShares(r.percentageBps),
    })),
    unclaimedAmounts: data.unclaimedAmounts
      .filter((u) => u.amount > 0n)
      .map((u) => ({
        recipient: u.recipient,
        amount: u.amount,
        timestamp: u.timestamp,
      })),
    protocolUnclaimed: data.protocolUnclaimed,
    lastActivity: data.lastActivity,
    rentPayer: data.rentPayer,
  };
}

/**
 * Get splitConfig PDA address from a vault address.
 *
 * This is an edge-case utility for when you only have the vault address
 * (e.g., parsing on-chain events, legacy integrations).
 *
 * For most use cases, use `getSplitConfig()` directly with the splitConfig PDA.
 */
export async function getSplitConfigAddressFromVault(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
): Promise<Address> {
  const vaultInfo = await rpc
    .getAccountInfo(vault, { encoding: "base64" })
    .send();

  if (!vaultInfo.value) {
    throw new VaultNotFoundError(vault);
  }

  const vaultData = decodeBase64(vaultInfo.value.data[0]);

  // Token account: mint (32) + owner (32) + amount (8) + ...
  if (vaultData.length < 72) {
    throw new InvalidTokenAccountError(vault);
  }

  return decodeAddress(vaultData.subarray(32, 64));
}

/**
 * @deprecated Use `getSplitConfig()` instead. This function will be removed.
 *
 * Get split configuration from vault address.
 * Takes the vault (where users deposit) and returns the full split configuration.
 */
export async function getSplitConfigFromVault(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
): Promise<SplitConfig> {
  const splitConfigAddress = await getSplitConfigAddressFromVault(rpc, vault);
  return getSplitConfig(rpc, splitConfigAddress);
}

/**
 * Get protocol configuration.
 *
 * Results are cached for efficiency (protocol config rarely changes).
 * Cache is auto-invalidated on InvalidProtocolFeeRecipient error.
 */
export async function getProtocolConfig(
  rpc: Rpc<SolanaRpcApi>,
): Promise<ProtocolConfig> {
  if (cachedProtocolConfig) {
    return cachedProtocolConfig;
  }

  const address = await deriveProtocolConfig();

  try {
    const account = await fetchProtocolConfig(rpc, address);
    cachedProtocolConfig = {
      address,
      authority: account.data.authority,
      pendingAuthority: account.data.pendingAuthority,
      feeWallet: account.data.feeWallet,
      bump: account.data.bump,
    };
    return cachedProtocolConfig;
  } catch {
    throw new ProtocolNotInitializedError();
  }
}

/**
 * Get vault token balance
 */
export async function getVaultBalance(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
): Promise<bigint> {
  const accountInfo = await rpc
    .getAccountInfo(vault, { encoding: "base64" })
    .send();

  if (!accountInfo.value) {
    return 0n;
  }

  const data = decodeBase64(accountInfo.value.data[0]);
  if (data.length < 72) {
    throw new InvalidTokenAccountError(vault);
  }

  return readBigUInt64LE(data, 64);
}

/**
 * Check if an address is a Cascade Split config.
 *
 * Results are cached for efficiency:
 * - Positive results (is a split): cached indefinitely
 * - Negative results (existing account, not a split): cached indefinitely
 * - Non-existent accounts: NOT cached (could be created later)
 * - RPC errors: NOT cached (transient failures)
 */
export async function isCascadeSplit(
  rpc: Rpc<SolanaRpcApi>,
  splitConfig: Address,
): Promise<boolean> {
  const key = splitConfig as string;
  const cached = splitCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  try {
    await getSplitConfig(rpc, splitConfig);
    splitCache.set(key, true);
    return true;
  } catch (e) {
    if (e instanceof SplitConfigNotFoundError) {
      // Account doesn't exist - might be created as split later
      return false; // DON'T CACHE
    }
    // Unknown error (RPC failure, etc.) - don't cache, propagate
    throw e;
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a random unique ID for split creation
 */
export function generateUniqueId(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return decodeAddress(bytes);
}

// =============================================================================
// Label-based Seeds
// =============================================================================

/**
 * Prefix for labeled seeds. Enables detection of labeled vs random seeds.
 * 5 bytes, leaving 27 bytes for the label.
 */
const LABEL_PREFIX = "CSPL:";
const LABEL_PREFIX_BYTES = new TextEncoder().encode(LABEL_PREFIX);
const MAX_LABEL_LENGTH = 27;

/**
 * Convert a human-readable label to a deterministic seed (Address).
 *
 * Labels are encoded directly into 32 bytes with a "CSPL:" prefix,
 * enabling reverse lookup via `seedToLabel()`. This is NOT hashing—
 * labels are limited to 27 characters.
 *
 * Cross-chain compatible: same label produces same seed bytes on Solana and EVM.
 *
 * @param label - Human-readable label (max 27 ASCII characters)
 * @returns Deterministic Address usable as `uniqueId` or `seed` parameter
 *
 * @example
 * ```typescript
 * // Dashboard auto-generates labels
 * const uniqueId = labelToSeed("Split 1");
 * await ensureSplitConfig({ rpc, rpcSubscriptions, signer, recipients, uniqueId });
 *
 * // Same label = same split address (idempotent)
 * const uniqueId2 = labelToSeed("Split 1");
 * // uniqueId === uniqueId2
 * ```
 */
export function labelToSeed(label: string): Address {
  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error(
      `Label too long: ${label.length} chars (max ${MAX_LABEL_LENGTH})`,
    );
  }

  const labelBytes = new TextEncoder().encode(label);
  const bytes = new Uint8Array(32);
  bytes.set(LABEL_PREFIX_BYTES, 0);
  bytes.set(labelBytes, LABEL_PREFIX_BYTES.length);
  // Remaining bytes are 0x00 (padding)

  return decodeAddress(bytes);
}

/**
 * Extract human-readable label from a seed, if it was created via `labelToSeed()`.
 *
 * Returns `null` for random seeds (created via `generateUniqueId()`),
 * enabling graceful fallback in UI display.
 *
 * @param seed - Seed Address or raw bytes to inspect
 * @returns Label string if seed was labeled, null otherwise
 *
 * @example
 * ```typescript
 * // Display logic for split list
 * function getSplitDisplayName(split: SplitConfig): string {
 *   const label = seedToLabel(split.uniqueId);
 *   return label ?? `Vault ${truncate(split.vault)}`;
 * }
 *
 * // Labeled seed
 * seedToLabel(labelToSeed("Split 1")); // "Split 1"
 *
 * // Random seed
 * seedToLabel(generateUniqueId()); // null
 * ```
 */
export function seedToLabel(seed: Address | Uint8Array): string | null {
  const bytes = seed instanceof Uint8Array ? seed : addressEncoder.encode(seed);

  // Check for CSPL: prefix
  for (let i = 0; i < LABEL_PREFIX_BYTES.length; i++) {
    if (bytes[i] !== LABEL_PREFIX_BYTES[i]) {
      return null; // Not a labeled seed
    }
  }

  // Extract label (bytes after prefix, until first null byte)
  const labelStart = LABEL_PREFIX_BYTES.length;
  let labelEnd = bytes.length;
  for (let i = labelStart; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      labelEnd = i;
      break;
    }
  }

  return new TextDecoder().decode(bytes.subarray(labelStart, labelEnd));
}

// =============================================================================
// Token Program Detection
// =============================================================================

/**
 * Cache for mint → token program mapping.
 * Safe to cache indefinitely (program never changes for a mint).
 */
const mintProgramCache = new Map<string, Address>();

/**
 * Detect the token program for a mint by checking account owner.
 * Results are cached per mint.
 */
export async function detectTokenProgram(
  rpc: Rpc<SolanaRpcApi>,
  mint: Address,
): Promise<Address> {
  const cached = mintProgramCache.get(mint);
  if (cached) return cached;

  const accountInfo = await rpc
    .getAccountInfo(mint, { encoding: "base64" })
    .send();

  if (!accountInfo.value) {
    throw new MintNotFoundError(mint);
  }

  const program = accountInfo.value.owner as Address;
  mintProgramCache.set(mint, program);
  return program;
}

// =============================================================================
// Recipient Comparison (Set Equality)
// =============================================================================

/**
 * Compare recipients using set equality (order-independent).
 * Returns true if same addresses with same shares, regardless of order.
 */
export function recipientsEqual(a: Recipient[], b: SplitRecipient[]): boolean {
  if (a.length !== b.length) return false;

  // Build map from first array: address -> bps
  const mapA = new Map<string, number>();
  for (const r of a) {
    mapA.set(r.address, r.percentageBps ?? toPercentageBps(r));
  }

  // Check all entries in B exist in A with same bps
  for (const r of b) {
    const bpsA = mapA.get(r.address as string);
    if (bpsA === undefined || bpsA !== r.percentageBps) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// ATA Checking
// =============================================================================

/**
 * Missing ATA information
 */
export interface MissingAta {
  recipient: Address;
  ata: Address;
}

/**
 * Check which recipient ATAs are missing.
 * Use with @solana-program/token to create missing ATAs before calling ensureSplitConfig.
 *
 * @example
 * ```typescript
 * import { checkRecipientAtas, getCreateAtaInstructions } from "@cascade-fyi/splits-sdk/solana";
 *
 * const missing = await checkRecipientAtas(rpc, recipients, mint);
 *
 * if (missing.length > 0) {
 *   const instructions = getCreateAtaInstructions({
 *     payer: payer.address,
 *     missingAtas: missing,
 *     mint,
 *     tokenProgram,
 *   });
 *   // Send transaction with instructions...
 * }
 *
 * // Now safe to create split config
 * await ensureSplitConfig({ rpc, rpcSubscriptions, signer, recipients });
 * ```
 */
export async function checkRecipientAtas(
  rpc: Rpc<SolanaRpcApi>,
  recipients: Array<{ address: string }>,
  mint: Address,
): Promise<MissingAta[]> {
  const tokenProgram = await detectTokenProgram(rpc, mint);

  const atas = await Promise.all(
    recipients.map(async (r) => ({
      recipient: r.address as Address,
      ata: await deriveAta(r.address as Address, mint, tokenProgram),
    })),
  );

  const accounts = await rpc
    .getMultipleAccounts(
      atas.map((a) => a.ata),
      { encoding: "base64" },
    )
    .send();

  const missing: MissingAta[] = [];
  for (let i = 0; i < atas.length; i++) {
    const ata = atas[i];
    if (!accounts.value[i] && ata) {
      missing.push({
        recipient: ata.recipient,
        ata: ata.ata,
      });
    }
  }

  return missing;
}

// Account roles for instruction building
const ATA_WRITABLE_SIGNER = 3;
const ATA_WRITABLE = 1;
const ATA_READONLY = 0;

// Associated Token Program instruction discriminators
const CREATE_ATA_IDEMPOTENT_DISCRIMINATOR = 1;

/**
 * Create instructions to create missing ATAs.
 *
 * Uses idempotent instruction (CreateIdempotent) - safe to call even if ATA exists.
 *
 * @param payer - Address paying for ATA creation
 * @param missingAtas - ATAs to create (from checkRecipientAtas)
 * @param mint - Token mint address
 * @param tokenProgram - Token program (SPL Token or Token-2022)
 * @returns Instructions to create the ATAs
 */
export function getCreateAtaInstructions(input: {
  payer: Address;
  missingAtas: MissingAta[];
  mint: Address;
  tokenProgram: Address;
}): Instruction[] {
  const { payer, missingAtas, mint, tokenProgram } = input;

  const data = new Uint8Array([CREATE_ATA_IDEMPOTENT_DISCRIMINATOR]);

  return missingAtas.map((m) => ({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: payer, role: ATA_WRITABLE_SIGNER },
      { address: m.ata, role: ATA_WRITABLE },
      { address: m.recipient, role: ATA_READONLY },
      { address: mint, role: ATA_READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: ATA_READONLY },
      { address: tokenProgram, role: ATA_READONLY },
    ],
    data,
  }));
}
