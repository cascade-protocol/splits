/**
 * OAuth Authorization Page (Consent Screen)
 *
 * This page is opened by MCP clients when requesting authorization.
 * User must be logged in (authenticated via SIWS) to approve.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { useState } from "react";
import { z } from "zod";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createAuthCode } from "@/server/oauth";

/**
 * Server function to create an auth code
 * Following Cloudflare docs pattern: env accessed inside createServerFn handler
 */
const createAuthCodeFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      userAddress: string;
      clientId: string;
      redirectUri: string;
      scope: string;
      codeChallenge: string;
    }) => data,
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        userAddress: string;
        clientId: string;
        redirectUri: string;
        scope: string;
        codeChallenge: string;
      };
    }) => {
      return createAuthCode(env.DB, {
        userAddress: data.userAddress,
        clientId: data.clientId,
        redirectUri: data.redirectUri,
        scope: data.scope,
        codeChallenge: data.codeChallenge,
      });
    },
  );

// Supported OAuth scopes
const SUPPORTED_SCOPES = ["tabs:spend", "services:read"] as const;

// Allowed redirect URI hosts for MCP clients (localhost only for security)
const ALLOWED_REDIRECT_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Validate redirect URI is localhost only
 * This prevents open redirect attacks - MCP clients run locally
 */
function validateRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return ALLOWED_REDIRECT_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate all requested scopes are supported
 */
function validateScopes(scopeString: string): {
  valid: boolean;
  invalidScopes: string[];
} {
  const scopes = scopeString.split(" ");
  const invalidScopes = scopes.filter(
    (s) => !SUPPORTED_SCOPES.includes(s as (typeof SUPPORTED_SCOPES)[number]),
  );
  return { valid: invalidScopes.length === 0, invalidScopes };
}

// OAuth authorize query params schema
const searchParamsSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  scope: z.string().optional().default("services:read"),
  state: z.string().optional(),
  code_challenge: z.string(),
  code_challenge_method: z.literal("S256"),
});

export const Route = createFileRoute("/oauth/authorize")({
  validateSearch: (search) => searchParamsSchema.parse(search),
  component: AuthorizePage,
});

function AuthorizePage() {
  const { isAuthenticated, address, signIn, isLoading } = useAuth();
  const searchParams = Route.useSearch();
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse scopes for display
  const scopes = searchParams.scope.split(" ");

  // Validate redirect URI (localhost only for MCP clients)
  const isValidRedirectUri = validateRedirectUri(searchParams.redirect_uri);

  // Validate requested scopes
  const scopeValidation = validateScopes(searchParams.scope);
  const isValidScopes = scopeValidation.valid;

  // Combined validation error
  const validationError = !isValidRedirectUri
    ? "Only localhost redirect URIs are allowed for MCP clients"
    : !isValidScopes
      ? `Invalid scopes requested: ${scopeValidation.invalidScopes.join(", ")}`
      : null;

  // Handle authorization approval
  const handleAuthorize = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!isAuthenticated || !address) {
      setError("You must be signed in to authorize");
      return;
    }

    setAuthorizing(true);
    setError(null);

    try {
      // Create authorization code
      const code = await createAuthCodeFn({
        data: {
          userAddress: address,
          clientId: searchParams.client_id,
          redirectUri: searchParams.redirect_uri,
          scope: searchParams.scope,
          codeChallenge: searchParams.code_challenge,
        },
      });

      // Redirect back to client with code
      const redirectUrl = new URL(searchParams.redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (searchParams.state) {
        redirectUrl.searchParams.set("state", searchParams.state);
      }

      // Use window.location for external redirect
      window.location.href = redirectUrl.toString();
    } catch (err) {
      console.error("Authorization failed:", err);
      setError(err instanceof Error ? err.message : "Authorization failed");
      setAuthorizing(false);
    }
  };

  // Handle denial
  const handleDeny = () => {
    const redirectUrl = new URL(searchParams.redirect_uri);
    redirectUrl.searchParams.set("error", "access_denied");
    redirectUrl.searchParams.set(
      "error_description",
      "User denied the request",
    );
    if (searchParams.state) {
      redirectUrl.searchParams.set("state", searchParams.state);
    }
    window.location.href = redirectUrl.toString();
  };

  // Scope descriptions
  const scopeDescriptions: Record<string, string> = {
    "tabs:spend": "Make payments using your Tabs spending limit",
    "services:read": "Read your service information",
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authorize Application</CardTitle>
          <CardDescription>
            <span className="font-mono text-sm">{searchParams.client_id}</span>{" "}
            wants to access your Cascade Market account.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Scopes requested */}
          <div>
            <h3 className="text-sm font-medium mb-2">Permissions requested:</h3>
            <ul className="space-y-2">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500">✓</span>
                  <div>
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {scope}
                    </span>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {scopeDescriptions[scope] || scope}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Validation error (redirect URI or scope) */}
          {validationError && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Request Invalid
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {validationError}
              </p>
            </div>
          )}

          {/* Sign in prompt if not authenticated */}
          {!isAuthenticated && !validationError && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                You must sign in with your wallet to authorize this application.
              </p>
            </div>
          )}

          {/* Runtime error display */}
          {error && !validationError && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Connected wallet info */}
          {isAuthenticated && address && (
            <div className="bg-muted rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Authorizing as:</p>
              <p className="font-mono text-sm truncate">{address}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={authorizing || !!validationError}
            className="flex-1"
          >
            Deny
          </Button>

          {validationError ? (
            <Button disabled className="flex-1">
              Cannot Authorize
            </Button>
          ) : isAuthenticated ? (
            <Button
              onClick={handleAuthorize}
              disabled={authorizing || isLoading}
              className="flex-1"
            >
              {authorizing ? "Authorizing..." : "Authorize"}
            </Button>
          ) : (
            <Button onClick={signIn} disabled={isLoading} className="flex-1">
              {isLoading ? "Loading..." : "Sign In to Continue"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
