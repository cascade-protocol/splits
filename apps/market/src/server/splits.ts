/**
 * On-Chain Service Discovery
 *
 * Per ADR-0004 §4.7: Service data is on-chain only.
 * Uses Cascade Splits program to discover marketplace services.
 */

import {
  createSolanaRpc,
  getBase58Decoder,
  getAddressEncoder,
} from "@solana/kit";
import type { Base58EncodedBytes } from "@solana/kit";
import {
  PROGRAM_ID,
  SPLIT_CONFIG_DISCRIMINATOR,
  seedToLabel,
  labelToSeed,
} from "@cascade-fyi/splits-sdk";

/**
 * Marketplace service discovered from on-chain Split
 */
export interface DiscoveredService {
  /** Full service path: @namespace/name */
  servicePath: string;
  /** Namespace without @: cascade, tenequm, etc. */
  namespace: string;
  /** Service name within namespace: twitter, weather, etc. */
  name: string;
  /** SplitConfig PDA address */
  splitConfig: string;
  /** Vault ATA address (payment destination) */
  vault: string;
  /** Authority (service owner) wallet */
  authority: string;
}

/**
 * Query all marketplace services from on-chain SplitConfig PDAs.
 *
 * Services are identified by labels starting with `@` (e.g., @cascade/twitter).
 * Uses getProgramAccounts to fetch all splits, then filters by label prefix.
 *
 * @param rpcUrl - Solana RPC endpoint URL
 * @param namespaceFilter - Optional namespace to filter (without @)
 */
export async function discoverServices(
  rpcUrl: string,
  namespaceFilter?: string,
): Promise<DiscoveredService[]> {
  const rpc = createSolanaRpc(rpcUrl);
  const base58Decoder = getBase58Decoder();

  // Build discriminator filter
  const discriminatorBase58 = base58Decoder.decode(
    SPLIT_CONFIG_DISCRIMINATOR,
  ) as Base58EncodedBytes;

  // Fetch all SplitConfig accounts
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ID, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: discriminatorBase58,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  const services: DiscoveredService[] = [];

  for (const { pubkey, account } of accounts) {
    // Decode account data (browser-compatible base64 decoding)
    const base64Data = account.data[0];
    const binaryString = atob(base64Data);
    const data = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));

    // SplitConfig layout (zero-copy #[repr(C)]):
    // discriminator(8) + version(1) + authority(32) + mint(32) + vault(32) + uniqueId(32) + bump(1) + ...
    const authority = base58Decoder.decode(data.subarray(9, 41)) as string;
    const vault = base58Decoder.decode(data.subarray(73, 105)) as string;
    const uniqueIdBytes = data.subarray(105, 137);

    // Convert uniqueId to label - skip non-marketplace splits
    const label = seedToLabel(uniqueIdBytes);
    if (!label?.startsWith("@")) continue;

    // Parse @namespace/name pattern
    const match = label.match(/^@([^/]+)\/(.+)$/);
    if (!match) continue;

    const [, namespace, name] = match;

    // Apply namespace filter if provided
    if (namespaceFilter && namespace !== namespaceFilter) continue;

    services.push({
      servicePath: label,
      namespace,
      name,
      splitConfig: pubkey,
      vault,
      authority,
    });
  }

  return services;
}

/**
 * Check if a service exists on-chain by its path.
 *
 * Uses getProgramAccounts with memcmp filter on uniqueId bytes.
 *
 * @param rpcUrl - Solana RPC endpoint
 * @param servicePath - Full path like @cascade/twitter
 */
export async function serviceExists(
  rpcUrl: string,
  servicePath: string,
): Promise<boolean> {
  // Parse service path to extract namespace/name
  const match = servicePath.match(/^@([^/]+)\/(.+)$/);
  if (!match) return false;

  const rpc = createSolanaRpc(rpcUrl);
  const base58Decoder = getBase58Decoder();
  const addressEncoder = getAddressEncoder();

  // Convert label to seed bytes for memcmp filter
  // labelToSeed returns Address (base58), encode to bytes, then decode to Base58EncodedBytes
  const uniqueId = labelToSeed(servicePath);
  const uniqueIdBytes = addressEncoder.encode(uniqueId);
  const uniqueIdBase58 = base58Decoder.decode(
    uniqueIdBytes,
  ) as Base58EncodedBytes;

  // Query for any SplitConfig with this uniqueId at offset 105
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ID, {
      encoding: "base64",
      dataSlice: { offset: 0, length: 8 }, // Only fetch discriminator (minimal data)
      filters: [
        {
          memcmp: {
            offset: 105n, // uniqueId offset in SplitConfig
            bytes: uniqueIdBase58,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  return accounts.length > 0;
}
