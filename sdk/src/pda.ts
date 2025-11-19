/**
 * PDA derivation utilities for Cascade Splits
 * String-based for use by both web3 and kit implementations
 */

import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  PROTOCOL_CONFIG_SEED,
  SPLIT_CONFIG_SEED,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  CreateSplitConfigResult,
} from "./types";

// Cached PublicKey instances
const programPubkey = new PublicKey(PROGRAM_ID);
const ataProgramPubkey = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
const bpfLoaderPubkey = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/**
 * Derive the protocol config PDA
 * Seeds: ["protocol_config"]
 */
export function deriveProtocolConfig(): { address: string; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_CONFIG_SEED)],
    programPubkey
  );
  return { address: pda.toBase58(), bump };
}

/**
 * Derive a split config PDA
 * Seeds: ["split_config", authority, mint, unique_id]
 */
export function deriveSplitConfig(
  authority: string,
  mint: string,
  uniqueId: string
): { address: string; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SPLIT_CONFIG_SEED),
      new PublicKey(authority).toBuffer(),
      new PublicKey(mint).toBuffer(),
      new PublicKey(uniqueId).toBuffer(),
    ],
    programPubkey
  );
  return { address: pda.toBase58(), bump };
}

/**
 * Derive the vault address (ATA owned by split_config PDA)
 */
export function deriveVault(
  splitConfig: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM_ID
): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(splitConfig).toBuffer(),
      new PublicKey(tokenProgram).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ataProgramPubkey
  );
  return ata.toBase58();
}

/**
 * Derive an Associated Token Account address
 */
export function deriveAta(
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM_ID
): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(tokenProgram).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ataProgramPubkey
  );
  return ata.toBase58();
}

/**
 * Derive the program data PDA (for upgrade authority check)
 */
export function deriveProgramData(): { address: string; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [programPubkey.toBuffer()],
    bpfLoaderPubkey
  );
  return { address: pda.toBase58(), bump };
}

/**
 * Derive all addresses needed to create a split config
 */
export function deriveCreateSplitConfigAddresses(
  authority: string,
  mint: string,
  uniqueId: string,
  tokenProgram: string = TOKEN_PROGRAM_ID
): CreateSplitConfigResult {
  const { address: splitConfig } = deriveSplitConfig(authority, mint, uniqueId);
  const vault = deriveVault(splitConfig, mint, tokenProgram);
  return { splitConfig, vault };
}
