import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";

export class RepoExplorerProvider implements vscode.TreeDataProvider<vscode.Uri>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.Uri | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _disposables: vscode.Disposable[] = [];

  constructor(private repoManager: RepoManager) {
    this._disposables.push(repoManager.onDidChangeSelection(() => {
      this._onDidChangeTreeData.fire();
    }));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }

  getTreeItem(element: vscode.Uri): vscode.TreeItem {
    const stat = fs.statSync(element.fsPath);
    const isDirectory = stat.isDirectory();
    const item = new vscode.TreeItem(
      element,
      isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (isDirectory) {
      item.contextValue = "directory";
    } else {
      item.contextValue = "file";
      item.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [element],
      };
    }

    return item;
  }

  async getChildren(element?: vscode.Uri): Promise<vscode.Uri[]> {
    if (!element) {
      // Root level
      const repoPath = this.repoManager.selectedRepo;
      if (!repoPath) return [];
      return this._readDirectory(repoPath);
    }
    return this._readDirectory(element.fsPath);
  }

  private async _readDirectory(dirPath: string): Promise<vscode.Uri[]> {
    try {
      const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const uris = dirents
        .filter((d) => d.name !== ".git") // Hide .git folder
        .map((d) => vscode.Uri.file(path.join(dirPath, d.name)));

      // Sort directories first, then files alphabetically
      const dirs: vscode.Uri[] = [];
      const files: vscode.Uri[] = [];
      for (const uri of uris) {
        try {
          const stat = await fs.promises.stat(uri.fsPath);
          if (stat.isDirectory()) {
            dirs.push(uri);
          } else {
            files.push(uri);
          }
        } catch {
          // ignore stat errors
        }
      }

      dirs.sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)));
      files.sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)));

      return [...dirs, ...files];
    } catch {
      return [];
    }
  }
}
