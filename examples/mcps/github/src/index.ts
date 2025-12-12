import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
// import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
// import type {
//   CallToolResult,
//   ReadResourceResult,
//   GetPromptResult,
// } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
// import * as z from "zod/v4";

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "github-mcp",
      version: "0.0.1",
    },
    {
      capabilities: {
        tools: {},
        // resources: {},  // Uncomment when adding resources
        // prompts: {},    // Uncomment when adding prompts
      },
      instructions: "GitHub MCP server for repository operations.",
    },
  );

  // ============================================================================
  // TOOLS - Actions the LLM can take (computation, side effects, network calls)
  // ============================================================================
  //
  // server.registerTool(
  //   "search-repos",
  //   {
  //     title: "Search Repositories",
  //     description: "Search GitHub repositories by query",
  //     inputSchema: {
  //       query: z.string().describe("Search query"),
  //       limit: z.number().optional().default(10).describe("Max results"),
  //     },
  //     annotations: {
  //       readOnlyHint: true,   // Tool doesn't modify state
  //       openWorldHint: true,  // Tool accesses external resources (GitHub API)
  //     },
  //   },
  //   async ({ query, limit }): Promise<CallToolResult> => {
  //     // Implementation here
  //     return {
  //       content: [{ type: "text", text: `Found repos for: ${query}` }],
  //     };
  //   },
  // );

  // ============================================================================
  // RESOURCES - Read-only data that clients can surface to users or models
  // ============================================================================
  //
  // Static resource (fixed URI):
  //
  // server.registerResource(
  //   "rate-limits",
  //   "github://rate-limits",
  //   {
  //     title: "GitHub Rate Limits",
  //     description: "Current GitHub API rate limit status",
  //     mimeType: "application/json",
  //   },
  //   async (): Promise<ReadResourceResult> => {
  //     return {
  //       contents: [
  //         {
  //           uri: "github://rate-limits",
  //           text: JSON.stringify({ remaining: 5000, reset: Date.now() }),
  //         },
  //       ],
  //     };
  //   },
  // );
  //
  // Dynamic resource template (URI with variables):
  //
  // server.registerResource(
  //   "repo-readme",
  //   new ResourceTemplate("github://repos/{owner}/{repo}/readme", {
  //     list: async () => {
  //       // Return list of known repos, or undefined if enumeration not supported
  //       return undefined;
  //     },
  //     complete: {
  //       owner: async (value) => ["octocat", "github"].filter(o => o.startsWith(value)),
  //       repo: async (value) => ["hello-world", "docs"].filter(r => r.startsWith(value)),
  //     },
  //   }),
  //   {
  //     title: "Repository README",
  //     description: "README file for a GitHub repository",
  //     mimeType: "text/markdown",
  //   },
  //   async (uri, { owner, repo }): Promise<ReadResourceResult> => {
  //     return {
  //       contents: [
  //         {
  //           uri: uri.href,
  //           text: `# ${owner}/${repo}\n\nREADME content here...`,
  //         },
  //       ],
  //     };
  //   },
  // );

  // ============================================================================
  // PROMPTS - Reusable templates for consistent model interactions
  // ============================================================================
  //
  // server.registerPrompt(
  //   "code-review",
  //   {
  //     title: "Code Review",
  //     description: "Review code changes in a pull request",
  //     argsSchema: {
  //       owner: z.string().describe("Repository owner"),
  //       repo: z.string().describe("Repository name"),
  //       pr: z.number().describe("Pull request number"),
  //     },
  //   },
  //   async ({ owner, repo, pr }): Promise<GetPromptResult> => {
  //     return {
  //       messages: [
  //         {
  //           role: "user",
  //           content: {
  //             type: "text",
  //             text: `Please review PR #${pr} in ${owner}/${repo}. Focus on:
  // 1. Code quality and best practices
  // 2. Potential bugs or edge cases
  // 3. Performance implications
  // 4. Security considerations`,
  //           },
  //         },
  //       ],
  //     };
  //   },
  // );

  return server;
}

const app = createMcpExpressApp();

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST for MCP requests.",
    },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message:
        "Method not allowed. Stateless server does not support sessions.",
    },
    id: null,
  });
});

app.listen(PORT, () => {
  console.log(`GitHub MCP server listening on http://localhost:${PORT}/mcp`);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  process.exit(0);
});
