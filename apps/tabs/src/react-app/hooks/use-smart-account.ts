/**
 * Smart Account hook for Cascade Tabs.
 *
 * Single hook that manages all smart account state and actions.
 * Uses TanStack Query for data fetching and caching.
 */

import { useCallback, useMemo } from "react";
import { useSolanaClient, useWalletSession } from "@solana/react-hooks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  Address,
  Rpc,
  SolanaRpcApi,
  Signature,
  Instruction,
  TransactionSigner,
} from "@solana/kit";
import {
  getTransferCheckedInstruction,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  type SmartAccountState,
  fetchSmartAccountStateByOwner,
  encodeApiKey,
  buildCreateAccountInstruction,
  buildWithdrawInstruction,
  getNextAccountIndex,
  waitForConfirmation,
  simulateTransaction,
  USDC_MINT,
  USDC_DECIMALS,
  EXECUTOR_PUBKEY,
  Period,
  // SDK instruction builders (used directly)
  buildAddSpendingLimitInstruction,
  buildRemoveSpendingLimitInstruction,
} from "@/lib/squads";

const QUERY_KEY = ["smart-account"];

// === Wallet Client Types ===

interface WalletClient {
  rpc: Rpc<SolanaRpcApi>;
  address: Address;
  signAndSend: (instructions: Instruction[]) => Promise<Signature>;
}

export interface UseSmartAccountReturn {
  /** Smart account state, null if no account exists */
  account: SmartAccountState | null;
  /** Generated API key, null if no spending limit set */
  apiKey: string | null;
  /** Whether the account data is loading */
  isLoading: boolean;
  /** Error if fetching failed */
  error: Error | null;
  /** Whether any mutation is in progress */
  isPending: boolean;

  // Actions
  /** Create a new smart account */
  createAccount: () => Promise<void>;
  /** Deposit USDC into the vault */
  deposit: (amount: bigint) => Promise<void>;
  /** Withdraw USDC from the vault */
  withdraw: (amount: bigint) => Promise<void>;
  /** Set or update spending limit */
  setSpendingLimit: (dailyLimit: bigint) => Promise<void>;
  /** Revoke the current spending limit */
  revokeSpendingLimit: () => Promise<void>;
  /** Refresh account data */
  refresh: () => Promise<void>;
}

