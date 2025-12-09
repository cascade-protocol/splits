/**
 * EVM Splits Hooks
 *
 * Wagmi-native hooks for reading and mutating splits on Base mainnet.
 * Uses Goldsky subgraph for split discovery, wagmi for contract reads.
 */

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useConnection,
  useWriteContract,
  useReadContracts,
  usePublicClient,
} from "wagmi";
import { base } from "wagmi/chains";
import type { Address, Hash } from "viem";
import {
  splitFactoryAbi,
  splitConfigImplAbi,
  getSplitFactoryAddress,
  getUsdcAddress,
  toEvmRecipients,
  type EvmRecipientInput,
} from "@cascade-fyi/splits-sdk-evm";

// =============================================================================
// Constants
// =============================================================================

const CHAIN_ID = base.id;
const FACTORY_ADDRESS = getSplitFactoryAddress(CHAIN_ID);
const USDC_ADDRESS = getUsdcAddress(CHAIN_ID);

// Goldsky subgraph endpoint (public, no auth required)
const GOLDSKY_URL =
  "https://api.goldsky.com/api/public/project_cmiq5kvoq64hs01wh0ydoesqs/subgraphs/cascade-splits-base/1.0.0/gn";

// =============================================================================
// Types
// =============================================================================

/** EVM split with balance for dashboard display */
export interface EvmSplitWithBalance {
  /** The split contract address */
  address: Address;
  /** Balance of tokens in the split */
  vaultBalance: bigint;
  /** Recipients with their percentage allocations */
  recipients: Array<{
    address: Address;
    percentageBps: number;
    share: number;
  }>;
  /** Block number when created (for sorting) */
  createdAtBlock: bigint;
  /** Unix timestamp when created */
  createdAt: bigint | null;
}

/** Result of ensure operation */
export type EnsureResult =
  | { status: "CREATED"; split: Address; txHash: Hash }
  | { status: "NO_CHANGE"; split: Address }
  | { status: "FAILED"; error: string };

/** Result of execute operation */
export type ExecuteResult =
  | { status: "EXECUTED"; txHash: Hash }
  | { status: "SKIPPED"; reason: string }
  | { status: "FAILED"; error: string };

// =============================================================================
// Goldsky Types (for split discovery only)
// =============================================================================

interface GoldskySplitEvent {
  split: string;
  block_number: string;
}

interface GoldskyResponse {
  data?: {
    splitConfigCreateds: GoldskySplitEvent[];
  };
  errors?: Array<{ message: string }>;
}

// =============================================================================
// Goldsky Fetch (discovery only)
// =============================================================================

async function fetchSplitAddressesFromGoldsky(
  authority: string,
): Promise<GoldskySplitEvent[]> {
  const query = `{
		splitConfigCreateds(
			where: { authority: "${authority.toLowerCase()}" }
			orderBy: block_number
			orderDirection: desc
		) {
			split
			block_number
		}
	}`;

  const response = await fetch(GOLDSKY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  const json: GoldskyResponse = await response.json();

  if (json.errors) {
    throw new Error(json.errors[0]?.message ?? "Goldsky query failed");
  }

  return json.data?.splitConfigCreateds ?? [];
}

// =============================================================================
// Query Hook: useEvmSplits
// =============================================================================

/** Contract recipient type from getRecipients() */
interface ContractRecipient {
  addr: Address;
  percentageBps: number;
}

/**
 * Hook to fetch EVM splits for the connected wallet.
 * Uses Goldsky for split discovery, reads recipients & balances from contracts.
 */
export function useEvmSplits() {
  const { address, isConnected } = useConnection();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  // Cache for block timestamps (block numbers are immutable)
  const [blockTimestamps, setBlockTimestamps] = useState<Map<string, bigint>>(
    new Map(),
  );

  // Step 1: Fetch split addresses from Goldsky (discovery)
  const goldskyQuery = useQuery({
    queryKey: ["evm-splits-goldsky", address],
    queryFn: async () => {
      if (!address) return [];
      return fetchSplitAddressesFromGoldsky(address);
    },
    enabled: isConnected && !!address,
    staleTime: 30_000,
  });

  const splitEvents = goldskyQuery.data ?? [];
  const splitAddresses = splitEvents.map((e) => e.split as Address);

  // Step 2: Batch read balances from contracts
  const balanceContracts = splitAddresses.map((addr) => ({
    address: addr,
    abi: splitConfigImplAbi,
    functionName: "getBalance" as const,
    chainId: CHAIN_ID,
  }));

  const balancesQuery = useReadContracts({
    contracts: balanceContracts,
    query: {
      enabled: splitAddresses.length > 0,
      staleTime: 15_000,
    },
  });

  // Step 3: Batch read recipients from contracts
  const recipientContracts = splitAddresses.map((addr) => ({
    address: addr,
    abi: splitConfigImplAbi,
    functionName: "getRecipients" as const,
    chainId: CHAIN_ID,
  }));

  const recipientsQuery = useReadContracts({
    contracts: recipientContracts,
    query: {
      enabled: splitAddresses.length > 0,
      staleTime: 60_000, // Recipients are immutable, cache longer
    },
  });

  // Step 4: Fetch block timestamps for creation dates
  const blockNumbersKey = splitEvents.map((e) => e.block_number).join(",");
  useQuery({
    queryKey: ["evm-block-timestamps", blockNumbersKey],
    queryFn: async () => {
      if (!publicClient || splitEvents.length === 0) return new Map();

      // Find blocks we haven't fetched yet
      const newBlocks = splitEvents
        .map((e) => e.block_number)
        .filter((bn) => !blockTimestamps.has(bn));

      if (newBlocks.length === 0) return blockTimestamps;

      // Fetch timestamps for new blocks
      const uniqueBlocks = [...new Set(newBlocks)];
      const timestamps = await Promise.all(
        uniqueBlocks.map(async (blockNum) => {
          try {
            const block = await publicClient.getBlock({
              blockNumber: BigInt(blockNum),
            });
            return [blockNum, block.timestamp] as const;
          } catch {
            return [blockNum, 0n] as const;
          }
        }),
      );

      // Update cache
      setBlockTimestamps((prev) => {
        const next = new Map(prev);
        for (const [bn, ts] of timestamps) {
          next.set(bn, ts);
        }
        return next;
      });

      return new Map(timestamps);
    },
    enabled: splitEvents.length > 0 && !!publicClient,
    staleTime: Infinity, // Block timestamps never change
  });

  // Step 5: Combine data from all sources
  const splits: EvmSplitWithBalance[] = splitEvents.map((event, index) => {
    const balanceResult = balancesQuery.data?.[index];
    const balance =
      balanceResult?.status === "success"
        ? (balanceResult.result as bigint)
        : 0n;

    const recipientsResult = recipientsQuery.data?.[index];
    const contractRecipients =
      recipientsResult?.status === "success"
        ? (recipientsResult.result as readonly ContractRecipient[])
        : [];

    const timestamp = blockTimestamps.get(event.block_number);

    return {
      address: event.split as Address,
      vaultBalance: balance,
      recipients: contractRecipients.map((r) => ({
        address: r.addr,
        percentageBps: Number(r.percentageBps),
        share: Math.round(Number(r.percentageBps) / 100),
      })),
      createdAtBlock: BigInt(event.block_number),
      createdAt: timestamp ?? null,
    };
  });

  const refetch = useCallback(() => {
    goldskyQuery.refetch();
    balancesQuery.refetch();
    recipientsQuery.refetch();
  }, [goldskyQuery, balancesQuery, recipientsQuery]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["evm-splits-goldsky", address],
    });
  }, [queryClient, address]);

  return {
    data: splits,
    isLoading: goldskyQuery.isLoading,
    error: goldskyQuery.error,
    refetch,
    invalidate,
  };
}

