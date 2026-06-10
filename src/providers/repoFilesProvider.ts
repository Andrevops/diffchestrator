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
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

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
      // Fallback for mounts where native file watching is unreliable (e.g.
      // Windows-side writes on WSL drvfs): in-editor saves always refresh.
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const root = this._repoManager.selectedRepo;
        if (!root || doc.uri.scheme !== "file") return;
        const p = doc.uri.fsPath;
        if (p === root || p.startsWith(root + path.sep)) this._scheduleRefresh(doc.uri);
      }),
    );
    this._watchSelectedRepo();
  }

  private _watchSelectedRepo(): void {
    this._fsWatcher?.dispose();
    this._fsWatcher = undefined;

    const root = this._repoManager.selectedRepo;
    if (!root) return;

    // Base must be a Uri: with a string base, createFileSystemWatcher only
    // reports events for paths inside the opened workspace folders, and
    // selected repos are deliberately never workspace folders.
    const pattern = new vscode.RelativePattern(vscode.Uri.file(root), "**/*");
    this._fsWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    this._fsWatcher.onDidCreate((uri) => this._scheduleRefresh(uri));
    this._fsWatcher.onDidDelete((uri) => this._scheduleRefresh(uri));
    this._fsWatcher.onDidChange((uri) => {
      this._scheduleRefresh(uri);
      if (!this._isNoise(uri)) void this._reloadOpenEditorsFor(uri);
    });
  }

  /**
   * The watcher fires on `**\/*`, so an active repo (build output, .git index
   * churn, node_modules) can emit many events per second. Each refresh runs
   * `git status` + readdir, so firing on every event hammers the disk. Coalesce
   * bursts into a single refresh and drop events from paths that never affect
   * the tree.
   */
  private _scheduleRefresh(uri: vscode.Uri): void {
    if (this._isNoise(uri)) return;
    if (this._refreshTimer) return; // a refresh is already pending
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      this._changedFiles.clear();
      this._onDidChangeTreeData.fire();
    }, 400);
  }

  /** Paths that generate watcher noise but are irrelevant to the file tree. */
  private _isNoise(uri: vscode.Uri): boolean {
    const p = uri.fsPath;
    return (
      p.includes(`${path.sep}.git${path.sep}`) ||
      p.endsWith(`${path.sep}.git`) ||
      p.includes(`${path.sep}node_modules${path.sep}`)
    );
  }

  /**
   * When a file in the selected repo changes on disk, force any open editor
   * showing that file to reload from disk. VS Code's automatic reload is
   * unreliable in WSL / when the editor is part of a diff input — leaving the
   * buffer stale and dirty, which causes a "save?" prompt on close that can
   * overwrite the external edit.
   */
  private async _reloadOpenEditorsFor(uri: vscode.Uri): Promise<void> {
    const target = uri.fsPath;
    const matches: { tab: vscode.Tab; group: vscode.TabGroup }[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        let hit = false;
        if (input instanceof vscode.TabInputText) {
          hit = input.uri.scheme === "file" && input.uri.fsPath === target;
        } else if (input instanceof vscode.TabInputTextDiff) {
          hit =
            (input.modified.scheme === "file" && input.modified.fsPath === target) ||
            (input.original.scheme === "file" && input.original.fsPath === target);
        }
        if (hit) matches.push({ tab, group });
      }
    }
    if (matches.length === 0) return;

    const previouslyActive = vscode.window.activeTextEditor;
    for (const { tab, group } of matches) {
      try {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.scheme === "file" && d.uri.fsPath === target,
        );
        if (!doc) continue;
        await vscode.window.showTextDocument(doc, {
          viewColumn: group.viewColumn,
          preview: tab.isPreview,
          preserveFocus: true,
        });
        await vscode.commands.executeCommand("workbench.action.files.revert");
      } catch {
        /* ignore — best-effort reload */
      }
    }
    if (previouslyActive) {
      try {
        await vscode.window.showTextDocument(previouslyActive.document, {
          viewColumn: previouslyActive.viewColumn,
          preserveFocus: false,
          preview: false,
        });
      } catch {
        /* ignore */
      }
    }
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
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._fsWatcher?.dispose();
    for (const d of this._disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
