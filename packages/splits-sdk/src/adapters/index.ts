/**
 * Adapters for integrating Cascade Splits SDK with various wallet frameworks.
 *
 * @example
 * ```typescript
 * // Framework-kit (@solana/react-hooks)
 * import { fromFrameworkKit } from '@cascade-fyi/splits-sdk/adapters/framework-kit';
 *
 * // Legacy wallet-adapter (@solana/wallet-adapter-react)
 * import { fromWalletAdapter } from '@cascade-fyi/splits-sdk/web3-compat';
 * ```
 */

export {
  fromFrameworkKit,
  signerFromFrameworkKit,
  type FrameworkKitWalletSession,
  type FrameworkKitSigner,
} from "./framework-kit.js";
