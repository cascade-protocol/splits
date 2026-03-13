/**
 * Claude Code Configuration Management
 *
 * Manipulates ~/.claude/settings.json to add/remove MCP servers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLAUDE_CONFIG_DIR = path.join(os.homedir(), ".claude");
const SETTINGS_FILE = path.join(CLAUDE_CONFIG_DIR, "settings.json");

/**
 * MCP server configuration entry.
 */
interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Claude Code settings.json structure (partial).
 */
interface ClaudeSettings {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

/**
 * Load Claude Code settings.
 *
 * @returns Parsed settings or empty object
 */
function loadSettings(): ClaudeSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return {};
    }
    const content = fs.readFileSync(SETTINGS_FILE, "utf-8");
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Save Claude Code settings.
 *
 * Creates config directory if it doesn't exist.
 */
function saveSettings(settings: ClaudeSettings): void {
  if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
    fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/**
 * Add an MCP server to Claude Code config.
 *
 * Creates config if it doesn't exist.
 * Uses cascade CLI as the command with mcp proxy subcommand.
 *
 * @param service - Service path (e.g., "@cascade/twitter")
 */
export async function addMcpServer(service: string): Promise<void> {
  const settings = loadSettings();

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  // Key format matches service path
  settings.mcpServers[service] = {
    command: "cascade",
    args: ["mcp", "proxy", service],
  };

  saveSettings(settings);
}

/**
 * Remove an MCP server from Claude Code config.
 *
 * No-op if server doesn't exist.
 *
 * @param service - Service path (e.g., "@cascade/twitter")
 */
export async function removeMcpServer(service: string): Promise<void> {
  const settings = loadSettings();

  if (settings.mcpServers?.[service]) {
    delete settings.mcpServers[service];
    saveSettings(settings);
  }
}

/**
 * List all Cascade MCP servers.
 *
 * @returns Array of service paths that use cascade proxy
 */
export async function listMcpServers(): Promise<string[]> {
  const settings = loadSettings();
  const servers: string[] = [];

  if (!settings.mcpServers) {
    return servers;
  }

  for (const [name, config] of Object.entries(settings.mcpServers)) {
    // Only list servers that use cascade proxy
    if (
      config.command === "cascade" &&
      config.args?.[0] === "mcp" &&
      config.args?.[1] === "proxy"
    ) {
      servers.push(name);
    }
  }

  return servers;
}

/**
 * Check if a service is already configured.
 *
 * @param service - Service path (e.g., "@cascade/twitter")
 */
export async function hasServer(service: string): Promise<boolean> {
  const settings = loadSettings();
  return !!settings.mcpServers?.[service];
}
