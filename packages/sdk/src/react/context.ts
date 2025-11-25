/**
 * React context for Cascade Splits SDK.
 * Use SplitsProvider to make the SDK available to all hooks.
 */

import { createContext, useContext } from "react";
import type { CascadeSplits } from "../web3/index.js";

/**
 * Context holding the SDK instance.
 * @internal
 */
export const SplitsContext = createContext<CascadeSplits | null>(null);

/**
 * Hook to access the SDK instance from context.
 * Must be used within a SplitsProvider.
 *
 * @throws If used outside of SplitsProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const sdk = useSplitsContext();
 *   // Use sdk directly for advanced operations
 *   const result = await sdk.buildCreateSplit(...);
 * }
 * ```
 */
export function useSplitsContext(): CascadeSplits {
	const sdk = useContext(SplitsContext);
	if (!sdk) {
		throw new Error("useSplitsContext must be used within a SplitsProvider");
	}
	return sdk;
}
