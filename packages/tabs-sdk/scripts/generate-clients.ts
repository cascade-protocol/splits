#!/usr/bin/env npx tsx
/**
 * Generate Codama clients from Squads Smart Account Anchor IDL
 *
 * This script:
 * 1. Loads the Squads Smart Account Anchor IDL
 * 2. Converts to Codama tree
 * 3. Applies custom visitors to fix SmallVec types and duplicate accounts
 * 4. Renders @solana/kit compatible TypeScript client
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createFromRoot } from "codama";
import {
	type AnchorIdl,
	rootNodeFromAnchor,
	instructionAccountNodeFromAnchorV01,
} from "@codama/nodes-from-anchor";
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";
import { updateProgramsVisitor } from "@codama/visitors";
import {
	bottomUpTransformerVisitor,
	deleteNodesVisitor,
	rootNodeVisitor,
	visit,
} from "@codama/visitors-core";
import {
	type TypeNode,
	assertIsNode,
	numberTypeNode,
	arrayTypeNode,
	publicKeyTypeNode,
	prefixedCountNode,
	definedTypeLinkNode,
	camelCase,
} from "codama";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Program address (mainnet + devnet)
const PROGRAM_ADDRESS = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";

/**
 * SmallVec type mappings from IDL "defined" names to Codama type nodes
 *
 * Codama transforms "SmallVec<u8,u8>" from IDL into node name "smallVecU8U8"
 * (strips angle brackets and commas, joins with camelCase)
 *
 * SmallVec<LenType, ItemType> in Rust becomes:
 * - For u8 items: arrayTypeNode with prefixedCountNode
 * - For complex items: arrayTypeNode with prefixedCountNode wrapping definedTypeLinkNode
 */
function parseSmallVecType(definedName: string): TypeNode | null {
	// Match patterns like "smallVecU8U8", "smallVecU16U8", "smallVecU8Pubkey", "smallVecU8CompiledInstruction"
	// Codama transforms SmallVec<u8,u8> -> smallVecU8U8
	const match = definedName.match(/^smallVec(U8|U16|U32)(\w+)$/i);
	if (!match) return null;

	const [, lenType, itemType] = match;

	// Determine the length prefix type
	const lenNode = numberTypeNode(lenType.toLowerCase() as "u8" | "u16" | "u32");

	// Determine the item type
	let itemNode: TypeNode;
	const normalizedItemType = itemType.toLowerCase();
	switch (normalizedItemType) {
		case "u8":
			itemNode = numberTypeNode("u8");
			break;
		case "pubkey":
			itemNode = publicKeyTypeNode();
			break;
		default: {
			// For complex types like CompiledInstruction, MessageAddressTableLookup,
			// create a link to the actual type (first letter lowercase for camelCase)
			const typeName = itemType.charAt(0).toLowerCase() + itemType.slice(1);
			itemNode = definedTypeLinkNode(typeName);
			break;
		}
	}

	// Create array with prefixed count
	return arrayTypeNode(itemNode, prefixedCountNode(lenNode));
}

/**
 * Visitor that transforms SmallVec defined type links into proper codec structures
 *
 * The IDL references types like "SmallVec<u8,u8>" which Codama converts to
 * definedTypeLinkNode("smallVec<u8,U8>"). This visitor transforms those into
 * actual arrayTypeNode with prefixedCountNode for proper serialization.
 */
function smallVecTransformerVisitor() {
	return bottomUpTransformerVisitor([
		{
			select: "[definedTypeLinkNode]",
			transform: (node) => {
				assertIsNode(node, "definedTypeLinkNode");

				// Check if this is a SmallVec type
				const transformed = parseSmallVecType(node.name);
				if (transformed) {
					console.log(`  → Transformed SmallVec: ${node.name}`);
					return transformed;
				}

				return node;
			},
		},
	]);
}

/**
 * Visitor that deduplicates nested account names by prefixing with parent group name
 *
 * Issue: https://github.com/codama-idl/codama/issues/754
 *
 * When Anchor IDL has nested account groups like:
 *   { name: "transactionCreate", accounts: [{ name: "creator" }] }
 *   { name: "creator" }  // top-level
 *
 * Codama flattens them but keeps duplicate names, causing TS errors.
 * This visitor prefixes nested accounts with their parent group name.
 */
