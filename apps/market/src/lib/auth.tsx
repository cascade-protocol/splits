/**
 * Auth Context
 *
 * Provides SIWS (Sign In With Solana) authentication using wallet-standard.
 * Uses native signIn feature when available, falls back to signMessage.
 *
 * @see https://github.com/anza-xyz/wallet-standard
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useWallets, getWalletFeature } from "@wallet-standard/react";
import { SolanaSignIn } from "@solana/wallet-standard-features";
import type {
  SolanaSignInInput,
  SolanaSignInFeature,
} from "@solana/wallet-standard-features";
import {
  createSignInMessageText,
  type SolanaSignInInputWithRequiredFields,
} from "@solana/wallet-standard-util";
import { getAddressEncoder, type Address } from "@solana/kit";

/** Shape of verify request body (arrays because JSON doesn't support Uint8Array) */
interface VerifyRequestOutput {
  account: {
    address: string;
    publicKey: number[];
  };
  signedMessage: number[];
  signature: number[];
}

// API helpers for auth endpoints
async function fetchNonce(): Promise<SolanaSignInInput> {
  const res = await fetch("/api/auth/nonce");
  if (!res.ok) throw new Error("Failed to get nonce");
  return res.json();
}

async function fetchVerify(data: {
  nonce: string;
  output: VerifyRequestOutput;
}): Promise<{ address: string }> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = (await res.json()) as { error?: string };
    throw new Error(error.error || "Verification failed");
  }
  return res.json();
}

async function fetchSession(): Promise<{
  authenticated: boolean;
  address: string | null;
}> {
  const res = await fetch("/api/auth/session");
  if (!res.ok) throw new Error("Failed to get session");
  return res.json();
}

async function fetchSignOut(): Promise<void> {
  await fetch("/api/auth/signout", { method: "POST" });
}

// Auth state
interface AuthState {
  isAuthenticated: boolean;
  address: Address | null;
  isLoading: boolean;
  error: string | null;
}

// Auth context value (state + actions)
interface AuthContextValue extends AuthState {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider component
 * Wraps the app to provide authentication state and methods
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Get connected wallet from react-hooks (for signMessage fallback)
  const { wallet: walletSession, connected } = useWalletConnection();

  // Get all wallets from wallet-standard (for native SIWS feature access)
  const wallets = useWallets();

  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    address: null,
    isLoading: true,
    error: null,
  });

  // Find the UiWallet matching the connected wallet session (by address)
  const connectedAddress = walletSession?.account.address;
  const connectedWallet = wallets.find((w) =>
    w.accounts.some((a) => a.address === connectedAddress),
  );

  // Check if connected wallet supports native SIWS
  const supportsNativeSignIn = connectedWallet?.features.includes(SolanaSignIn);

  // Check existing session on mount
  useEffect(() => {
    let mounted = true;

    fetchSession()
      .then((session) => {
        if (mounted) {
          setState({
            isAuthenticated: session.authenticated,
            address: session.address as Address | null,
            isLoading: false,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (mounted) {
          console.error("Failed to get session:", err);
          setState({
            isAuthenticated: false,
            address: null,
            isLoading: false,
            error: null, // Don't show error for initial session check
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Sign in with wallet
  const signIn = useCallback(async () => {
    if (!walletSession || !connected) {
      setState((s) => ({ ...s, error: "Please connect your wallet first" }));
      return;
    }

    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // 1. Get full SIWS input from server (includes nonce, domain, etc.)
      const input = await fetchNonce();

      // 2. Add address to input (required for message construction)
      const inputWithAddress: SolanaSignInInput = {
        ...input,
        address: walletSession.account.address,
      };

      let signedMessage: Uint8Array;
      let signature: Uint8Array;
      let publicKey: Uint8Array;
      let signedAddress: string;

      // 3. Try native SIWS first, fall back to signMessage
      if (supportsNativeSignIn && connectedWallet) {
        // Native SIWS - wallet shows nice UI and handles message construction
        const feature = getWalletFeature(
          connectedWallet,
          SolanaSignIn,
        ) as SolanaSignInFeature[typeof SolanaSignIn];

        const [result] = await feature.signIn(inputWithAddress);
        signedMessage = result.signedMessage;
        signature = result.signature;
        publicKey = result.account.publicKey as Uint8Array;
        signedAddress = result.account.address;
      } else if (walletSession.signMessage) {
        // Fallback: use library for CAIP-122 message construction
        const message = createSignInMessageText(
          inputWithAddress as SolanaSignInInputWithRequiredFields,
        );
        signedMessage = new TextEncoder().encode(message);
        signature = await walletSession.signMessage(signedMessage);
        // Convert address to public key bytes for verification (base58 → 32 bytes)
        publicKey = new Uint8Array(
          getAddressEncoder().encode(walletSession.account.address),
        );
        signedAddress = walletSession.account.address;
      } else {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: "Your wallet does not support message signing",
        }));
        return;
      }

      // 4. Send structured output to server for verification
      if (!input.nonce) {
        throw new Error("Server returned invalid SIWS input (missing nonce)");
      }
      const { address: verifiedAddress } = await fetchVerify({
        nonce: input.nonce,
        output: {
          account: {
            address: signedAddress,
            publicKey: Array.from(publicKey),
          },
          signedMessage: Array.from(signedMessage),
          signature: Array.from(signature),
        },
      });

      setState({
        isAuthenticated: true,
        address: verifiedAddress as Address,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      console.error("Sign in failed:", err);
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : "Sign in failed",
      }));
    }
  }, [walletSession, connected, supportsNativeSignIn, connectedWallet]);

  // Sign out
  const signOut = useCallback(async () => {
    await fetchSignOut();
    setState({
      isAuthenticated: false,
      address: null,
      isLoading: false,
      error: null,
    });
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signIn,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 * Must be used within AuthProvider
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
