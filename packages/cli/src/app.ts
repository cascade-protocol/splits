import { buildApplication, buildRouteMap } from "@stricli/core";
import pkg from "../package.json";
import { versionCommand } from "./commands/version";

const routes = buildRouteMap({
  routes: {
    version: versionCommand,
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
