import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { RepoManager } from "../services/repoManager";
import type { FileChange } from "../types";
import { FileStatus } from "../types";

interface FileNode {
  uri: vscode.Uri;
  isDirectory: boolean;
  name: string;
  change?: FileChange;
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
  private _fsWatcher: vscode.FileSystemWatcher | undefined;
  private _changedFiles = new Map<string, FileChange>();

  constructor(private _repoManager: RepoManager) {
    this._disposables.push(
      _repoManager.onDidChangeSelection(() => {
        this._changedFiles.clear();
        this._watchSelectedRepo();
        this._onDidChangeTreeData.fire();
      }),
      _repoManager.onDidChangeRepos(() => {
        this._changedFiles.clear();
        this._onDidChangeTreeData.fire();
      }),
    );
    this._watchSelectedRepo();
  }

  private _watchSelectedRepo(): void {
    this._fsWatcher?.dispose();
    this._fsWatcher = undefined;

    const root = this._repoManager.selectedRepo;
    if (!root) return;

    const pattern = new vscode.RelativePattern(root, "**/*");
    this._fsWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const refresh = () => { this._changedFiles.clear(); this._onDidChangeTreeData.fire(); };
    this._fsWatcher.onDidCreate(refresh);
    this._fsWatcher.onDidDelete(refresh);
    this._fsWatcher.onDidChange(refresh);
  }

  /** Currently-selected repo path; drives the tree root. */
  get rootPath(): string | undefined {
    return this._repoManager.selectedRepo;
  }

  refresh(): void {
    this._changedFiles.clear();
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
    item.resourceUri = node.uri;
    item.contextValue = node.isDirectory ? "repo-file-dir" : "repo-file";
    if (!node.isDirectory) {
      const fc = node.change;
      if (fc && fc.status !== FileStatus.Untracked) {
        const repoPath = this.rootPath!;
        const staged = fc.status === FileStatus.Staged;
        const ref = staged ? "HEAD" : ":0";
        const leftUri = vscode.Uri.parse(
          `git-show:${path.join(repoPath, fc.path)}`,
        ).with({ query: JSON.stringify({ path: fc.path, ref, repoPath }) });
        const rightUri = staged
          ? vscode.Uri.parse(
              `git-show:${path.join(repoPath, fc.path)}`,
            ).with({ query: JSON.stringify({ path: fc.path, ref: ":0", repoPath }) })
          : node.uri;
        item.command = {
          command: "vscode.diff",
          title: "Show Diff",
          arguments: [leftUri, rightUri, `${node.name} (${staged ? "Staged" : "Working Tree"})`],
        };
      } else {
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [node.uri],
        };
      }
    }
    return item;
  }

  private async _ensureChangedFiles(): Promise<void> {
    if (this._changedFiles.size > 0) return;
    const root = this.rootPath;
    if (!root) return;
    try {
      const status = await this._repoManager.git.status(root);
      for (const fc of [...status.staged, ...status.unstaged, ...status.untracked]) {
        this._changedFiles.set(fc.path, fc);
      }
    } catch { /* ignore */ }
  }

  async getChildren(node?: FileNode): Promise<FileNode[]> {
    const root = this.rootPath;
    if (!root) return [];

    await this._ensureChangedFiles();

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

    return filtered.map((e) => {
      const absPath = path.join(dir, e.name);
      const relPath = path.relative(root, absPath);
      return {
        uri: vscode.Uri.file(absPath),
        isDirectory: e.isDirectory(),
        name: e.name,
        change: this._changedFiles.get(relPath),
      };
    });
  }

  dispose(): void {
    this._fsWatcher?.dispose();
    for (const d of this._disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
