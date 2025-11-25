/**
 * React integration for Cascade Splits SDK.
 *
 * Provides ready-to-use hooks with TanStack Query for seamless integration,
 * plus primitives for advanced customization.
 *
 * @example
 * ```tsx
 * // 1. Wrap your app with SplitsProvider
 * import { SplitsProvider } from '@cascade-fyi/splits-sdk/react';
 * import { useConnection } from '@solana/wallet-adapter-react';
 *
 * function App() {
 *   const { connection } = useConnection();
 *   return (
 *     <SplitsProvider connection={connection}>
 *       <YourApp />
 *     </SplitsProvider>
 *   );
 * }
 *
 * // 2. Use hooks in your components
 * import { useSplits, useCreateSplit } from '@cascade-fyi/splits-sdk/react';
 *
 * function SplitsList() {
 *   const { data: splits, isLoading } = useSplits();
 *   const { mutate: createSplit } = useCreateSplit();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       {splits?.map(split => <div key={split.vault}>{split.vault}</div>)}
 *       <button onClick={() => createSplit({ mint: '...', recipients: [...] })}>
 *         Create Split
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

// Provider and context (primitives)
export { SplitsProvider, type SplitsProviderProps } from "./provider.js";
export { useSplitsContext } from "./context.js";

// Query key factories for cache management
export { splitsQueryKeys } from "./query-keys.js";

// Query hooks (require @tanstack/react-query)
export { useSplits, useSplit, useVaultBalance } from "./hooks/use-splits.js";

// Mutation hooks (require @tanstack/react-query + @solana/wallet-adapter-react)
export {
	useCreateSplit,
	useExecuteSplit,
	useUpdateSplit,
	useCloseSplit,
	type MutationConfig,
} from "./hooks/use-mutations.js";

// Re-export types commonly needed in React apps
export type {
	SplitConfig,
	SplitWithBalance,
	DistributionPreview,
	Recipient,
} from "../core/types.js";

export type { CreateSplitInput, UpdateSplitInput } from "../web3/index.js";
