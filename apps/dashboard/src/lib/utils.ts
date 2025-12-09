import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely open an external URL in a new tab.
 * Includes noopener and noreferrer to prevent window.opener attacks.
 */
export function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
