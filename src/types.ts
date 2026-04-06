import type * as vscode from "vscode";

export const ChangeType = {
  Modified: "modified",
  Added: "added",
  Deleted: "deleted",
  Renamed: "renamed",
  Copied: "copied",
  TypeChanged: "typeChanged",
  Unmerged: "unmerged",
  Unknown: "unknown",
} as const;
export type ChangeType = (typeof ChangeType)[keyof typeof ChangeType];

export const FileStatus = {
  Staged: "staged",
  Unstaged: "unstaged",
  Untracked: "untracked",
} as const;
export type FileStatus = (typeof FileStatus)[keyof typeof FileStatus];

export interface FileChange {
  path: string;
  oldPath?: string;
  changeType: ChangeType;
  status: FileStatus;
}

export interface RepoStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
}

export interface RepoSummary {
  path: string;
  name: string;
  branch: string;
  remoteUrl?: string;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  totalChanges: number;
  ahead: number;
  behind: number;
  headOid: string;
  stashCount: number;
}

export interface CommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface RepoTreeItem extends vscode.TreeItem {
  path: string;
  isDirectory: boolean;
  children?: RepoTreeItem[];
  repo?: RepoSummary;
}

export interface ChangedFileItem extends vscode.TreeItem {
  repoPath: string;
  filePath: string;
  fileChange: FileChange;
}

export interface ScanProgress {
  dirsScanned: number;
  reposFound: number;
}

export interface OperationResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface BulkResult {
  repoPath: string;
  repoName: string;
  result: OperationResult;
}

// Dashboard webview message types (webview → extension)
export type DashboardMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "scan" }
  | { type: "bulkPush" }
  | { type: "branchCleanup" }
  | { type: "openRepo"; repoPath: string }
  | { type: "pullAll" }
  | { type: "pullRepo"; repoPath: string }
  | { type: "pushRepo"; repoPath: string }
  | { type: "fetchAll" }
  | { type: "openTerminal"; repoPath: string }
  | { type: "openClaude"; repoPath: string }
  | { type: "aiCommit"; repoPath: string }
  | { type: "switchRoot" }
  | { type: "switchBranch"; repoPath: string }
  | { type: "discardAll"; repoPath: string }
  | { type: "commitHistory"; repoPath: string }
  | { type: "openRemoteUrl"; repoPath: string }
  | { type: "copyRepoInfo"; repoPath: string }
  | { type: "saveSnapshot" }
  | { type: "loadSnapshot" }
  | { type: "claudeReviewAll" }
  | { type: "filterByTag" }
  | { type: "stashPop"; repoPath: string }
  | { type: "stashApply"; repoPath: string; index: number }
  | { type: "pinRepo"; repoPath: string }
  | { type: "unpinRepo"; repoPath: string }
  | { type: "exportActivity"; format: "clipboard" | "file"; entries: { repoName: string; shortHash: string; author: string; date: string; message: string }[] }
  | { type: "getSettings" }
  | { type: "updateSetting"; key: string; value: unknown }
  | { type: "addScanRootFromSettings" };

// Diff webview message types (webview → extension)
export type DiffWebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "stageFile"; repoPath: string; filePath: string }
  | { type: "unstageFile"; repoPath: string; filePath: string }
  | { type: "stageAll"; repoPath: string }
  | { type: "unstageAll"; repoPath: string }
  | { type: "openTerminal"; repoPath: string }
  | { type: "askClaude"; repoPath: string; filePath: string; hunkContent: string };

// Helper to extract repoPath from a message if present
export function getMessageRepoPath(msg: DashboardMessage | DiffWebviewMessage): string | undefined {
  return "repoPath" in msg ? (msg as { repoPath: string }).repoPath : undefined;
}

// Tab input type helpers (VS Code doesn't export these)
export interface TabInputText { uri: import("vscode").Uri }
export interface TabInputDiff { original: import("vscode").Uri; modified: import("vscode").Uri }

export function extractTabUri(input: unknown): import("vscode").Uri | undefined {
  const obj = input as Record<string, unknown> | undefined;
  if (!obj) return undefined;
  if (obj.uri) return obj.uri as import("vscode").Uri;
  if (obj.original) return obj.original as import("vscode").Uri;
  if (obj.modified) return obj.modified as import("vscode").Uri;
  return undefined;
}