// =============================================================================
// Mutation Hook: useEnsureSplit
// =============================================================================

/**
 * Hook for creating splits.
 * Checks if split exists first, then creates if needed.
 */
export function useEnsureSplit() {
  const { address: authority, isConnected } = useConnection();
  const { invalidate } = useEvmSplits();

  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const ensureSplit = useCallback(
    async (params: {
      uniqueId: Hash;
      recipients: EvmRecipientInput[];
    }): Promise<EnsureResult> => {
      if (!isConnected || !authority) {
        return { status: "FAILED", error: "Wallet not connected" };
      }

      try {
        const evmRecipients = toEvmRecipients(params.recipients);

        // Validate recipients sum to 9900 bps (99%)
        const totalBps = evmRecipients.reduce(
          (sum, r) => sum + r.percentageBps,
          0,
        );
        if (totalBps !== 9900) {
          return {
            status: "FAILED",
            error: `Recipients must sum to 99% (9900 bps), got ${totalBps}`,
          };
        }

        // Create the split
        const hash = await writeContractAsync({
          address: FACTORY_ADDRESS,
          abi: splitFactoryAbi,
          functionName: "createSplitConfig",
          args: [
            authority,
            USDC_ADDRESS,
            params.uniqueId,
            evmRecipients.map((r) => ({
              addr: r.addr,
              percentageBps: r.percentageBps,
            })),
          ],
          chainId: CHAIN_ID,
        });

        // Invalidate queries to refetch
        invalidate();

        // Note: We don't have the split address here without waiting for receipt
        // The caller should refetch the splits list
        return {
          status: "CREATED",
          split: "0x" as Address, // Will be updated after refetch
          txHash: hash,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Check for "already exists" error
        if (message.includes("SplitAlreadyExists")) {
          return {
            status: "NO_CHANGE",
            split: "0x" as Address, // Caller should check existing splits
          };
        }

        // User rejected
        if (
          message.includes("rejected") ||
          message.includes("denied") ||
          message.includes("cancelled")
        ) {
          return { status: "FAILED", error: "Transaction rejected" };
        }

        return { status: "FAILED", error: message };
      }
    },
    [authority, isConnected, writeContractAsync, invalidate],
  );

  return {
    ensureSplit,
    isPending: isWriting,
  };
}

// =============================================================================
// Mutation Hook: useExecuteSplit
// =============================================================================

/**
 * Hook for executing splits (distributing funds).
 */
export function useExecuteSplit() {
  const { isConnected } = useConnection();
  const { invalidate } = useEvmSplits();

  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const executeSplit = useCallback(
    async (splitAddress: Address): Promise<ExecuteResult> => {
      if (!isConnected) {
        return { status: "FAILED", error: "Wallet not connected" };
      }

      try {
        const hash = await writeContractAsync({
          address: splitAddress,
          abi: splitConfigImplAbi,
          functionName: "executeSplit",
          args: [],
          chainId: CHAIN_ID,
        });

        // Invalidate queries to refetch balances
        invalidate();

        return { status: "EXECUTED", txHash: hash };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // User rejected
        if (
          message.includes("rejected") ||
          message.includes("denied") ||
          message.includes("cancelled")
        ) {
          return { status: "FAILED", error: "Transaction rejected" };
        }

        // No funds to distribute
        if (message.includes("NoPendingFunds") || message.includes("revert")) {
          return { status: "SKIPPED", reason: "No funds to distribute" };
        }

        return { status: "FAILED", error: message };
      }
    },
    [isConnected, writeContractAsync, invalidate],
  );

  return {
    executeSplit,
    isPending: isWriting,
  };
}