function accountDedupeVisitor(idl: AnchorIdl) {
	return rootNodeVisitor((node) => {
		const accountNodes = node.program.accounts;
		const instructionVisitor = bottomUpTransformerVisitor([
			{
				select: "[instructionNode]",
				transform: (instructionNode, _stack) => {
					assertIsNode(instructionNode, "instructionNode");

					// Find the IDL instruction
					const idlIx = idl.instructions.find(
						(ix) => camelCase(ix.name) === instructionNode.name,
					);
					if (!idlIx) return instructionNode;

					// Check for nested accounts (accounts with 'accounts' property)
					const hasNestedAccounts = idlIx.accounts.some(
						(acc: unknown) =>
							typeof acc === "object" &&
							acc !== null &&
							"accounts" in acc &&
							Array.isArray((acc as { accounts: unknown[] }).accounts),
					);
					if (!hasNestedAccounts) return instructionNode;

					// Rebuild accounts with prefixed names for nested ones
					const newAccounts = flattenAccountsWithPrefix(
						idlIx.accounts,
						accountNodes,
						instructionNode.arguments,
						null,
					);

					console.log(
						`  → Deduplicated accounts in instruction: ${instructionNode.name}`,
					);

					return {
						...instructionNode,
						accounts: newAccounts,
					};
				},
			},
		]);
		return visit(node, instructionVisitor);
	});
}

/**
 * Flatten nested accounts with parent prefix to avoid duplicate names
 */
function flattenAccountsWithPrefix(
	accounts: unknown[],
	accountNodes: unknown[],
	instructionArguments: unknown[],
	parentName: string | null,
): unknown[] {
	return accounts.flatMap((account: unknown) => {
		if (
			typeof account === "object" &&
			account !== null &&
			"accounts" in account
		) {
			// This is a nested account group
			const group = account as { name: string; accounts: unknown[] };
			const prefix = parentName ? `${parentName}_${group.name}` : group.name;
			return flattenAccountsWithPrefix(
				group.accounts,
				accountNodes,
				instructionArguments,
				prefix,
			);
		}

		// This is a leaf account
		const acc = account as { name: string };
		const newName = parentName ? `${parentName}_${acc.name}` : acc.name;

		// Use Codama's built-in function to create the node, then rename
		const node = instructionAccountNodeFromAnchorV01(
			accountNodes as Parameters<typeof instructionAccountNodeFromAnchorV01>[0],
			instructionArguments as Parameters<
				typeof instructionAccountNodeFromAnchorV01
			>[1],
			account as Parameters<typeof instructionAccountNodeFromAnchorV01>[2],
			accounts as Parameters<typeof instructionAccountNodeFromAnchorV01>[3],
		);

		return {
			...node,
			name: camelCase(newName),
		};
	});
}

// Load Anchor IDL
const idlPath = path.join(__dirname, "..", "idl.json");
const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8")) as AnchorIdl;

console.log("Generating Codama client...\n");

// Convert Anchor IDL to Codama tree
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

// Set program address
codama.update(
	updateProgramsVisitor({
		squadsSmartAccountProgram: {
			publicKey: PROGRAM_ADDRESS,
		},
	}),
);

// Apply SmallVec transformer
console.log("Applying SmallVec transformer...");
codama.update(smallVecTransformerVisitor());

// Apply account deduplication
console.log("Applying account deduplication...");
codama.update(accountDedupeVisitor(anchorIdl));

// Delete SmartAccountEvent type - its inner event types don't exist in IDL
console.log("Removing problematic SmartAccountEvent type...");
codama.update(deleteNodesVisitor(["[definedTypeNode]smartAccountEvent"]));

// Render JavaScript client
const outputDir = path.join(__dirname, "..", "src", "generated");
console.log("\nRendering TypeScript client...");
codama.accept(
	renderJavaScriptVisitor(outputDir, {
		deleteFolderBeforeRendering: true,
		formatCode: true,
		useGranularImports: false,
	}),
);

console.log(`\n✓ Generated client in ${outputDir}`);
