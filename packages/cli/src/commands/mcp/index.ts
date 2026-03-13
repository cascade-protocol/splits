/**
 * MCP Subcommand Router
 *
 * Commands for managing MCP servers in Claude Code.
 */

import { buildRouteMap } from "@stricli/core";
import { addCommand } from "./add";
import { removeCommand } from "./remove";
import { proxyCommand } from "./proxy";

export const mcpRoutes = buildRouteMap({
  routes: {
    add: addCommand,
    remove: removeCommand,
    proxy: proxyCommand,
  },
  docs: {
    brief: "Manage MCP servers",
  },
});
