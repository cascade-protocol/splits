import { useChain, type ActiveChain } from "@/contexts/chain-context";
import { cn } from "@/lib/utils";

const chains: { id: ActiveChain; name: string; icon: string }[] = [
  { id: "solana", name: "Solana", icon: "◎" },
  { id: "base", name: "Base", icon: "🔵" },
];

/**
 * Chain selector toggle for switching between Solana and Base.
 */
export function ChainSelector() {
  const { chain, setChain } = useChain();

  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-1">
      {chains.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setChain(c.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            chain === c.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{c.icon}</span>
          <span>{c.name}</span>
        </button>
      ))}
    </div>
  );
}
