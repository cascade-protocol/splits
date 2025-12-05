import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		generated: "src/generated/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	// Don't bundle @solana dependencies - let consumers provide them
	external: [/^@solana\//],
});
