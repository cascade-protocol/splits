/**
 * Status Command
 *
 * Display account status including wallet, Tabs balance, and configured MCPs.
 */

import { buildCommand } from "@stricli/core";
import { intro, outro } from "@clack/prompts";
import pc from "picocolors";
import { type Address, createSolanaRpc } from "@solana/kit";
import { hasSmartAccount } from "@cascade-fyi/tabs-sdk";
import { requireCredentials } from "../lib/auth";
import { listMcpServers } from "../lib/config";

// Default RPC URL (can be overridden via env)
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

export const statusCommand = buildCommand({
  docs: {
    brief: "Show account status",
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
  },
  async func() {
    intro(pc.cyan("Cascade Status"));

    // Load and validate credentials
    const creds = await requireCredentials();

    console.log();
    console.log(pc.bold("Wallet"));
    console.log(`  ${pc.dim("Address:")} ${creds.walletAddress}`);

    // Check if Tabs account exists (lightweight check)
    const rpcUrl = process.env.HELIUS_RPC_URL || DEFAULT_RPC_URL;
    const rpc = createSolanaRpc(rpcUrl);

    const hasAccount = await hasSmartAccount(
      rpc,
      creds.walletAddress as Address,
    );

    console.log();
    console.log(pc.bold("Tabs Account"));
    if (hasAccount) {
      console.log(`  ${pc.dim("Status:")} ${pc.green("Active")}`);
      console.log(`  ${pc.dim("View details at:")} market.cascade.fyi/pay`);
    } else {
      console.log(`  ${pc.dim("Status:")} ${pc.yellow("Not set up")}`);
      console.log(`  ${pc.dim("Set up at:")} market.cascade.fyi/pay`);
    }

    // List configured MCPs
    const mcpServers = await listMcpServers();

    console.log();
    console.log(pc.bold("Configured MCPs"));
    if (mcpServers.length > 0) {
      for (const server of mcpServers) {
        console.log(`  ${pc.green("●")} ${server}`);
      }
    } else {
      console.log(`  ${pc.dim("None configured")}`);
      console.log(
        `  ${pc.dim("Add with:")} cascade mcp add @namespace/service`,
      );
    }

    outro(pc.dim("Run 'cascade help' for more commands"));
  },
});
