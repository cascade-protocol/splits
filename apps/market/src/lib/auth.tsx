/**
 * Auth Context
 *
 * Provides SIWS (Sign In With Solana) authentication using the Solana Kit pattern.
 * Uses native signIn feature when available, falls back to CAIP-122 signMessage.
 *
 * @see https://github.com/anza-xyz/kit
 * @see https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md
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

// API helpers for auth endpoints
async function fetchNonce(): Promise<{ nonce: string }> {
  const res = await fetch("/api/auth/nonce");
  if (!res.ok) throw new Error("Failed to get nonce");
  return res.json();
}

async function fetchVerify(data: {
  signedMessage: string;
  signature: string;
  address: string;
  nonce: string;
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
  address: string | null;
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
 * Construct CAIP-122 compliant SIWS message (fallback for wallets without native signIn)
 * @see https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md
 */
function constructSIWSMessage(input: SolanaSignInInput): string {
  const lines = [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    "",
  ];

  if (input.statement) {
    lines.push(input.statement, "");
  }

  lines.push(`URI: ${input.uri}`);
  lines.push(`Version: ${input.version}`);
  lines.push(`Chain ID: ${input.chainId}`);
  lines.push(`Nonce: ${input.nonce}`);
  lines.push(`Issued At: ${input.issuedAt}`);

  if (input.resources?.length) {
    lines.push("Resources:");
    for (const r of input.resources) {
      lines.push(`- ${r}`);
    }
  }

  return lines.join("\n");
}

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
            address: session.address,
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
      // 1. Get nonce from server
      const { nonce } = await fetchNonce();

      // 2. Prepare SIWS input
      const input: SolanaSignInInput = {
        domain: window.location.host,
        address: walletSession.account.address,
        statement: "Sign in to Cascade Market",
        uri: window.location.origin,
        version: "1",
        chainId: "solana:mainnet",
        nonce,
        issuedAt: new Date().toISOString(),
        resources: ["https://market.cascade.fyi"],
      };

      let messageBytes: Uint8Array;
      let signature: Uint8Array;
      let signedAddress: string;

      // 3. Try native SIWS first, fall back to signMessage
      if (supportsNativeSignIn && connectedWallet) {
        // Native SIWS - wallet shows nice UI
        // Use getWalletFeature to properly access the feature implementation
        const feature = getWalletFeature(
          connectedWallet,
          SolanaSignIn,
        ) as SolanaSignInFeature[typeof SolanaSignIn];

        const [result] = await feature.signIn(input);
        messageBytes = result.signedMessage;
        signature = result.signature;
        signedAddress = result.account.address;
      } else if (walletSession.signMessage) {
        // Fallback: construct CAIP-122 message and use signMessage
        const message = constructSIWSMessage(input);
        messageBytes = new TextEncoder().encode(message);
        signature = await walletSession.signMessage(messageBytes);
        signedAddress = walletSession.account.address;
      } else {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: "Your wallet does not support message signing",
        }));
        return;
      }

      // 4. Verify signature with server (server sets HTTP-only cookie)
      const { address } = await fetchVerify({
        signedMessage: btoa(String.fromCharCode(...messageBytes)),
        signature: btoa(String.fromCharCode(...signature)),
        address: signedAddress,
        nonce,
      });

      setState({
        isAuthenticated: true,
        address,
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
