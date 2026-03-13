/**
 * WebSocket Tunnel Client
 *
 * Connects to Gateway ServiceBridge DO for supplier tunnel.
 *
 * Per Cloudflare DO best practices:
 * - Use exponential backoff with jitter for reconnection
 * - Check `.retryable` property on errors - if true, retry is suggested
 * - Check `.overloaded` property - if true, do NOT retry (makes things worse)
 * - Create new WebSocket on each reconnect (old stubs may be "broken")
 */

import WebSocket from "ws";

const GATEWAY_WS_URL = "wss://market.cascade.fyi";
const BASE_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL = 30000; // 30s keepalive

/**
 * Cloudflare error properties per DO best practices.
 */
interface CloudflareError extends Error {
  retryable?: boolean; // If true, retry is suggested
  overloaded?: boolean; // If true, do NOT retry
  remote?: boolean; // If true, error from DO code (not infra)
}

/**
 * Request from Gateway to CLI (matches ServiceBridge).
 */
export interface TunnelRequest {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Response from CLI to Gateway.
 */
export interface TunnelResponse {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Tunnel connection status.
 */
export type TunnelStatus =
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "overloaded";

/**
 * WebSocket tunnel client with automatic reconnection.
 */
export class TunnelClient {
  private ws: WebSocket | null = null;
  private requestHandler:
    | ((req: TunnelRequest) => Promise<TunnelResponse>)
    | null = null;
  private servicePath = "";
  private token = "";
  private reconnectAttempt = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;
  private onStatusChange?: (status: TunnelStatus) => void;

  /**
   * Connect to the Gateway tunnel.
   *
   * @param servicePath - Service path (e.g., "@cascade/twitter")
   * @param token - Service token for authentication
   * @param options - Optional callbacks
   */
  async connect(
    servicePath: string,
    token: string,
    options?: { onStatusChange?: (status: TunnelStatus) => void },
  ): Promise<void> {
    this.servicePath = servicePath;
    this.token = token;
    this.onStatusChange = options?.onStatusChange;
    return this.doConnect();
  }

  private async doConnect(): Promise<void> {
    // Create fresh WebSocket for each attempt (per Cloudflare best practices)
    const url = `${GATEWAY_WS_URL}/mcps/${this.servicePath}/tunnel/connect`;
    const ws = new WebSocket(url, {
      headers: { "X-SERVICE-TOKEN": this.token },
    });
    this.ws = ws;

    return new Promise((resolve, reject) => {
      ws.on("open", () => {
        this.reconnectAttempt = 0;
        this.startPing();
        this.onStatusChange?.("connected");
        resolve();
      });

      ws.on("error", (err: CloudflareError) => {
        // Check Cloudflare-specific error properties
        if (err.overloaded) {
          // DO is overloaded - do NOT retry (makes things worse)
          this.shouldReconnect = false;
          this.onStatusChange?.("overloaded");
          reject(new Error("Service overloaded. Please try again later."));
          return;
        }

        if (this.reconnectAttempt === 0) {
          reject(err);
        }
        // If err.retryable is true, the close handler will trigger reconnect
      });

      ws.on("close", () => {
        this.stopPing();
        if (
          this.shouldReconnect &&
          this.reconnectAttempt < MAX_RECONNECT_ATTEMPTS
        ) {
          this.scheduleReconnect();
        } else if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
          this.onStatusChange?.("disconnected");
        }
      });

      ws.on("pong", () => {
        // Keepalive acknowledged - connection is healthy
      });

      ws.on("message", async (data) => {
        const msg = data.toString();
        if (msg === "pong") return; // Server auto-response

        try {
          const req = JSON.parse(msg) as TunnelRequest;
          if (req.type === "request" && this.requestHandler) {
            const resp = await this.requestHandler(req);
            this.ws?.send(JSON.stringify(resp));
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping(); // Server has auto-response configured
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    // Exponential backoff with jitter (per Cloudflare best practices)
    const backoffMs = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * Math.random() * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt++;
    this.onStatusChange?.("reconnecting");

    setTimeout(async () => {
      try {
        await this.doConnect();
      } catch {
        // doConnect will schedule another reconnect via 'close' event
      }
    }, backoffMs);
  }

  /**
   * Register a handler for incoming requests.
   */
  onRequest(handler: (req: TunnelRequest) => Promise<TunnelResponse>): void {
    this.requestHandler = handler;
  }

  /**
   * Disconnect from the tunnel.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();
    this.ws?.close();
    this.onStatusChange?.("disconnected");
  }
}
