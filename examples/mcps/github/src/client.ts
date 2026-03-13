/**
 * GitHub API Client - Functional Style
 *
 * Pure functions for GitHub REST API access.
 * No classes, just functions and closures.
 */

import { Buffer } from "node:buffer";
import type {
  GitHubConfig,
  Repository,
  FileContent,
  DirectoryEntry,
  GitTree,
  Commit,
  Branch,
  Release,
  Issue,
  PullRequest,
  IssueComment,
  PullRequestFile,
  PullRequestReview,
  SearchResultItem,
  CodeSearchItem,
  GitHubError,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.github.com";

// =============================================================================
// Core Fetch Wrapper
// =============================================================================

type FetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  accept?: string;
};

const fetchGitHub = async <T>(
  config: GitHubConfig,
  path: string,
  options: FetchOptions = {},
): Promise<T> => {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: options.accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cascade-github-mcp/0.0.1",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as GitHubError;
    throw new Error(
      error.message ??
        `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }

  // Handle raw text responses (like diffs)
  if (
    options.accept?.includes("diff") ||
    options.accept?.includes("text/plain")
  ) {
    return (await response.text()) as T;
  }

  return response.json() as Promise<T>;
};

// =============================================================================
// Repository Operations
// =============================================================================

export const getRepository = (
  config: GitHubConfig,
  owner: string,
  repo: string,
) => fetchGitHub<Repository>(config, `/repos/${owner}/${repo}`);

export const getReadme = async (
  config: GitHubConfig,
  owner: string,
  repo: string,
  ref?: string,
): Promise<string> => {
  const path = `/repos/${owner}/${repo}/readme${ref ? `?ref=${ref}` : ""}`;
  const data = await fetchGitHub<FileContent>(config, path);
  return Buffer.from(data.content, "base64").toString("utf-8");
};

export const getFileContents = async (
  config: GitHubConfig,
  owner: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<FileContent | DirectoryEntry[]> => {
  const path = `/repos/${owner}/${repo}/contents/${filePath}${ref ? `?ref=${ref}` : ""}`;
  return fetchGitHub(config, path);
};

export const getTree = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  treeSha: string,
  recursive = false,
) =>
  fetchGitHub<GitTree>(
    config,
    `/repos/${owner}/${repo}/git/trees/${treeSha}${recursive ? "?recursive=1" : ""}`,
  );

export const getCommits = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  options: { sha?: string; per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams();
  if (options.sha) params.set("sha", options.sha);
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  const query = params.toString();
  return fetchGitHub<Commit[]>(
    config,
    `/repos/${owner}/${repo}/commits${query ? `?${query}` : ""}`,
  );
};

export const getBranches = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  options: { per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams();
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  const query = params.toString();
  return fetchGitHub<Branch[]>(
    config,
    `/repos/${owner}/${repo}/branches${query ? `?${query}` : ""}`,
  );
};

export const getReleases = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  options: { per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams();
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  const query = params.toString();
  return fetchGitHub<Release[]>(
    config,
    `/repos/${owner}/${repo}/releases${query ? `?${query}` : ""}`,
  );
};

// =============================================================================
// Issue Operations
// =============================================================================

export const getIssue = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  issueNumber: number,
) =>
  fetchGitHub<Issue>(config, `/repos/${owner}/${repo}/issues/${issueNumber}`);

export const getIssueComments = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  issueNumber: number,
  options: { per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams();
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  const query = params.toString();
  return fetchGitHub<IssueComment[]>(
    config,
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments${query ? `?${query}` : ""}`,
  );
};

// =============================================================================
// Pull Request Operations
// =============================================================================

export const getPullRequest = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  prNumber: number,
) =>
  fetchGitHub<PullRequest>(config, `/repos/${owner}/${repo}/pulls/${prNumber}`);

export const getPullRequestDiff = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  prNumber: number,
) =>
  fetchGitHub<string>(config, `/repos/${owner}/${repo}/pulls/${prNumber}`, {
    accept: "application/vnd.github.diff",
  });

export const getPullRequestFiles = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  prNumber: number,
  options: { per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams();
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  const query = params.toString();
  return fetchGitHub<PullRequestFile[]>(
    config,
    `/repos/${owner}/${repo}/pulls/${prNumber}/files${query ? `?${query}` : ""}`,
  );
};

