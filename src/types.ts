import * as vscode from "vscode";

export enum ChangeType {
  Modified = "modified",
  Added = "added",
  Deleted = "deleted",
  Renamed = "renamed",
  Copied = "copied",
  TypeChanged = "typeChanged",
  Unmerged = "unmerged",
  Unknown = "unknown",
}

export enum FileStatus {
  Staged = "staged",
  Unstaged = "unstaged",
  Untracked = "untracked",
}

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

// Webview message types (for future webview integration)
export type WebviewMessage =
  | { type: "scan"; rootPath: string }
  | { type: "commit"; repoPath: string; message: string }
  | { type: "push"; repoPath: string; force?: boolean }
  | { type: "stage"; repoPath: string; files: string[] }
  | { type: "unstage"; repoPath: string; files: string[] }
  | { type: "diff"; repoPath: string; staged?: boolean; file?: string }
  | { type: "status"; repoPath: string }
  | { type: "selectRepo"; repoPath: string }
  | { type: "refresh" };

export type ExtensionMessage =
  | { type: "repos"; repos: RepoSummary[] }
  | { type: "status"; repoPath: string; status: RepoStatus }
  | { type: "diff"; repoPath: string; diff: string }
  | { type: "progress"; progress: ScanProgress }
  | { type: "result"; operation: string; result: OperationResult }
  | { type: "error"; message: string };
