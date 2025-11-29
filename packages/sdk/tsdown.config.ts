import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"solana/index": "src/solana/index.ts",
		"solana/web3-compat": "src/solana/web3-compat/index.ts",
		"solana/generated": "src/solana/generated/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	// Don't bundle dependencies - let consumers provide them
	// Prevents Node.js-only code from @solana/web3.js breaking browser builds
	external: [/^@solana\//, "bs58"],
});
