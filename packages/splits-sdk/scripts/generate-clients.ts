#!/usr/bin/env npx tsx
/**
 * Generate Codama clients from Anchor IDL
 *
 * This script:
 * 1. Loads the Anchor IDL
 * 2. Converts to Codama tree
 * 3. Applies visitors to fix Anchor IDL limitations:
 *    - Self-referencing PDA seeds
 *    - #[repr(C)] padding not encoded in Anchor IDL
 * 4. Renders @solana/kit compatible TypeScript client
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  createFromRoot,
  bytesTypeNode,
  bytesValueNode,
  constantValueNode,
  hiddenSuffixTypeNode,
  structFieldTypeNode,
  isNode,
  instructionRemainingAccountsNode,
  argumentValueNode,
} from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";
import {
  updateInstructionsVisitor,
  bottomUpTransformerVisitor,
} from "@codama/visitors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load Anchor IDL
const idlPath = path.join(__dirname, "..", "idl.json");
const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));

// Convert Anchor IDL to Codama tree
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

// Fix Anchor IDL limitations and add remaining accounts support
codama.update(
  updateInstructionsVisitor({
    // closeSplitConfig: remove self-referencing PDA default value
    closeSplitConfig: {
      accounts: {
        splitConfig: { defaultValue: undefined },
      },
    },
    // updateSplitConfig: remove self-referencing PDA + add remaining accounts for ATA validation
    updateSplitConfig: {
      accounts: {
        splitConfig: { defaultValue: undefined },
      },
      remainingAccounts: [
        instructionRemainingAccountsNode(argumentValueNode("recipientAtas"), {
          isWritable: false,
          docs: ["ATAs for validating recipient addresses exist"],
        }),
      ],
    },
    // executeSplit: remove self-referencing PDA + add writable remaining accounts for transfers
    executeSplit: {
      accounts: {
        splitConfig: { defaultValue: undefined },
      },
      remainingAccounts: [
        instructionRemainingAccountsNode(argumentValueNode("recipientAtas"), {
          isWritable: true,
          docs: ["Recipient ATAs followed by protocol ATA as last account"],
        }),
      ],
    },
  }),
);

// Fix Anchor IDL limitation: #[repr(C)] padding not encoded in IDL
// SplitConfig uses zero_copy with #[repr(C)] which adds alignment padding:
// - 1 byte after recipientCount (for 2-byte alignment before recipients array)
// - 4 bytes after recipients array (for 8-byte alignment before unclaimedAmounts)
// Without this fix, generated size is 1827 bytes instead of actual 1832 bytes
codama.update(
  bottomUpTransformerVisitor([
    {
      // Add 1 byte padding after recipientCount field in SplitConfig
      select: "[accountNode]splitConfig.[structFieldTypeNode]recipientCount",
      transform: (node) => {
        if (!isNode(node, "structFieldTypeNode")) return node;
        return structFieldTypeNode({
          ...node,
          type: hiddenSuffixTypeNode(node.type, [
            constantValueNode(bytesTypeNode(), bytesValueNode("base16", "00")),
          ]),
        });
      },
    },
    {
      // Add 4 bytes padding after recipients field in SplitConfig
      select: "[accountNode]splitConfig.[structFieldTypeNode]recipients",
      transform: (node) => {
        if (!isNode(node, "structFieldTypeNode")) return node;
        return structFieldTypeNode({
          ...node,
          type: hiddenSuffixTypeNode(node.type, [
            constantValueNode(
              bytesTypeNode(),
              bytesValueNode("base16", "00000000"),
            ),
          ]),
        });
      },
    },
  ]),
);

// Render JavaScript client
const outputDir = path.join(__dirname, "..", "src", "solana", "generated");
codama.accept(
  renderJavaScriptVisitor(outputDir, {
    deleteFolderBeforeRendering: true,
    formatCode: true,
    useGranularImports: false,
  }),
);

console.log(`✓ Generated client in ${outputDir}`);
