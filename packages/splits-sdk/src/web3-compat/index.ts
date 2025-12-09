/**
 * Web3.js compatibility layer for Cascade Splits SDK
 *
 * Bridge functions to convert between @solana/kit and @solana/web3.js types.
 * Implementation based on Solana Foundation's framework-kit.
 *
 * @see https://github.com/solana-foundation/framework-kit
 *
 * ## Transaction Size Limits
 *
 * Legacy transactions are limited to 1232 bytes. For split configs with more
 * than ~11 recipients, use `VersionedTransaction` with `MessageV0.compile()`
 * and fetch ALTs via `connection.getAddressLookupTable()`.
 */

// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js TransactionInstruction type compatibility

import type { Address } from "@solana/kit";
import {
  fromLegacyPublicKey,
  fromLegacyTransactionInstruction,
} from "@solana/compat";
import {
  AccountRole,
  createKeyPairSignerFromBytes,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  type Keypair,
  PublicKey,
  type PublicKeyInitData,
  TransactionInstruction,
} from "@solana/web3.js";

export type ToKitSignerConfig = Readonly<{ extractable?: boolean }>;

/**
 * Convert a @solana/web3.js PublicKey to a @solana/kit Address
 */
export function toAddress<TAddress extends string = string>(
  input: PublicKey | PublicKeyInitData,
): Address<TAddress> {
  const pubkey = input instanceof PublicKey ? input : new PublicKey(input);
  return fromLegacyPublicKey(pubkey);
}

/**
 * Convert a @solana/kit Address to a @solana/web3.js PublicKey
 */
export function toPublicKey(input: Address | PublicKeyInitData): PublicKey {
  if (input instanceof PublicKey) {
    return input;
  }
  return new PublicKey(input);
}

/**
 * Convert a @solana/web3.js Keypair to a @solana/kit KeyPairSigner
 */
export async function toKitSigner(
  keypair: Keypair,
  config: ToKitSignerConfig = {},
): Promise<KeyPairSigner> {
  const secretKey = new Uint8Array(64);
  secretKey.set(keypair.secretKey);
  secretKey.set(keypair.publicKey.toBytes(), 32);
  return await createKeyPairSignerFromBytes(
    secretKey,
    config.extractable ?? false,
  );
}

/**
 * Convert a @solana/kit Instruction to a @solana/web3.js TransactionInstruction
 */
export function toWeb3Instruction(
  kitInstruction: Instruction,
): TransactionInstruction {
  const keys =
    kitInstruction.accounts?.map((account) => ({
      isSigner:
        account.role === AccountRole.READONLY_SIGNER ||
        account.role === AccountRole.WRITABLE_SIGNER,
      isWritable:
        account.role === AccountRole.WRITABLE ||
        account.role === AccountRole.WRITABLE_SIGNER,
      pubkey: toPublicKey(account.address),
    })) ?? [];

  return new TransactionInstruction({
    data: kitInstruction.data
      ? Buffer.from(kitInstruction.data)
      : Buffer.alloc(0),
    keys,
    programId: toPublicKey(kitInstruction.programAddress),
  });
}

/**
 * Convert a @solana/web3.js TransactionInstruction to a @solana/kit Instruction
 */
export function fromWeb3Instruction(
  legacyInstruction: TransactionInstruction,
): Instruction {
  return fromLegacyTransactionInstruction(legacyInstruction);
}

// =============================================================================
// Transaction Conversion
// =============================================================================

export {
  toWeb3Transaction,
  type KitTransactionMessage,
} from "./transactions.js";

// =============================================================================
// Wallet Adapters
// =============================================================================

export {
  fromWalletAdapter,
  WalletDisconnectedError,
  WalletRejectedError,
  type WalletAdapterLike,
} from "./wallet-adapter.js";
