/**
 * MCP Remove Command
 *
 * Remove a Cascade MCP server from Claude Code config.
 */

import { buildCommand, type CommandContext } from "@stricli/core";
import { intro, outro, spinner, confirm } from "@clack/prompts";
import pc from "picocolors";
import { removeMcpServer, hasServer } from "../../lib/config";

export const removeCommand = buildCommand({
  docs: {
    brief: "Remove MCP server from Claude Code",
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
    intro(pc.cyan("Cascade MCP - Remove"));

    // Check if configured
    if (!(await hasServer(service))) {
      outro(`${service} is not configured`);
      return;
    }

    // Confirm removal
    const shouldRemove = await confirm({
      message: `Remove ${service} from Claude Code?`,
    });

    if (!shouldRemove || shouldRemove === Symbol.for("cancel")) {
      outro("Cancelled");
      return;
    }

    const s = spinner();
    s.start("Removing from config");
    await removeMcpServer(service);
    s.stop("Removed");

    outro(
      `Removed ${pc.yellow(service)}. Restart Claude Code to apply changes.`,
    );
  },
});