export function useSmartAccount(): UseSmartAccountReturn {
  const queryClient = useQueryClient();
  const solanaClient = useSolanaClient();
  const session = useWalletSession();

  // Create wallet client from framework-kit session
  // NOTE: We don't create a separate TransactionSigner here.
  // Instead, we pass Address to instruction builders and let prepareAndSend
  // handle signing with the session. This avoids duplicate signer conflicts.
  const client = useMemo((): WalletClient | null => {
    if (!session) return null;

    const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;

    return {
      rpc,
      address: session.account.address,
      signAndSend: async (instructions: Instruction[]): Promise<Signature> => {
        const signature = await solanaClient.helpers.transaction.prepareAndSend(
          {
            authority: session,
            instructions,
            commitment: "confirmed",
          },
        );
        await waitForConfirmation(rpc, signature, "confirmed");
        return signature;
      },
    };
  }, [solanaClient, session]);

  // Fetch account state
  const {
    data: account,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...QUERY_KEY, client?.address],
    queryFn: async () => {
      if (!client) return null;
      return fetchSmartAccountStateByOwner(client.rpc, client.address);
    },
    enabled: !!client,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // 1 minute
  });

  // Derive API key from spending limit
  const apiKey = useMemo(() => {
    if (!account?.spendingLimit || !account.address) {
      return null;
    }
    return encodeApiKey({
      settingsPda: account.address,
      spendingLimitPda: account.spendingLimit.pda,
      perTxMax: account.spendingLimit.perTxLimit,
    });
  }, [account]);

  // Invalidate and refetch after mutations
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  // Create account mutation
  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Wallet not connected");

      const toastId = toast.loading("Creating Smart Account...");

      try {
        // Get next available account index
        const accountIndex = await getNextAccountIndex(client.rpc);

        // Build create instruction (pass address, not signer - prepareAndSend handles signing)
        const { instruction, settingsAddress } =
          await buildCreateAccountInstruction(
            client.rpc,
            client.address,
            accountIndex,
          );

        // Simulate before signing
        toast.loading("Simulating transaction...", { id: toastId });
        const simResult = await simulateTransaction(
          client.rpc,
          [instruction],
          client.address,
        );
        if (!simResult.success) {
          throw new Error(simResult.error ?? "Simulation failed");
        }

        // Update toast
        toast.loading("Signing transaction...", { id: toastId });

        // Sign and send
        await client.signAndSend([instruction]);

        toast.success("Smart Account created!", { id: toastId });
        return settingsAddress;
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to create account: ${err.message}`);
    },
  });

  // Deposit mutation - SPL token transfer to vault
  const depositMutation = useMutation({
    mutationFn: async (amount: bigint) => {
      if (!client || !account?.vaultAddress) {
        throw new Error("Wallet not connected or no account");
      }

      const toastId = toast.loading("Preparing deposit...");

      try {
        // Derive ATAs
        const [userAta] = await findAssociatedTokenPda({
          owner: client.address,
          mint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        const [vaultAta] = await findAssociatedTokenPda({
          owner: account.vaultAddress,
          mint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Create vault ATA if missing (idempotent - succeeds even if exists)
        // This is needed for the first deposit after account creation
        // Cast Address to TransactionSigner - prepareAndSend handles actual signing
        const createVaultAtaIx = getCreateAssociatedTokenIdempotentInstruction({
          payer: client.address as unknown as TransactionSigner,
          owner: account.vaultAddress,
          mint: USDC_MINT,
          ata: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Build transfer instruction
        // Cast Address to TransactionSigner - prepareAndSend handles actual signing
        const transferIx = getTransferCheckedInstruction({
          source: userAta,
          mint: USDC_MINT,
          destination: vaultAta,
          authority: client.address as unknown as TransactionSigner,
          amount,
          decimals: USDC_DECIMALS,
        });

        // Simulate before signing
        toast.loading("Simulating transaction...", { id: toastId });
        const simResult = await simulateTransaction(
          client.rpc,
          [createVaultAtaIx, transferIx],
          client.address,
        );
        if (!simResult.success) {
          throw new Error(simResult.error ?? "Simulation failed");
        }

        toast.loading("Signing transaction...", { id: toastId });
        await client.signAndSend([createVaultAtaIx, transferIx]);
        toast.success("Deposit successful!", { id: toastId });
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      toast.error(`Deposit failed: ${err.message}`);
    },
  });

  // Withdraw mutation - owner transfer from vault via executeTransactionSync
  const withdrawMutation = useMutation({
    mutationFn: async (amount: bigint) => {
      if (!client || !account?.vaultAddress) {
        throw new Error("Wallet not connected or no account");
      }

      const toastId = toast.loading("Preparing withdrawal...");

      try {
        // Derive ATAs
        const [vaultAta] = await findAssociatedTokenPda({
          owner: account.vaultAddress,
          mint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        const [userAta] = await findAssociatedTokenPda({
          owner: client.address,
          mint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Build withdrawal instruction
        const instruction = await buildWithdrawInstruction(
          account.address, // settingsAddress
          account.vaultAddress, // vaultAddress (PDA)
          vaultAta, // vaultAtaAddress
          client.address, // ownerAddress
          userAta, // destinationAtaAddress
          amount,
        );

        // Simulate before signing
        toast.loading("Simulating transaction...", { id: toastId });
        const simResult = await simulateTransaction(
          client.rpc,
          [instruction],
          client.address,
        );
        if (!simResult.success) {
          throw new Error(simResult.error ?? "Simulation failed");
        }

        toast.loading("Signing transaction...", { id: toastId });
        await client.signAndSend([instruction]);
        toast.success("Withdrawal successful!", { id: toastId });
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      toast.error(`Withdrawal failed: ${err.message}`);
    },
  });

  // Set spending limit mutation
  // Note: Squads Smart Account only supports period-based limits (daily/weekly/monthly).
  // Per-tx limits would require executor-level enforcement (future work).
  // If a spending limit already exists, we must remove it first then add a new one.
  const setSpendingLimitMutation = useMutation({
    mutationFn: async (dailyLimit: bigint) => {
      if (!client || !account?.address) {
        throw new Error("No smart account");
      }

      if (!EXECUTOR_PUBKEY) {
        throw new Error("Executor pubkey not configured");
      }

      const isUpdate = !!account.spendingLimit;
      const toastId = toast.loading(
        isUpdate ? "Updating spending limit..." : "Setting spending limit...",
      );

      try {
        const instructions: Instruction[] = [];

        // If updating, remove existing spending limit first
        if (isUpdate && account.spendingLimit) {
          const removeIx = buildRemoveSpendingLimitInstruction({
            settingsAddress: account.address,
            settingsAuthorityAddress: client.address,
            spendingLimitAddress: account.spendingLimit.pda,
            rentCollector: client.address,
          });
          instructions.push(removeIx);
        }

        // Build add spending limit instruction
        const { instruction: addIx, spendingLimitAddress } =
          await buildAddSpendingLimitInstruction({
            settingsAddress: account.address,
            settingsAuthorityAddress: client.address,
            executorAddress: EXECUTOR_PUBKEY,
            mint: USDC_MINT,
            amount: dailyLimit,
            period: Period.Day,
          });
        instructions.push(addIx);

        // Simulate before signing
        toast.loading("Simulating transaction...", { id: toastId });
        const simResult = await simulateTransaction(
          client.rpc,
          instructions,
          client.address,
        );
        if (!simResult.success) {
          throw new Error(simResult.error ?? "Simulation failed");
        }

        // Update toast
        toast.loading("Signing transaction...", { id: toastId });

        // Sign and send
        await client.signAndSend(instructions);

        toast.success(
          isUpdate ? "Spending limit updated!" : "Spending limit set!",
          { id: toastId },
        );
        return spendingLimitAddress;
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to set spending limit: ${err.message}`);
    },
  });

  // Revoke spending limit mutation
  const revokeSpendingLimitMutation = useMutation({
    mutationFn: async () => {
      if (!client || !account?.address || !account.spendingLimit?.pda) {
        throw new Error("No spending limit to revoke");
      }

      const toastId = toast.loading("Revoking spending limit...");

      try {
        // Build remove spending limit instruction using SDK directly
        const instruction = buildRemoveSpendingLimitInstruction({
          settingsAddress: account.address,
          settingsAuthorityAddress: client.address,
          spendingLimitAddress: account.spendingLimit.pda,
          rentCollector: client.address,
        });

        // Simulate before signing
        toast.loading("Simulating transaction...", { id: toastId });
        const simResult = await simulateTransaction(
          client.rpc,
          [instruction],
          client.address,
        );
        if (!simResult.success) {
          throw new Error(simResult.error ?? "Simulation failed");
        }

        // Update toast
        toast.loading("Signing transaction...", { id: toastId });

        // Sign and send
        await client.signAndSend([instruction]);

        toast.success("Spending limit revoked!", { id: toastId });
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to revoke spending limit: ${err.message}`);
    },
  });

  // Check if any mutation is pending
  const isPending =
    createAccountMutation.isPending ||
    depositMutation.isPending ||
    withdrawMutation.isPending ||
    setSpendingLimitMutation.isPending ||
    revokeSpendingLimitMutation.isPending;

  return {
    account: account ?? null,
    apiKey,
    isLoading,
    error: error as Error | null,
    isPending,

    createAccount: useCallback(async () => {
      await createAccountMutation.mutateAsync();
    }, [createAccountMutation]),
    deposit: useCallback(
      (amount: bigint) => depositMutation.mutateAsync(amount),
      [depositMutation],
    ),
    withdraw: useCallback(
      (amount: bigint) => withdrawMutation.mutateAsync(amount),
      [withdrawMutation],
    ),
    setSpendingLimit: useCallback(
      async (dailyLimit: bigint) => {
        await setSpendingLimitMutation.mutateAsync(dailyLimit);
      },
      [setSpendingLimitMutation],
    ),
    revokeSpendingLimit: useCallback(
      () => revokeSpendingLimitMutation.mutateAsync(),
      [revokeSpendingLimitMutation],
    ),
    refresh: useCallback(async () => {
      await refetch();
    }, [refetch]),
  };
}
