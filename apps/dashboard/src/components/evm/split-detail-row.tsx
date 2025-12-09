import { percentageBpsToShares } from "@cascade-fyi/splits-sdk";
import type { EvmSplitWithBalance } from "@/hooks/use-splits-evm";

interface EvmSplitDetailRowProps {
  split: EvmSplitWithBalance;
}

export function EvmSplitDetailRow({ split }: EvmSplitDetailRowProps) {
  return (
    <div className="w-full p-4 bg-muted/30 border-t space-y-4">
      {/* Recipients breakdown */}
      <div className="w-full">
        <h4 className="font-medium text-sm mb-3">Recipients</h4>
        <div className="space-y-2 w-full">
          {split.recipients.map((r) => {
            const address = r.address;

            return (
              <div
                key={address}
                className="flex items-center justify-between gap-4 text-sm w-full"
              >
                <code className="font-mono text-xs bg-muted px-2 py-1 rounded truncate max-w-[300px] md:max-w-none">
                  {address}
                </code>
                <span className="font-medium shrink-0">
                  {percentageBpsToShares(r.percentageBps)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Immutability note */}
      <div className="rounded-md bg-muted/50 border p-3">
        <p className="text-xs text-muted-foreground">
          EVM splits are immutable — create a new split to change recipients.
        </p>
      </div>
    </div>
  );
}
