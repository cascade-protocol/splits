/**
 * GitHub MCP Types
 *
 * Minimal types for the 3-tool GitHub MCP: repo, search, discussions
 */

// =============================================================================
// Config
// =============================================================================

export type GitHubConfig = {
  token: string;
  baseUrl?: string;
};

// =============================================================================
// Common GitHub API Types
// =============================================================================

export type GitHubUser = {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  type: "User" | "Organization" | "Bot";
};

export type GitHubLabel = {
  id: number;
  name: string;
  color: string;
  description: string | null;
};

export type GitHubLicense = {
  key: string;
  name: string;
  spdx_id: string;
};

// =============================================================================
// Repository Types
// =============================================================================

export type Repository = {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  default_branch: string;
  topics: string[];
  license: GitHubLicense | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
};

export type FileContent = {
  type: "file";
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string; // base64 encoded
  encoding: "base64";
  html_url: string;
};

export type DirectoryEntry = {
  type: "file" | "dir" | "submodule" | "symlink";
  name: string;
  path: string;
  sha: string;
  size: number;
  html_url: string;
};

export type TreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url: string;
};

export type GitTree = {
  sha: string;
  url: string;
  tree: TreeEntry[];
  truncated: boolean;
};

export type Commit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
  };
  author: GitHubUser | null;
  committer: GitHubUser | null;
  parents: { sha: string; url: string }[];
};

export type Branch = {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
};

export type Release = {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author: GitHubUser;
};

// =============================================================================
// Issue / PR / Discussion Types
// =============================================================================

export type Issue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  state_reason: "completed" | "reopened" | "not_planned" | null;
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  // PR-specific (present if issue is a PR)
  pull_request?: {
    url: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
  };
};

export type PullRequest = Issue & {
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  merged_at: string | null;
  merged_by: GitHubUser | null;
  head: { ref: string; sha: string; repo: Repository };
  base: { ref: string; sha: string; repo: Repository };
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  draft: boolean;
};

export type IssueComment = {
  id: number;
  html_url: string;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
};

export type PullRequestFile = {
  sha: string;
  filename: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type PullRequestReview = {
  id: number;
  user: GitHubUser;
  body: string | null;
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "DISMISSED"
    | "PENDING";
  html_url: string;
  submitted_at: string;
};

export type Discussion = {
  id: string;
  number: number;
  title: string;
  body: string;
  html_url: string;
  author: { login: string };
  category: { name: string; emoji: string };
  answer: { id: string; body: string; author: { login: string } } | null;
  comments: { totalCount: number };
  createdAt: string;
  updatedAt: string;
};

export type DiscussionComment = {
  id: string;
  body: string;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  replies: { totalCount: number };
};

// =============================================================================
// Search Types
// =============================================================================

export type SearchResultItem<T> = {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
};

export type CodeSearchItem = {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: GitHubUser;
    html_url: string;
  };
  text_matches?: {
    fragment: string;
    matches: { text: string; indices: number[] }[];
  }[];
};

// =============================================================================
// Tool Response Types
// =============================================================================

export type RepoResult = {
  repo: Repository;
  readme?: string;
  tree?: TreeEntry[];
  file?: { path: string; content: string; size: number };
  commits?: Commit[];
  branches?: Branch[];
  releases?: Release[];
};

export type SearchResult = {
  type: "repos" | "code" | "issues";
  query: string;
  total_count: number;
  items: Repository[] | CodeSearchItem[] | Issue[];
  has_more: boolean;
};

export type DiscussionsResult = {
  type: "issue" | "pr" | "discussion";
  item: Issue | PullRequest | Discussion;
  comments?: IssueComment[] | DiscussionComment[];
  diff?: string;
  files?: PullRequestFile[];
  reviews?: PullRequestReview[];
};

// =============================================================================
// Error Types
// =============================================================================

export type GitHubError = {
  message: string;
  documentation_url?: string;
  status?: number;
};

export type ErrorResult = {
  error: string;
  status?: number;
  suggestion?: string;
};
