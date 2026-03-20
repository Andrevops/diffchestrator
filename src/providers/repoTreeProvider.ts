import * as vscode from "vscode";
import * as path from "path";
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

  constructor(private repoManager: RepoManager) {
    repoManager.onDidChangeRepos(() => {
      this._root = undefined;
      this._onDidChangeTreeData.fire();
    });
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
      const parts: string[] = [];
      if (r.branch) parts.push(r.branch);
      if (r.totalChanges > 0) parts.push(`${r.totalChanges} changes`);
      item.description = parts.join(" | ");
      item.contextValue = "repo";
      (item as vscode.TreeItem & { path: string }).path = r.path;
      item.tooltip = this._buildTooltip(r);

      // Icon based on change state
      if (r.totalChanges > 0) {
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

    let repos = this.repoManager.repos;
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
    return lines.join("\n");
  }
}
