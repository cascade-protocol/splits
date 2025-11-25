import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		kit: "src/kit/index.ts",
		react: "src/react/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
});
