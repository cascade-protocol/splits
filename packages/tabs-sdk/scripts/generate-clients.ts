#!/usr/bin/env npx tsx
/**
 * Generate Codama clients from Squads Smart Account Anchor IDL
 *
 * This script:
 * 1. Loads the Squads Smart Account Anchor IDL
 * 2. Converts to Codama tree
 * 3. Updates program address (not in old IDL format)
 * 4. Renders @solana/kit compatible TypeScript client
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";
import { updateProgramsVisitor } from "@codama/visitors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Program address (mainnet + devnet)
const PROGRAM_ADDRESS = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";

// Load Anchor IDL
const idlPath = path.join(__dirname, "..", "idl.json");
const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));

// Convert Anchor IDL to Codama tree
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

// Set program address (old Anchor IDL format doesn't include it in parsed output)
codama.update(
	updateProgramsVisitor({
		squadsSmartAccountProgram: {
			publicKey: PROGRAM_ADDRESS,
		},
	}),
);

// Render JavaScript client
const outputDir = path.join(__dirname, "..", "src", "generated");
codama.accept(
	renderJavaScriptVisitor(outputDir, {
		deleteFolderBeforeRendering: true,
		formatCode: true,
		useGranularImports: false,
	}),
);

console.log(`✓ Generated client in ${outputDir}`);
