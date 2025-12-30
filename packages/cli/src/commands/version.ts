import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import pkg from "../../package.json";

export const versionCommand = buildCommand({
  func() {
    console.log(`${pc.bold(pkg.name)} ${pc.dim(`v${pkg.version}`)}`);
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
  },
  docs: {
    brief: "Show version information",
  },
});
