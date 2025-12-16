/**
 * Serve Command
 *
 * Supplier tunnel for local MCP server.
 * Connects to Gateway ServiceBridge DO and relays requests to local endpoint.
 */

import { buildCommand, type CommandContext } from "@stricli/core";
import { intro, spinner, log } from "@clack/prompts";
import pc from "picocolors";
import {
  TunnelClient,
  type TunnelRequest,
  type TunnelResponse,
  type TunnelStatus,
} from "../lib/tunnel";
import {
  decodeServiceToken,
  isTokenExpired,
  getServicePath,
  formatPrice,
} from "../lib/tokens";

interface ServeFlags {
  token: string;
}

export const serveCommand = buildCommand({
  docs: {
    brief: "Serve local MCP via Cascade Market tunnel",
  },
  parameters: {
    flags: {
      token: {
        kind: "parsed",
        parse: String,
        brief: "Service token from market.cascade.fyi/services",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Local MCP endpoint (e.g., localhost:3000)",
          parse: String,
        },
      ],
    },
  },
  async func(
    this: CommandContext,
    { token }: ServeFlags,
    localEndpoint: string,
  ) {
    intro(pc.cyan("Cascade Market - Serve"));

    // 1. Decode and validate token
    const payload = decodeServiceToken(token);
    if (!payload) {
      throw new Error(
        "Invalid service token. Get one at market.cascade.fyi/services",
      );
    }

    if (isTokenExpired(payload)) {
      throw new Error(
        "Service token expired. Generate a new one at market.cascade.fyi/services",
      );
    }

    const servicePath = getServicePath(payload);
    const s = spinner();
    s.start(`Connecting to ${servicePath}`);

    // 2. Connect WebSocket tunnel
    const tunnel = new TunnelClient();
    let requestCount = 0;

    await tunnel.connect(servicePath, token, {
      onStatusChange: (status: TunnelStatus) => {
        switch (status) {
          case "connected":
            // Initial connection handled below
            break;
          case "reconnecting":
            log.warn("Connection lost, reconnecting...");
            break;
          case "disconnected":
            log.error("Disconnected from Gateway");
            process.exit(1);
            break;
          case "overloaded":
            log.error("Service overloaded. Please try again later.");
            process.exit(1);
            break;
        }
      },
    });

    s.stop(`Connected: ${pc.green(servicePath)}`);
    console.log(`  ${pc.dim("Price:")} ${formatPrice(payload.price)}/call`);
    console.log(`  ${pc.dim("Local:")} http://${localEndpoint}`);
    console.log(
      `  ${pc.dim("Live at:")} ${pc.blue(`market.cascade.fyi/mcps/${servicePath}`)}`,
    );
    console.log();
    console.log(pc.dim("Press Ctrl+C to stop"));
    console.log();

    // 3. Handle incoming requests
    tunnel.onRequest(async (req: TunnelRequest): Promise<TunnelResponse> => {
      requestCount++;
      const startTime = Date.now();

      try {
        // Forward to local endpoint
        const resp = await fetch(`http://${localEndpoint}${req.path}`, {
          method: req.method,
          headers: req.headers,
          body: req.body || undefined,
        });

        const body = await resp.text();
        const duration = Date.now() - startTime;

        // Log request
        const statusColor = resp.status < 400 ? pc.green : pc.red;
        console.log(
          `${pc.dim(`#${requestCount}`)} ${req.method} ${req.path} ${statusColor(resp.status)} ${pc.dim(`${duration}ms`)}`,
        );

        return {
          type: "response",
          id: req.id,
          status: resp.status,
          headers: Object.fromEntries(resp.headers),
          body,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        console.log(
          `${pc.dim(`#${requestCount}`)} ${req.method} ${req.path} ${pc.red("502")} ${pc.dim(`${duration}ms`)} ${pc.red(error instanceof Error ? error.message : "Error")}`,
        );

        return {
          type: "response",
          id: req.id,
          status: 502,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Local MCP error",
            message: error instanceof Error ? error.message : "Unknown error",
          }),
        };
      }
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log();
      log.info("Shutting down...");
      tunnel.disconnect();
      process.exit(0);
    });

    // Keep process running
    await new Promise(() => {});
  },
});
