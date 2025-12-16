import { buildApplication, buildRouteMap } from "@stricli/core";
import pkg from "../package.json";
import { versionCommand } from "./commands/version";
import { loginCommand } from "./commands/login";
import { statusCommand } from "./commands/status";
import { serveCommand } from "./commands/serve";
import { mcpRoutes } from "./commands/mcp";

const routes = buildRouteMap({
  routes: {
    version: versionCommand,
    login: loginCommand,
    status: statusCommand,
    serve: serveCommand,
    mcp: mcpRoutes,
  },
  docs: {
    brief: pkg.description ?? "Cascade CLI",
  },
});

export const app = buildApplication(routes, {
  name: pkg.name,
  versionInfo: {
    currentVersion: pkg.version,
  },
});
