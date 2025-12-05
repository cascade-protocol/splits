import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"client/index": "src/client/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	external: ["viem"],
});
