/**
 * GitHub MCP Server
 *
 * 3 tools for fast GitHub repository access:
 * - repo: Repository info, files, tree, commits, branches, releases
 * - search: Search repos, code, issues/PRs
 * - discussions: Issues, PRs, and Discussions with comments
 *
 * Run with:
 *   pnpm dev                    # Development with hot reload
 *   GITHUB_TOKEN=xxx pnpm dev   # With authentication
 */

import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response } from "express";
import * as z from "zod/v4";

import {
  createGitHubClient,
  parseRepoRef,
  parseDiscussionRef,
  type GitHubClient,
} from "./client.js";
import type {
  RepoResult,
  SearchResult,
  DiscussionsResult,
  ErrorResult,
  FileContent,
  DirectoryEntry,
} from "./types.js";

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

const getClient = (): GitHubClient | null => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return createGitHubClient({ token });
};

// =============================================================================
// Tool Implementations
// =============================================================================

/**
 * repo - Repository operations
 *
 * Get repository info, files, tree structure, commits, branches, and releases.
 */
const repoTool = async (
  ref: string,
  include: string[],
  path?: string,
  branch?: string,
  maxResults = 30,
): Promise<RepoResult | ErrorResult> => {
  const client = getClient();
  if (!client) {
    return {
      error: "GITHUB_TOKEN not set",
      suggestion: "Set GITHUB_TOKEN environment variable",
    };
  }

  const parsed = parseRepoRef(ref);
  if (!parsed) {
    return {
      error: `Invalid repo reference: ${ref}`,
      suggestion: "Use format: owner/repo or https://github.com/owner/repo",
    };
  }

  const { owner, repo: repoName } = parsed;

  try {
    // Always fetch base repo info
    const repoData = await client.getRepository(owner, repoName);
    const result: RepoResult = { repo: repoData };

    // If path is provided, fetch that file/directory
    if (path) {
      const contents = await client.getFileContents(
        owner,
        repoName,
        path,
        branch,
      );

      // Check if it's a file or directory
      if (Array.isArray(contents)) {
        // Directory listing
        result.tree = (contents as DirectoryEntry[]).map((entry) => ({
          path: entry.path,
          mode: entry.type === "dir" ? "040000" : "100644",
          type: entry.type === "dir" ? "tree" : "blob",
          sha: entry.sha,
          size: entry.size,
          url: entry.html_url,
        }));
      } else {
        // File content
        const file = contents as FileContent;
        result.file = {
          path: file.path,
          content: Buffer.from(file.content, "base64").toString("utf-8"),
          size: file.size,
        };
      }
    }

    // Fetch optional includes
    if (include.includes("readme")) {
      try {
        result.readme = await client.getReadme(owner, repoName, branch);
      } catch {
        // README might not exist
      }
    }

    if (include.includes("tree")) {
      const treeRef = branch ?? repoData.default_branch;
      const tree = await client.getTree(owner, repoName, treeRef, true);
      result.tree = tree.tree;
    }

    if (include.includes("commits")) {
      result.commits = await client.getCommits(owner, repoName, {
        sha: branch,
        per_page: maxResults,
      });
    }

    if (include.includes("branches")) {
      result.branches = await client.getBranches(owner, repoName, {
        per_page: maxResults,
      });
    }

    if (include.includes("releases")) {
      result.releases = await client.getReleases(owner, repoName, {
        per_page: maxResults,
      });
    }

    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * search - Search GitHub
 *
 * Search repositories, code, or issues/PRs.
 */
const searchTool = async (
  query: string,
  type: "repos" | "code" | "issues",
  filters?: Record<string, string>,
  maxResults = 30,
): Promise<SearchResult | ErrorResult> => {
  const client = getClient();
  if (!client) {
    return {
      error: "GITHUB_TOKEN not set",
      suggestion: "Set GITHUB_TOKEN environment variable",
    };
  }

  // Build query with filters
  let fullQuery = query;
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        fullQuery += ` ${key}:${value}`;
      }
    }
  }

  try {
    switch (type) {
      case "repos": {
        const result = await client.searchRepositories(fullQuery, {
          per_page: maxResults,
        });
        return {
          type: "repos",
          query: fullQuery,
          total_count: result.total_count,
          items: result.items,
          has_more: result.total_count > maxResults,
        };
      }
      case "code": {
        const result = await client.searchCode(fullQuery, {
          per_page: maxResults,
        });
        return {
          type: "code",
          query: fullQuery,
          total_count: result.total_count,
          items: result.items,
          has_more: result.total_count > maxResults,
        };
      }
      case "issues": {
        const result = await client.searchIssues(fullQuery, {
          per_page: maxResults,
        });
        return {
          type: "issues",
          query: fullQuery,
          total_count: result.total_count,
          items: result.items,
          has_more: result.total_count > maxResults,
        };
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * discussions - Issues, PRs, and Discussions
 *
 * Get issue, PR, or discussion with optional comments, diff, files, reviews.
 */
const discussionsTool = async (
  ref: string,
  type?: "issue" | "pr" | "discussion",
  include: string[] = [],
  maxResults = 50,
): Promise<DiscussionsResult | ErrorResult> => {
  const client = getClient();
  if (!client) {
    return {
      error: "GITHUB_TOKEN not set",
      suggestion: "Set GITHUB_TOKEN environment variable",
    };
  }

  const parsed = parseDiscussionRef(ref);
  if (!parsed) {
    return {
      error: `Invalid discussion reference: ${ref}`,
      suggestion:
        "Use format: owner/repo#123, or URL like https://github.com/owner/repo/issues/123",
    };
  }

  const { owner, repo, number } = parsed;
  const itemType = type ?? parsed.type;

  try {
    switch (itemType) {
      case "issue": {
        const issue = await client.getIssue(owner, repo, number);

        // Check if this is actually a PR (issues API returns PRs too)
        if (issue.pull_request) {
          // Redirect to PR handling
          return discussionsTool(ref, "pr", include, maxResults);
        }

        const result: DiscussionsResult = { type: "issue", item: issue };

        if (include.includes("comments")) {
          result.comments = await client.getIssueComments(owner, repo, number, {
            per_page: maxResults,
          });
        }

        return result;
      }

      case "pr": {
        const pr = await client.getPullRequest(owner, repo, number);
        const result: DiscussionsResult = { type: "pr", item: pr };

        if (include.includes("comments")) {
          result.comments = await client.getIssueComments(owner, repo, number, {
            per_page: maxResults,
          });
        }

        if (include.includes("diff")) {
          result.diff = await client.getPullRequestDiff(owner, repo, number);
        }

        if (include.includes("files")) {
          result.files = await client.getPullRequestFiles(owner, repo, number, {
            per_page: maxResults,
          });
        }

        if (include.includes("reviews")) {
          result.reviews = await client.getPullRequestReviews(
            owner,
            repo,
            number,
            {
              per_page: maxResults,
            },
          );
        }

        return result;
      }

      case "discussion": {
        const discussion = await client.getDiscussion(owner, repo, number);
        const result: DiscussionsResult = {
          type: "discussion",
          item: discussion,
        };

        if (include.includes("comments")) {
          result.comments = await client.getDiscussionComments(
            owner,
            repo,
            number,
            maxResults,
          );
        }

        return result;
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

// =============================================================================
// MCP Server Setup
// =============================================================================

const createServer = (): McpServer => {
  const server = new McpServer(
    {
      name: "github-mcp",
      version: "0.0.1",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: `GitHub MCP for fast repository access. 3 tools:

• repo(ref, include?, path?, branch?, maxResults?) - Repository operations
  ref: "owner/repo" or GitHub URL
  include: ["readme", "tree", "commits", "branches", "releases"]
  path: Get specific file/directory content

• search(query, type, filters?, maxResults?) - Search GitHub
  type: "repos" | "code" | "issues"
  filters: { language, stars, state, repo, user, org }

• discussions(ref, type?, include?, maxResults?) - Issues/PRs/Discussions
  ref: "owner/repo#123" or GitHub URL
  type: "issue" | "pr" | "discussion" (auto-detected from URL)
  include: ["comments", "diff", "files", "reviews"]

Requires GITHUB_TOKEN environment variable.`,
    },
  );

  // ---------------------------------------------------------------------------
  // Tool: repo
  // ---------------------------------------------------------------------------
  server.tool(
    "repo",
    {
      ref: z
        .string()
        .describe('Repository reference: "owner/repo" or GitHub URL'),
      include: z
        .array(z.enum(["readme", "tree", "commits", "branches", "releases"]))
        .optional()
        .default([])
        .describe("Additional data to fetch"),
      path: z
        .string()
        .optional()
        .describe("Specific file or directory path to fetch"),
      branch: z
        .string()
        .optional()
        .describe("Branch or commit SHA (defaults to default branch)"),
      maxResults: z
        .number()
        .optional()
        .default(30)
        .describe("Max items for commits/branches/releases"),
    },
    async ({ ref, include, path, branch, maxResults }) => {
      const result = await repoTool(
        ref,
        include ?? [],
        path,
        branch,
        maxResults,
      );

      if ("error" in result) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Tool: search
  // ---------------------------------------------------------------------------
  server.tool(
    "search",
    {
      query: z.string().describe("Search query"),
      type: z.enum(["repos", "code", "issues"]).describe("What to search for"),
      filters: z
        .record(z.string(), z.string())
        .optional()
        .describe("Filters: language, stars, state, repo, user, org, etc."),
      maxResults: z
        .number()
        .optional()
        .default(30)
        .describe("Maximum results to return"),
    },
    async ({ query, type, filters, maxResults }) => {
      const result = await searchTool(query, type, filters, maxResults);

      if ("error" in result) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Tool: discussions
  // ---------------------------------------------------------------------------
  server.tool(
    "discussions",
    {
      ref: z
        .string()
        .describe(
          'Reference: "owner/repo#123" or GitHub URL (issues/pull/discussions)',
        ),
      type: z
        .enum(["issue", "pr", "discussion"])
        .optional()
        .describe("Type (auto-detected from URL if not provided)"),
      include: z
        .array(z.enum(["comments", "diff", "files", "reviews"]))
        .optional()
        .default([])
        .describe(
          "Additional data: comments, diff (PR), files (PR), reviews (PR)",
        ),
      maxResults: z
        .number()
        .optional()
        .default(50)
        .describe("Max comments/files/reviews to fetch"),
    },
    async ({ ref, type, include, maxResults }) => {
      const result = await discussionsTool(
        ref,
        type,
        include ?? [],
        maxResults,
      );

      if ("error" in result) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  return server;
};

// =============================================================================
// HTTP Server
// =============================================================================

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
  if (!process.env.GITHUB_TOKEN) {
    console.warn("⚠️  GITHUB_TOKEN not set - tools will return errors");
  }
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  process.exit(0);
});
