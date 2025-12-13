/**
 * Framework-kit adapter for Cascade Splits SDK
 *
 * Converts a WalletSession from @solana/client (framework-kit) into a
 * TransactionSigner compatible with @solana/kit and ensureSplitConfig.
 *
 * @example
 * ```typescript
 * import { useSolanaClient, useWalletConnection } from '@solana/react-hooks';
 * import { ensureSplitConfig } from '@cascade-fyi/splits-sdk';
 * import { fromFrameworkKit } from '@cascade-fyi/splits-sdk/adapters/framework-kit';
 *
 * function MyComponent() {
 *   const client = useSolanaClient();
 *   const { wallet } = useWalletConnection();
 *   const { rpc, rpcSubscriptions } = client.runtime;
 *
 *   const handleCreate = async () => {
 *     const signer = fromFrameworkKit(wallet);
 *     const result = await ensureSplitConfig({
 *       rpc,
 *       rpcSubscriptions,
 *       signer,
 *       recipients: [{ address: signer.address, share: 100 }],
 *     });
 *   };
 * }
 * ```
 */

import type {
  Address,
  Commitment,
  Signature,
  SignatureBytes,
  SignatureDictionary,
  Transaction,
  TransactionSendingSigner,
  TransactionSigner,
  TransactionPartialSigner,
  TransactionWithLifetime,
  TransactionWithinSizeLimit,
} from "@solana/kit";
import { signatureBytes, getBase58Encoder } from "@solana/kit";

/**
 * Minimal interface matching WalletSession from @solana/client.
 * Defined here to avoid adding @solana/client as a dependency.
 * Compatible with framework-kit's useWalletConnection().wallet
 *
 * Note: Uses looser types than the actual WalletSession to allow structural
 * compatibility without importing branded types from @solana/client.
 */
export interface FrameworkKitWalletSession {
  account: {
    address: Address;
    publicKey: Uint8Array;
  };
  /** Signs transaction and returns the signed transaction */
  signTransaction?(transaction: Transaction): Promise<Transaction>;
  /** Signs and sends transaction, returns signature */
  sendTransaction?(
    transaction: Transaction,
    config?: Readonly<{ commitment?: Commitment }>,
  ): Promise<Signature>;
}

/**
 * Result of creating a signer from framework-kit wallet.
 */
export interface FrameworkKitSigner {
  /** The signer mode - 'partial' can sign without sending, 'send' must send */
  mode: "partial" | "send";
  /** The TransactionSigner to use with ensureSplitConfig */
  signer: TransactionSigner;
}

/**
 * Create a TransactionSigner from a framework-kit WalletSession.
 *
 * Returns the most capable signer the wallet supports:
 * - If wallet has `signTransaction`: returns a partial signer (can sign without sending)
 * - If wallet only has `sendTransaction`: returns a sending signer (must send immediately)
 *
 * @param session - Connected wallet session from useWalletConnection()
 * @param config - Optional configuration (commitment for sending signer)
 * @returns Object with the signer and its mode
 * @throws Error if wallet doesn't support signing or sending
 */
export function fromFrameworkKit(
  session: FrameworkKitWalletSession,
  config?: { commitment?: Commitment },
): FrameworkKitSigner {
  const address = session.account.address;
  const commitment = config?.commitment;

  // Prefer signTransaction if available (more flexible)
  if (session.signTransaction) {
    const signTransaction = session.signTransaction.bind(session);

    const partialSigner: TransactionPartialSigner = {
      address,
      async signTransactions(
        transactions: readonly (Transaction &
          TransactionWithinSizeLimit &
          TransactionWithLifetime)[],
      ): Promise<readonly SignatureDictionary[]> {
        const signatures: SignatureDictionary[] = [];

        for (const transaction of transactions) {
          // WalletSession.signTransaction returns the signed transaction
          // We extract signatures from the returned transaction
          const signed = await signTransaction(transaction);
          // SignaturesMap allows null, so we need to check
          const signature = signed.signatures[address];
          if (signature === undefined || signature === null) {
            throw new Error(
              "Wallet did not produce a signature for the expected address",
            );
          }
          signatures.push({ [address]: signature });
        }

        return signatures;
      },
    };

    return { mode: "partial", signer: partialSigner };
  }

  // Fall back to sendTransaction
  if (session.sendTransaction) {
    const base58Encoder = getBase58Encoder();
    const sendTransaction = session.sendTransaction.bind(session);

    const sendingSigner: TransactionSendingSigner = {
      address,
      async signAndSendTransactions(
        transactions: readonly (
          | Transaction
          | (Transaction & TransactionWithLifetime)
        )[],
      ): Promise<readonly SignatureBytes[]> {
        const signatures: SignatureBytes[] = [];

        for (const transaction of transactions) {
          const signatureString = await sendTransaction(
            transaction,
            commitment ? { commitment } : undefined,
          );
          const bytes = base58Encoder.encode(signatureString);
          signatures.push(signatureBytes(bytes));
        }

        return signatures;
      },
    };

    return { mode: "send", signer: sendingSigner };
  }

  throw new Error(
    "Wallet session does not support signing or sending transactions. " +
      "Please use a wallet that supports transaction signing.",
  );
}

/**
 * Convenience function that returns just the signer (without mode info).
 * Use this when you just need the signer and don't care about the mode.
 */
export function signerFromFrameworkKit(
  session: FrameworkKitWalletSession,
  config?: { commitment?: Commitment },
): TransactionSigner {
  return fromFrameworkKit(session, config).signer;
}
