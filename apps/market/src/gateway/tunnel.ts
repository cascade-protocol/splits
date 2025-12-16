/**
 * TunnelRelay Durable Object
 *
 * Handles WebSocket connections from supplier CLIs and forwards
 * MCP requests to them. Uses WebSocket Hibernation for cost efficiency.
 *
 * Per ADR-0004 §4.7: Service config is stored here from the service token
 * when CLI connects, not in D1.
 */

import { DurableObject } from "cloudflare:workers";
import { verifyServiceToken, decodeServiceToken } from "../server/tokens";
import type { ServiceConfig } from "./index";

/**
 * Session state attached to WebSocket (survives hibernation)
 * Kept minimal to stay under 2KB attachment limit
 */
interface TunnelSession {
  servicePath: string; // @namespace/name
  config: ServiceConfig;
  connectedAt: number;
}

interface TunnelRequest {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface TunnelResponse {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Cloudflare env type
interface Env {
  DB: D1Database;
  TUNNEL_RELAY: DurableObjectNamespace;
  TOKEN_SECRET?: string;
}

export class TunnelRelay extends DurableObject<Env> {
  // Active WebSocket connections from supplier CLIs
  sessions: Map<WebSocket, TunnelSession>;

  // Pending requests waiting for responses
  pendingRequests: Map<
    string,
    {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
    this.pendingRequests = new Map();

    // Restore hibernated WebSockets
    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, attachment as TunnelSession);
      }
    });

    // Auto-respond to pings without waking DO
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Config endpoint - returns service config to Gateway
    // Used by Gateway to check if service is online and get pricing
    if (url.pathname === "/config") {
      return this.handleConfigRequest();
    }

    // CLI connects via WebSocket at /tunnel/connect
    if (url.pathname === "/tunnel/connect") {
      return this.handleTunnelConnect(request);
    }

    // MCP request - forward to active tunnel
    return this.forwardToTunnel(request);
  }

  /**
   * Returns service config if CLI is connected, 503 if offline
   */
  private handleConfigRequest(): Response {
    const activeSession = Array.from(this.sessions.values())[0];

    if (!activeSession) {
      return new Response(JSON.stringify({ error: "Service offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(activeSession.config), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleTunnelConnect(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Validate service token from header
    const token = request.headers.get("X-SERVICE-TOKEN");
    if (!token) {
      return new Response("Missing service token", { status: 401 });
    }

    // Verify token format
    if (!token.startsWith("csc_")) {
      return new Response("Invalid token format", { status: 401 });
    }

    // Decode and extract service info
    const tokenPayload = decodeServiceToken(token);
    if (!tokenPayload) {
      return new Response("Failed to decode token", { status: 401 });
    }

    // Verify HMAC signature
    if (!this.env.TOKEN_SECRET) {
      console.error("TOKEN_SECRET environment variable not configured");
      return new Response("Server configuration error", { status: 500 });
    }
    const isValid = await verifyServiceToken(this.env.TOKEN_SECRET, token);
    if (!isValid) {
      return new Response("Invalid token signature", { status: 401 });
    }

    // Check token expiration (per ADR-0004 §4.8)
    if (tokenPayload.expiresAt && tokenPayload.expiresAt < Date.now()) {
      return new Response("Token expired", { status: 401 });
    }

    // Create WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept with hibernation support
    this.ctx.acceptWebSocket(server);

    // Build service path and config from token
    const servicePath = `@${tokenPayload.namespace}/${tokenPayload.name}`;
    const config: ServiceConfig = {
      namespace: tokenPayload.namespace,
      name: tokenPayload.name,
      splitConfig: tokenPayload.splitConfig,
      splitVault: tokenPayload.splitVault,
      price: String(tokenPayload.price),
    };

    // Store session state (survives hibernation)
    // Note: token not stored - already validated, and keeping attachment small
    const session: TunnelSession = {
      servicePath,
      config,
      connectedAt: Date.now(),
    };

    server.serializeAttachment(session);
    this.sessions.set(server, session);

    console.log(
      `Tunnel connected: ${servicePath}, ${this.sessions.size} active sessions`,
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  private async forwardToTunnel(request: Request): Promise<Response> {
    // Find active WebSocket for this service
    const activeWs = Array.from(this.sessions.keys())[0];

    if (!activeWs) {
      return new Response(
        JSON.stringify({
          error: "Service offline",
          message: "No active tunnel connection",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Create request ID for correlation
    const requestId = crypto.randomUUID();

    // Build tunnel request message
    const tunnelRequest: TunnelRequest = {
      type: "request",
      id: requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    };

    // Create promise for response
    const responsePromise = new Promise<Response>((resolve, reject) => {
      // Set timeout for response
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Tunnel request timeout"));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    // Send request to CLI via WebSocket
    activeWs.send(JSON.stringify(tunnelRequest));

    try {
      return await responsePromise;
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Tunnel error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    try {
      // Handle both string and ArrayBuffer messages
      const messageStr =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      const data = JSON.parse(messageStr) as TunnelResponse;

      if (data.type === "response") {
        const pending = this.pendingRequests.get(data.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(data.id);

          pending.resolve(
            new Response(data.body, {
              status: data.status,
              headers: data.headers,
            }),
          );
        }
      }

      // Update last activity timestamp for this session
      const session = this.sessions.get(ws);
      if (session) {
        session.connectedAt = Date.now();
        ws.serializeAttachment(session);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    const session = this.sessions.get(ws);
    console.log(
      `WebSocket closed: ${session?.servicePath ?? "unknown"}, code=${code}, reason=${reason}, wasClean=${wasClean}`,
    );
    this.sessions.delete(ws);

    // If no more connections, reject all pending requests
    if (this.sessions.size === 0) {
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Tunnel disconnected"));
      }
      this.pendingRequests.clear();
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const session = this.sessions.get(ws);
    console.error(
      `WebSocket error for ${session?.servicePath ?? "unknown"}:`,
      error,
    );
    this.sessions.delete(ws);

    // If no more connections, reject all pending requests
    if (this.sessions.size === 0) {
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Tunnel error"));
      }
      this.pendingRequests.clear();
    }
  }
}
