/**
 * TunnelRelay Durable Object
 *
 * Handles WebSocket connections from CLI clients and forwards
 * MCP requests to them. Uses WebSocket Hibernation for cost efficiency.
 */

import { DurableObject } from "cloudflare:workers";
import { verifyServiceToken, decodeServiceToken } from "../server/tokens";

interface TunnelSession {
  serviceId: string;
  token: string;
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
  // Active WebSocket connections from CLI clients
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

    // CLI connects via WebSocket at /tunnel/connect
    if (url.pathname === "/tunnel/connect") {
      return this.handleTunnelConnect(request);
    }

    // MCP request - forward to active tunnel
    return this.forwardToTunnel(request);
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
    // Development fallback - DO NOT USE IN PRODUCTION
    const tokenSecret =
      this.env.TOKEN_SECRET || "cascade-market-dev-secret-change-in-production";
    const isValid = await verifyServiceToken(tokenSecret, token);
    if (!isValid) {
      return new Response("Invalid token signature", { status: 401 });
    }

    // Create WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept with hibernation support
    this.ctx.acceptWebSocket(server);

    // Store session state with actual service info (survives hibernation)
    const session: TunnelSession = {
      serviceId: tokenPayload.serviceId,
      token,
      connectedAt: Date.now(),
    };

    server.serializeAttachment(session);
    this.sessions.set(server, session);

    console.log(`Tunnel connected: ${this.sessions.size} active sessions`);

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
      const data = JSON.parse(message as string) as TunnelResponse;

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

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`);
    this.sessions.delete(ws);

    // Reject all pending requests for this connection
    // In a real implementation, we'd track which requests belong to which connection
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
    this.sessions.delete(ws);
  }
}
