import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import type { RepoSummary } from "../types";
import { CMD } from "../constants";
import { timeAgo } from "../utils/time";

interface TreeNode {
  label: string;
  fullPath: string;
  isRepo: boolean;
  repo?: RepoSummary;
  children: Map<string, TreeNode>;
}

export class RepoTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _disposables: vscode.Disposable[] = [];

  private _root: TreeNode | undefined;
  private _git;
  private _lastCommitCache = new Map<string, { message: string; date: string }>();
  private _lastCommitRefreshTime = 0;
  private static readonly COMMIT_CACHE_COOLDOWN = 60_000; // 60s

  private _repoTagsCache: Record<string, string[]> | undefined;

  constructor(private repoManager: RepoManager) {
    this._git = repoManager.git;
    this._disposables.push(repoManager.onDidChangeRepos(() => {
      this._root = undefined;
      this._repoTagsCache = undefined;
      // Evict commit cache entries for repos no longer in the list
      const currentPaths = new Set(repoManager.allRepos.map((r) => r.path));
      for (const key of this._lastCommitCache.keys()) {
        if (!currentPaths.has(key)) this._lastCommitCache.delete(key);
      }
      this._onDidChangeTreeData.fire();
    }));
    this._disposables.push(repoManager.onDidChangeSelection(() => {
      this._refreshLastCommits();
      this._onDidChangeTreeData.fire();
    }));
    this._disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("diffchestrator.repoTags")) {
        this._repoTagsCache = undefined;
        this._onDidChangeTreeData.fire();
      }
    }));
  }

  dispose(): void {
    this._lastCommitCache.clear();
    this._onDidChangeTreeData.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }

  private _getRepoTags(): Record<string, string[]> {
    if (!this._repoTagsCache) {
      const config = vscode.workspace.getConfiguration("diffchestrator");
      this._repoTagsCache = config.get("repoTags", {});
    }
    return this._repoTagsCache;
  }

  private async _refreshLastCommits(): Promise<void> {
    // Cooldown: skip if refreshed recently (tooltips don't need real-time data)
    const now = Date.now();
    if (now - this._lastCommitRefreshTime < RepoTreeProvider.COMMIT_CACHE_COOLDOWN) return;
    this._lastCommitRefreshTime = now;

    // Parallel with concurrency limit
    const repos = this.repoManager.repos;
    const BATCH = 5;
    for (let i = 0; i < repos.length; i += BATCH) {
      await Promise.all(
        repos.slice(i, i + BATCH).map(async (repo) => {
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
        })
      );
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
      const sync: string[] = [];
      if (r.ahead > 0) sync.push(`↑${r.ahead}`);
      if (r.behind > 0) sync.push(`↓${r.behind}`);
      if (sync.length > 0) parts.push(sync.join(" "));
      if (r.totalChanges > 0) parts.push(`${r.totalChanges} changes`);
      if (r.stashCount > 0) parts.push(`$(archive) ${r.stashCount}`);
      // Show tags for this repo (cached)
      const repoTags = this._getRepoTags();
      const tags = Object.entries(repoTags)
        .filter(([, repos]) => repos.includes(r.path))
        .map(([tag]) => `#${tag}`);
      if (tags.length > 0) parts.push(tags.join(" "));
      item.description = parts.join(" · ");
      // Unique id per state so VS Code resets selection on refresh
      const state = isActive ? "active" : isMultiSelected ? "multi" : "idle";
      item.id = `repo:${r.path}:${state}`;
      item.contextValue = "repo";
      (item as vscode.TreeItem & { path: string }).path = r.path;
      item.tooltip = this._buildTooltip(r);

      // Icon: active → blue, multi-selected → purple, behind → orange, changes → yellow, clean → green
      if (isActive) {
        item.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
      } else if (isMultiSelected) {
        item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.purple"));
      } else if (r.behind > 0) {
        item.iconPath = new vscode.ThemeIcon("cloud-download", new vscode.ThemeColor("charts.orange"));
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
      (item as vscode.TreeItem & { fullPath: string }).fullPath = element.fullPath;
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
    if (r.ahead > 0 || r.behind > 0) {
      const syncParts: string[] = [];
      if (r.ahead > 0) syncParts.push(`${r.ahead} ahead`);
      if (r.behind > 0) syncParts.push(`${r.behind} behind`);
      lines.push(`Sync: ${syncParts.join(", ")}`);
    }
    if (r.stashCount > 0) lines.push(`Stashes: ${r.stashCount}`);
    if (r.remoteUrl) lines.push(`Remote: ${r.remoteUrl}`);

    const lastCommit = this._lastCommitCache.get(r.path);
    if (lastCommit) {
      const relDate = timeAgo(lastCommit.date);
      lines.push(`Last commit: ${lastCommit.message} (${relDate})`);
    }

    return lines.join("\n");
  }

}
