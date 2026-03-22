import * as vscode from "vscode";
import * as path from "path";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoManager } from "../services/repoManager";
import type { RepoSummary } from "../types";
import { CMD } from "../constants";

interface TreeNode {
  label: string;
  fullPath: string;
  isRepo: boolean;
  repo?: RepoSummary;
  children: Map<string, TreeNode>;
}

export class RepoTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _root: TreeNode | undefined;
  private _git = new GitExecutor();
  private _lastCommitCache = new Map<string, { message: string; date: string }>();

  constructor(private repoManager: RepoManager) {
    repoManager.onDidChangeRepos(() => {
      this._root = undefined;
      this._refreshLastCommits();
      this._onDidChangeTreeData.fire();
    });
    repoManager.onDidChangeSelection(() => {
      // Clear cached tree so getTreeItem runs fresh with new selection state
      this._root = undefined;
      this._onDidChangeTreeData.fire();
    });
  }

  private async _refreshLastCommits(): Promise<void> {
    for (const repo of this.repoManager.repos) {
      try {
        const commits = await this._git.log(repo.path, 1);
        if (commits.length > 0) {
          this._lastCommitCache.set(repo.path, {
            message: commits[0].message,
            date: commits[0].date,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.isRepo
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Expanded
    );

    if (element.isRepo && element.repo) {
      const r = element.repo;
      const isActive = r.path === this.repoManager.selectedRepo;
      const isMultiSelected = this.repoManager.selectedRepoPaths.has(r.path);

      const parts: string[] = [];
      if (isActive) parts.push("● active");
      if (isMultiSelected) parts.push("✓ selected");
      if (r.branch) parts.push(r.branch);
      if (r.totalChanges > 0) parts.push(`${r.totalChanges} changes`);
      item.description = parts.join(" · ");
      // Unique id per state so VS Code resets selection on refresh
      const state = isActive ? "active" : isMultiSelected ? "multi" : "idle";
      item.id = `repo:${r.path}:${state}`;
      item.contextValue = "repo";
      (item as vscode.TreeItem & { path: string }).path = r.path;
      item.tooltip = this._buildTooltip(r);

      // Icon: active → blue, multi-selected → purple, changes → yellow, clean → green
      if (isActive) {
        item.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
      } else if (isMultiSelected) {
        item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.purple"));
      } else if (r.totalChanges > 0) {
        item.iconPath = new vscode.ThemeIcon("git-commit", new vscode.ThemeColor("charts.yellow"));
      } else {
        item.iconPath = new vscode.ThemeIcon("git-commit", new vscode.ThemeColor("charts.green"));
      }

      // Clicking a repo selects it in changed-files view
      item.command = {
        command: CMD.viewDiff,
        title: "View Diff",
        arguments: [{ path: r.path }],
      };
    } else {
      item.contextValue = "directory";
      item.iconPath = vscode.ThemeIcon.Folder;
    }

    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Root level
      const root = this._buildTree();
      if (!root) return [];
      // If root has only one child that's a directory, flatten
      return this._flattenSingleChildDirs(root);
    }
    return [...element.children.values()];
  }

  private _buildTree(): TreeNode | undefined {
    if (this._root) return this._root;

    let repos = [...this.repoManager.repos];
    // Sort: repos with changes first, then alphabetical
    repos.sort((a, b) => {
      if (a.totalChanges > 0 && b.totalChanges === 0) return -1;
      if (a.totalChanges === 0 && b.totalChanges > 0) return 1;
      return a.name.localeCompare(b.name);
    });
    if (this.repoManager.changedOnly) {
      repos = repos.filter((r) => r.totalChanges > 0);
    }

    if (repos.length === 0) return undefined;

    // Find common prefix
    const commonPrefix = this._findCommonPrefix(repos.map((r) => r.path));

    // Build tree
    const root: TreeNode = {
      label: "root",
      fullPath: commonPrefix,
      isRepo: false,
      children: new Map(),
    };

    for (const repo of repos) {
      const relativePath = path.relative(commonPrefix, repo.path);
      const segments = relativePath.split(path.sep).filter((s) => s.length > 0);

      let current = root;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;

        if (!current.children.has(seg)) {
          const childPath = path.join(
            commonPrefix,
            ...segments.slice(0, i + 1)
          );
          current.children.set(seg, {
            label: seg,
            fullPath: childPath,
            isRepo: isLast,
            repo: isLast ? repo : undefined,
            children: new Map(),
          });
        } else if (isLast) {
          const existing = current.children.get(seg)!;
          existing.isRepo = true;
          existing.repo = repo;
        }
        current = current.children.get(seg)!;
      }
    }

    this._root = root;
    return root;
  }

  private _flattenSingleChildDirs(root: TreeNode): TreeNode[] {
    const children = [...root.children.values()];

    // Collapse intermediate directories with a single child
    return children.map((child) => this._collapseNode(child));
  }

  private _collapseNode(node: TreeNode): TreeNode {
    if (
      !node.isRepo &&
      node.children.size === 1
    ) {
      const onlyChild = [...node.children.values()][0];
      const collapsed: TreeNode = {
        label: `${node.label}/${onlyChild.label}`,
        fullPath: onlyChild.fullPath,
        isRepo: onlyChild.isRepo,
        repo: onlyChild.repo,
        children: onlyChild.children,
      };
      return this._collapseNode(collapsed);
    }

    // Recursively collapse children
    const newChildren = new Map<string, TreeNode>();
    for (const [key, child] of node.children) {
      newChildren.set(key, this._collapseNode(child));
    }
    return { ...node, children: newChildren };
  }

  private _findCommonPrefix(paths: string[]): string {
    if (paths.length === 0) return "";
    if (paths.length === 1) return path.dirname(paths[0]);

    const split = paths.map((p) => p.split(path.sep));
    const minLen = Math.min(...split.map((s) => s.length));
    const common: string[] = [];

    for (let i = 0; i < minLen; i++) {
      const seg = split[0][i];
      if (split.every((s) => s[i] === seg)) {
        common.push(seg);
      } else {
        break;
      }
    }

    return common.join(path.sep) || path.sep;
  }

  private _buildTooltip(r: RepoSummary): string {
    const lines: string[] = [
      r.path,
      `Branch: ${r.branch}`,
    ];
    if (r.stagedCount > 0) lines.push(`Staged: ${r.stagedCount}`);
    if (r.unstagedCount > 0) lines.push(`Unstaged: ${r.unstagedCount}`);
    if (r.untrackedCount > 0) lines.push(`Untracked: ${r.untrackedCount}`);
    if (r.remoteUrl) lines.push(`Remote: ${r.remoteUrl}`);

    const lastCommit = this._lastCommitCache.get(r.path);
    if (lastCommit) {
      const relDate = this._timeAgo(lastCommit.date);
      lines.push(`Last commit: ${lastCommit.message} (${relDate})`);
    }

    return lines.join("\n");
  }

  private _timeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;
    if (weeks > 0) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    return "just now";
  }
}
