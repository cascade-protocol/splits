import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { createTokenAmount } from "@solana/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// =============================================================================
// Token Amount Math (from @solana/client)
// =============================================================================

/** USDC amount math (6 decimals) */
export const usdc = createTokenAmount(6);

/** SOL amount math (9 decimals) */
export const sol = createTokenAmount(9);

/**
 * Safely open an external URL in a new tab.
 * Includes noopener and noreferrer to prevent window.opener attacks.
 */
export function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
