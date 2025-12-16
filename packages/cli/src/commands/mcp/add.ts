/**
 * MCP Add Command
 *
 * Add a Cascade MCP server to Claude Code config.
 */

import { buildCommand, type CommandContext } from "@stricli/core";
import { intro, outro, spinner, confirm } from "@clack/prompts";
import pc from "picocolors";
import { requireCredentials } from "../../lib/auth";
import { addMcpServer, hasServer } from "../../lib/config";

const GATEWAY_URL = "https://market.cascade.fyi";

/**
 * Service metadata from Gateway.
 */
interface ServiceMetadata {
  namespace: string;
  name: string;
  description: string;
  price: number;
}

export const addCommand = buildCommand({
  docs: {
    brief: "Add MCP server to Claude Code",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Service path (e.g., @cascade/twitter)",
          parse: String,
        },
      ],
    },
  },
  async func(this: CommandContext, _: object, service: string) {
    intro(pc.cyan("Cascade MCP - Add"));

    // Ensure logged in
    await requireCredentials();

    const s = spinner();

    // Check if already configured
    if (await hasServer(service)) {
      const shouldOverwrite = await confirm({
        message: `${service} is already configured. Overwrite?`,
      });
      if (!shouldOverwrite || shouldOverwrite === Symbol.for("cancel")) {
        outro("Cancelled");
        return;
      }
    }

    // Validate service exists on Gateway
    s.start(`Checking ${service}`);

    const response = await fetch(
      `${GATEWAY_URL}/api/services/${encodeURIComponent(service)}`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        s.stop(`Service not found`);
        throw new Error(
          `Service ${service} not found. Browse available services at market.cascade.fyi`,
        );
      }
      s.stop(`Check failed`);
      throw new Error(`Failed to validate service: ${response.statusText}`);
    }

    const metadata = (await response.json()) as ServiceMetadata;
    s.stop(`Found: ${metadata.description || service}`);

    // Show price info
    const priceUsd = metadata.price / 1_000_000;
    console.log(`  ${pc.dim("Price:")} $${priceUsd.toFixed(4)}/call`);
    console.log();

    // Add to Claude Code config
    s.start("Configuring Claude Code");
    await addMcpServer(service);
    s.stop("Configured");

    outro(
      `Added ${pc.green(service)} to Claude Code. Restart Claude Code to use it.`,
    );
  },
});
