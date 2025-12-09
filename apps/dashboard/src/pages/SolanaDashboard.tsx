/**
 * Solana Splits Dashboard
 *
 * Dashboard for managing Solana splits. Supports create, update, close, and execute.
 */

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { RefreshCw } from "lucide-react";
import {
  USDC_MINT,
  generateUniqueId,
  type Recipient,
} from "@cascade-fyi/splits-sdk";
import {
  useSplitsWithBalances,
  useSplitsClient,
  type SplitWithBalance,
} from "@/hooks/use-splits-solana";

import {
  createColumns,
  CloseSplitDialog,
  CreateSplitDialog,
  CreateSplitForm,
  DataTable,
  mobileHiddenColumns,
  SplitDetailRow,
  UpdateSplitDialog,
  type SplitActions,
} from "@/components/solana";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { openExternal } from "@/lib/utils";

export function SolanaDashboard() {
  // Data fetching with real-time balance updates
  const {
    data: splits = [],
    isLoading,
    error,
    refetch,
  } = useSplitsWithBalances();

  // SDK client for mutations
  const splitsClient = useSplitsClient();

  // Pending states for UI feedback
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [executingVault, setExecutingVault] = useState<string | null>(null);

  // Dialog state for update/close actions
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [selectedSplit, setSelectedSplit] = useState<SplitWithBalance | null>(
    null,
  );

  const handleExecuteSplit = useCallback(
    async (splitConfig: SplitWithBalance) => {
      if (!splitsClient) return;
      setExecutingVault(splitConfig.vault as string);
      const toastId = toast.loading("Signing transaction...");
      try {
        setTimeout(() => {
          toast.loading("Confirming transaction...", { id: toastId });
        }, 2000);

        const result = await splitsClient.execute(splitConfig.address);

        if (result.status === "executed") {
          toast.success("Split executed!", {
            id: toastId,
            description: `Funds distributed. Signature: ${(result.signature as string).slice(0, 8)}...`,
            action: {
              label: "View",
              onClick: () =>
                openExternal(`https://solscan.io/tx/${result.signature}`),
            },
          });
          refetch();
        } else if (result.status === "skipped") {
          toast.info("Execution skipped", {
            id: toastId,
            description: result.message,
          });
        } else {
          toast.error("Failed to execute split", {
            id: toastId,
            description: result.message,
          });
        }
      } catch (err) {
        toast.error("Failed to execute split", {
          id: toastId,
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setExecutingVault(null);
      }
    },
    [splitsClient, refetch],
  );

  const handleUpdateSplit = useCallback((splitConfig: SplitWithBalance) => {
    setSelectedSplit(splitConfig);
    setUpdateDialogOpen(true);
  }, []);

  const handleCloseSplit = useCallback((splitConfig: SplitWithBalance) => {
    setSelectedSplit(splitConfig);
    setCloseDialogOpen(true);
  }, []);

  const handleUpdateSubmit = async (
    splitConfig: SplitWithBalance,
    recipients: Recipient[],
  ) => {
    if (!splitsClient) return;
    setIsUpdating(true);
    try {
      const result = await splitsClient.update(splitConfig.address, {
        recipients,
      });

      if (result.status === "updated") {
        toast.success("Recipients updated!", {
          description: `Signature: ${(result.signature as string).slice(0, 8)}...`,
          action: {
            label: "View",
            onClick: () =>
              openExternal(`https://solscan.io/tx/${result.signature}`),
          },
        });
        refetch();
      } else if (result.status === "no_change") {
        toast.info("No changes needed", {
          description: "Recipients already match",
        });
      } else if (result.status === "blocked") {
        toast.warning("Cannot update", { description: result.message });
      } else {
        toast.error("Update failed", { description: result.message });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCloseSubmit = async (splitConfig: SplitWithBalance) => {
    if (!splitsClient) return;
    setIsClosing(true);
    try {
      const result = await splitsClient.close(splitConfig.address);

      if (result.status === "closed") {
        toast.success("Split closed!", {
          description: `Rent returned. Signature: ${(result.signature as string).slice(0, 8)}...`,
          action: {
            label: "View",
            onClick: () =>
              openExternal(`https://solscan.io/tx/${result.signature}`),
          },
        });
        refetch();
      } else if (result.status === "already_closed") {
        toast.info("Already closed");
      } else if (result.status === "blocked") {
        toast.warning("Cannot close", { description: result.message });
      } else {
        toast.error("Close failed", { description: result.message });
      }
    } finally {
      setIsClosing(false);
    }
  };

  const splitActions: SplitActions = useMemo(
    () => ({
      onExecute: handleExecuteSplit,
      onUpdate: handleUpdateSplit,
      onClose: handleCloseSplit,
    }),
    [handleExecuteSplit, handleUpdateSplit, handleCloseSplit],
  );

  const columns = useMemo(
    () => createColumns(splitActions, executingVault, "solana"),
    [splitActions, executingVault],
  );

  const handleCreateSplit = async (recipients: Recipient[]) => {
    if (!splitsClient) return;
    setIsCreating(true);
    const toastId = toast.loading("Signing transaction...");
    try {
      setTimeout(() => {
        toast.loading("Confirming transaction...", { id: toastId });
      }, 2000);

      const result = await splitsClient.ensureSplit({
        recipients,
        mint: USDC_MINT as Address,
        uniqueId: generateUniqueId(),
      });

      if (result.status === "created") {
        toast.success("Split created!", {
          id: toastId,
          description: `${(result.splitConfig as string).slice(0, 8)}...${(result.splitConfig as string).slice(-4)}`,
          action: {
            label: "View",
            onClick: () =>
              openExternal(`https://solscan.io/account/${result.splitConfig}`),
          },
        });
        refetch();
      } else if (result.status === "blocked") {
        toast.warning("Cannot create split", {
          id: toastId,
          description: result.message,
        });
      } else if (result.status === "failed") {
        toast.error("Failed to create split", {
          id: toastId,
          description: result.message,
        });
      }
    } catch (err) {
      toast.error("Failed to create split", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <main className="container mx-auto flex-1 px-4 md:px-6 py-8">
        {isLoading ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-9 w-32" />
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/50 px-4 py-3">
                <div className="flex gap-8">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
              {[1, 2, 3].map((n) => (
                <div
                  key={`skeleton-row-${n}`}
                  className="flex items-center gap-4 border-b px-4 py-4 last:border-0"
                >
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <div className="ml-auto flex gap-2">
                    <Skeleton className="h-8 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <p className="text-destructive font-medium">
              Failed to load splits
            </p>
            <p className="text-muted-foreground text-sm max-w-md">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : splits.length === 0 ? (
          <CreateSplitForm
            onSubmit={handleCreateSplit}
            isPending={isCreating}
          />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold md:text-3xl">Your Splits</h1>
                <p className="text-muted-foreground mt-1">
                  Manage your payment split configurations
                </p>
              </div>
              <CreateSplitDialog
                onSubmit={handleCreateSplit}
                isPending={isCreating}
              />
            </div>
            <DataTable
              columns={columns}
              data={splits}
              initialColumnVisibility={mobileHiddenColumns}
              initialSorting={[{ id: "createdAt", desc: true }]}
              renderDetailRow={(row) => <SplitDetailRow splitConfig={row} />}
            />
          </>
        )}
      </main>

      {/* Update/Close dialogs - Solana only */}
      <UpdateSplitDialog
        splitConfig={selectedSplit}
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        onSubmit={handleUpdateSubmit}
        isPending={isUpdating}
      />
      <CloseSplitDialog
        splitConfig={selectedSplit}
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        onConfirm={handleCloseSubmit}
        isPending={isClosing}
      />
    </>
  );
}
