import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import type { RepoSummary } from "../types";
import { CMD } from "../constants";

interface ActiveRepoNode {
  repo: RepoSummary;
  role: "active" | "selected";
}

export class ActiveReposProvider implements vscode.TreeDataProvider<ActiveRepoNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActiveRepoNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private repoManager: RepoManager) {
    repoManager.onDidChangeSelection(() => this._onDidChangeTreeData.fire());
    repoManager.onDidChangeRepos(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: ActiveRepoNode): vscode.TreeItem {
    const r = element.repo;
    const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);

    const parts: string[] = [];
    if (r.branch) parts.push(r.branch);
    if (r.totalChanges > 0) parts.push(`${r.totalChanges} changes`);

    if (element.role === "active") {
      item.description = parts.length > 0 ? `● ${parts.join(" · ")}` : "●";
      item.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
    } else {
      item.description = parts.join(" · ");
      item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.purple"));
    }

    item.contextValue = "repo";
    (item as vscode.TreeItem & { path: string }).path = r.path;

    item.tooltip = [
      r.path,
      `Branch: ${r.branch}`,
      r.totalChanges > 0 ? `Changes: ${r.totalChanges}` : "Clean",
      element.role === "active" ? "Active repo" : "Multi-selected",
    ].join("\n");

    item.command = {
      command: CMD.viewDiff,
      title: "View Diff",
      arguments: [{ path: r.path }],
    };

    return item;
  }

  getChildren(): ActiveRepoNode[] {
    const nodes: ActiveRepoNode[] = [];
    const activePath = this.repoManager.selectedRepo;
    const multiPaths = this.repoManager.selectedRepoPaths;

    // Active repo first
    if (activePath) {
      const repo = this.repoManager.getRepo(activePath);
      if (repo) {
        nodes.push({ repo, role: "active" });
      }
    }

    // Multi-selected repos (excluding active to avoid duplicates)
    for (const p of multiPaths) {
      if (p === activePath) continue;
      const repo = this.repoManager.getRepo(p);
      if (repo) {
        nodes.push({ repo, role: "selected" });
      }
    }

    return nodes;
  }
}
