import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

/**
 * Supported chains in the dashboard.
 */
export type ActiveChain = "solana" | "base";

interface ChainContextValue {
  /** Currently selected chain */
  chain: ActiveChain;
  /** Switch to a different chain */
  setChain: (chain: ActiveChain) => void;
  /** Check if current chain is Solana */
  isSolana: boolean;
  /** Check if current chain is Base (EVM) */
  isBase: boolean;
}

const ChainContext = createContext<ChainContextValue | null>(null);

const STORAGE_KEY = "cascade-active-chain";

/**
 * Get initial chain from localStorage or default to Solana.
 */
function getInitialChain(): ActiveChain {
  if (typeof window === "undefined") return "solana";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "solana" || stored === "base") return stored;
  return "solana";
}

interface ChainProviderProps {
  children: ReactNode;
}

/**
 * Provider for chain selection state.
 *
 * Persists selection to localStorage so user's preference is remembered.
 */
export function ChainProvider({ children }: ChainProviderProps) {
  const [chain, setChainState] = useState<ActiveChain>(getInitialChain);

  const setChain = useCallback((newChain: ActiveChain) => {
    setChainState(newChain);
    localStorage.setItem(STORAGE_KEY, newChain);
  }, []);

  const value: ChainContextValue = {
    chain,
    setChain,
    isSolana: chain === "solana",
    isBase: chain === "base",
  };

  return (
    <ChainContext.Provider value={value}>{children}</ChainContext.Provider>
  );
}

/**
 * Hook to access chain context.
 *
 * @throws If used outside of ChainProvider
 */
export function useChain(): ChainContextValue {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error("useChain must be used within a ChainProvider");
  }
  return context;
}
