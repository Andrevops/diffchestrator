import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CTX, CMD } from "../constants";

interface FavoriteNode {
  label: string;
  repoPath: string;
}

export class FavoritesTreeProvider
  implements vscode.TreeDataProvider<FavoriteNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    FavoriteNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private repoManager: RepoManager) {
    // Refresh when repos change (to update counts)
    repoManager.onDidChangeRepos(() => {
      this._onDidChangeTreeData.fire();
    });

    // Refresh when config changes (favorites list)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("diffchestrator.favorites")) {
        this._updateContext();
        this._onDidChangeTreeData.fire();
      }
    });

    this._updateContext();
  }

  getTreeItem(element: FavoriteNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );

    const repo = this.repoManager.getRepo(element.repoPath);
    if (repo) {
      const parts: string[] = [];
      if (repo.branch) parts.push(repo.branch);
      if (repo.totalChanges > 0) parts.push(`${repo.totalChanges} changes`);
      item.description = parts.join(" | ");
    } else {
      item.description = "(not scanned)";
    }

    item.contextValue = "repo";
    (item as vscode.TreeItem & { path: string }).path = element.repoPath;
    item.tooltip = element.repoPath;
    item.iconPath = new vscode.ThemeIcon(
      "star-full",
      new vscode.ThemeColor("charts.yellow")
    );

    item.command = {
      command: CMD.viewDiff,
      title: "View Diff",
      arguments: [{ path: element.repoPath }],
    };

    return item;
  }

  getChildren(element?: FavoriteNode): FavoriteNode[] {
    if (element) return [];

    const config = vscode.workspace.getConfiguration("diffchestrator");
    const favorites = config.get<string[]>("favorites", []);

    return favorites.map((favPath) => ({
      label: path.basename(favPath),
      repoPath: favPath,
    }));
  }

  private _updateContext(): void {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const favorites = config.get<string[]>("favorites", []);
    vscode.commands.executeCommand(
      "setContext",
      CTX.hasFavorites,
      favorites.length > 0
    );
  }
}
