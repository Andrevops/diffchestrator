import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { RepoManager } from "../services/repoManager";

interface FileNode {
  uri: vscode.Uri;
  isDirectory: boolean;
  name: string;
}

/**
 * Tree view of the currently-selected repo's file hierarchy.
 *
 * Backed by fs.readdirSync with lazy per-directory expansion. Nothing touches
 * workspace folders, so switching the selected repo reroots the tree without
 * triggering a VS Code window reload.
 */
export class RepoFilesProvider implements vscode.TreeDataProvider<FileNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _disposables: vscode.Disposable[] = [];

  constructor(private _repoManager: RepoManager) {
    this._disposables.push(
      _repoManager.onDidChangeSelection(() => this._onDidChangeTreeData.fire()),
    );
  }

  /** Currently-selected repo path; drives the tree root. */
  get rootPath(): string | undefined {
    return this._repoManager.selectedRepo;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: FileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.uri,
      node.isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.label = node.name;
    item.resourceUri = node.uri; // lets VS Code pick the file-type icon from the active theme
    item.contextValue = node.isDirectory ? "repo-file-dir" : "repo-file";
    if (!node.isDirectory) {
      item.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [node.uri],
      };
    }
    return item;
  }

  async getChildren(node?: FileNode): Promise<FileNode[]> {
    const root = this.rootPath;
    if (!root) return [];

    const dir = node ? node.uri.fsPath : root;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const filtered = entries.filter((e) => e.name !== ".git");
    filtered.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return filtered.map((e) => ({
      uri: vscode.Uri.file(path.join(dir, e.name)),
      isDirectory: e.isDirectory(),
      name: e.name,
    }));
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