export const getPullRequestReviews = (
  config: GitHubConfig,
  owner: string,
  repo: string,
  prNumber: number,
  options: { per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams();
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  const query = params.toString();
  return fetchGitHub<PullRequestReview[]>(
    config,
    `/repos/${owner}/${repo}/pulls/${prNumber}/reviews${query ? `?${query}` : ""}`,
  );
};

// =============================================================================
// Discussion Operations (GraphQL)
// =============================================================================

const graphql = async <T>(
  config: GitHubConfig,
  query: string,
  variables: Record<string, unknown>,
) => {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "User-Agent": "cascade-github-mcp/0.0.1",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL error: ${response.status}`);
  }

  const result = (await response.json()) as {
    data: T;
    errors?: { message: string }[];
  };
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join(", "));
  }

  return result.data;
};

export const getDiscussion = async (
  config: GitHubConfig,
  owner: string,
  repo: string,
  discussionNumber: number,
) => {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          id
          number
          title
          body
          url
          author { login }
          category { name emoji }
          answer { id body author { login } }
          comments { totalCount }
          createdAt
          updatedAt
        }
      }
    }
  `;
  const data = await graphql<{
    repository: {
      discussion: { url: string } & Omit<
        import("./types.js").Discussion,
        "html_url"
      >;
    };
  }>(config, query, { owner, repo, number: discussionNumber });

  const disc = data.repository.discussion;
  return { ...disc, html_url: disc.url } as import("./types.js").Discussion;
};

export const getDiscussionComments = async (
  config: GitHubConfig,
  owner: string,
  repo: string,
  discussionNumber: number,
  first = 50,
) => {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!, $first: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          comments(first: $first) {
            nodes {
              id
              body
              author { login }
              createdAt
              updatedAt
              replies { totalCount }
            }
          }
        }
      }
    }
  `;
  const data = await graphql<{
    repository: {
      discussion: {
        comments: { nodes: import("./types.js").DiscussionComment[] };
      };
    };
  }>(config, query, { owner, repo, number: discussionNumber, first });

  return data.repository.discussion.comments.nodes;
};

// =============================================================================
// Search Operations
// =============================================================================

export const searchRepositories = (
  config: GitHubConfig,
  query: string,
  options: {
    per_page?: number;
    page?: number;
    sort?: string;
    order?: "asc" | "desc";
  } = {},
) => {
  const params = new URLSearchParams({ q: query });
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  if (options.sort) params.set("sort", options.sort);
  if (options.order) params.set("order", options.order);
  return fetchGitHub<SearchResultItem<Repository>>(
    config,
    `/search/repositories?${params}`,
  );
};

export const searchCode = (
  config: GitHubConfig,
  query: string,
  options: { per_page?: number; page?: number } = {},
) => {
  const params = new URLSearchParams({ q: query });
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  // Request text matches for context
  return fetchGitHub<SearchResultItem<CodeSearchItem>>(
    config,
    `/search/code?${params}`,
    {
      accept: "application/vnd.github.text-match+json",
    },
  );
};

export const searchIssues = (
  config: GitHubConfig,
  query: string,
  options: {
    per_page?: number;
    page?: number;
    sort?: string;
    order?: "asc" | "desc";
  } = {},
) => {
  const params = new URLSearchParams({ q: query });
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  if (options.sort) params.set("sort", options.sort);
  if (options.order) params.set("order", options.order);
  return fetchGitHub<SearchResultItem<Issue>>(
    config,
    `/search/issues?${params}`,
  );
};

// =============================================================================
// Utility: Parse Refs
// =============================================================================

/**
 * Parse a repository reference like "owner/repo" or a GitHub URL
 */
export const parseRepoRef = (
  ref: string,
): { owner: string; repo: string } | null => {
  // Handle URLs
  const urlMatch = ref.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
  }

  // Handle owner/repo format
  const parts = ref.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }

  return null;
};

/**
 * Parse an issue/PR/discussion reference like "owner/repo#123" or a GitHub URL
 */
export const parseDiscussionRef = (
  ref: string,
): {
  owner: string;
  repo: string;
  number: number;
  type: "issue" | "pr" | "discussion";
} | null => {
  // Handle URLs
  const issueUrlMatch = ref.match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
  );
  if (issueUrlMatch) {
    return {
      owner: issueUrlMatch[1],
      repo: issueUrlMatch[2],
      number: Number.parseInt(issueUrlMatch[3], 10),
      type: "issue",
    };
  }

  const prUrlMatch = ref.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (prUrlMatch) {
    return {
      owner: prUrlMatch[1],
      repo: prUrlMatch[2],
      number: Number.parseInt(prUrlMatch[3], 10),
      type: "pr",
    };
  }

  const discussionUrlMatch = ref.match(
    /github\.com\/([^/]+)\/([^/]+)\/discussions\/(\d+)/,
  );
  if (discussionUrlMatch) {
    return {
      owner: discussionUrlMatch[1],
      repo: discussionUrlMatch[2],
      number: Number.parseInt(discussionUrlMatch[3], 10),
      type: "discussion",
    };
  }

  // Handle owner/repo#123 format (defaults to issue)
  const shortMatch = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      number: Number.parseInt(shortMatch[3], 10),
      type: "issue",
    };
  }

  return null;
};

// =============================================================================
// Factory: Create Configured Client
// =============================================================================

/**
 * Create a GitHub client with bound config.
 * Returns an object of functions - no class needed.
 */
export const createGitHubClient = (config: GitHubConfig) => ({
  // Repo operations
  getRepository: (owner: string, repo: string) =>
    getRepository(config, owner, repo),
  getReadme: (owner: string, repo: string, ref?: string) =>
    getReadme(config, owner, repo, ref),
  getFileContents: (owner: string, repo: string, path: string, ref?: string) =>
    getFileContents(config, owner, repo, path, ref),
  getTree: (
    owner: string,
    repo: string,
    treeSha: string,
    recursive?: boolean,
  ) => getTree(config, owner, repo, treeSha, recursive),
  getCommits: (
    owner: string,
    repo: string,
    options?: Parameters<typeof getCommits>[3],
  ) => getCommits(config, owner, repo, options),
  getBranches: (
    owner: string,
    repo: string,
    options?: Parameters<typeof getBranches>[3],
  ) => getBranches(config, owner, repo, options),
  getReleases: (
    owner: string,
    repo: string,
    options?: Parameters<typeof getReleases>[3],
  ) => getReleases(config, owner, repo, options),

  // Issue operations
  getIssue: (owner: string, repo: string, issueNumber: number) =>
    getIssue(config, owner, repo, issueNumber),
  getIssueComments: (
    owner: string,
    repo: string,
    issueNumber: number,
    options?: Parameters<typeof getIssueComments>[4],
  ) => getIssueComments(config, owner, repo, issueNumber, options),

  // PR operations
  getPullRequest: (owner: string, repo: string, prNumber: number) =>
    getPullRequest(config, owner, repo, prNumber),
  getPullRequestDiff: (owner: string, repo: string, prNumber: number) =>
    getPullRequestDiff(config, owner, repo, prNumber),
  getPullRequestFiles: (
    owner: string,
    repo: string,
    prNumber: number,
    options?: Parameters<typeof getPullRequestFiles>[4],
  ) => getPullRequestFiles(config, owner, repo, prNumber, options),
  getPullRequestReviews: (
    owner: string,
    repo: string,
    prNumber: number,
    options?: Parameters<typeof getPullRequestReviews>[4],
  ) => getPullRequestReviews(config, owner, repo, prNumber, options),

  // Discussion operations
  getDiscussion: (owner: string, repo: string, discussionNumber: number) =>
    getDiscussion(config, owner, repo, discussionNumber),
  getDiscussionComments: (
    owner: string,
    repo: string,
    discussionNumber: number,
    first?: number,
  ) => getDiscussionComments(config, owner, repo, discussionNumber, first),

  // Search operations
  searchRepositories: (
    query: string,
    options?: Parameters<typeof searchRepositories>[2],
  ) => searchRepositories(config, query, options),
  searchCode: (query: string, options?: Parameters<typeof searchCode>[2]) =>
    searchCode(config, query, options),
  searchIssues: (query: string, options?: Parameters<typeof searchIssues>[2]) =>
    searchIssues(config, query, options),
});

export type GitHubClient = ReturnType<typeof createGitHubClient>;
