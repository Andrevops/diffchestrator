import * as vscode from "vscode";
import type { RepoManager } from "./repoManager";

export class FileWatcher implements vscode.Disposable {
  private _watchers = new Map<string, vscode.FileSystemWatcher>();
  private _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _repoManager: RepoManager;
  private _disposables: vscode.Disposable[] = [];

  constructor(repoManager: RepoManager) {
    this._repoManager = repoManager;
  }

  /**
   * Start watching all currently-known repos.
   * Call this after a scan completes.
   */
  watchAll(): void {
    this.disposeWatchers();

    for (const repo of this._repoManager.repos) {
      this._watchRepo(repo.path);
    }

    // Also re-watch when the repo list changes
    this._repoManager.onDidChangeRepos(
      () => this._syncWatchers(),
      null,
      this._disposables
    );
  }

  private _watchRepo(repoPath: string): void {
    if (this._watchers.has(repoPath)) return;

    const pattern = new vscode.RelativePattern(repoPath, "**/*");
    const watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
      false, // create
      false, // change
      false  // delete
    );

    const handler = (uri: vscode.Uri) => {
      // Skip .git internal changes
      const relative = uri.fsPath.slice(repoPath.length);
      if (
        relative.includes("/.git/") ||
        relative.includes("\\.git\\") ||
        relative.endsWith("/.git") ||
        relative.endsWith("\\.git")
      ) {
        return;
      }
      this._debouncedRefresh(repoPath);
    };

    watcher.onDidCreate(handler);
    watcher.onDidChange(handler);
    watcher.onDidDelete(handler);

    this._watchers.set(repoPath, watcher);
  }

  private _debouncedRefresh(repoPath: string): void {
    const existing = this._debounceTimers.get(repoPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this._debounceTimers.delete(repoPath);
      this._repoManager.refreshRepo(repoPath);
    }, 500);

    this._debounceTimers.set(repoPath, timer);
  }

  private _syncWatchers(): void {
    const currentPaths = new Set(this._repoManager.repos.map((r) => r.path));

    // Remove watchers for repos that no longer exist
    for (const [watchedPath, watcher] of this._watchers) {
      if (!currentPaths.has(watchedPath)) {
        watcher.dispose();
        this._watchers.delete(watchedPath);
      }
    }

    // Add watchers for new repos
    for (const repoPath of currentPaths) {
      if (!this._watchers.has(repoPath)) {
        this._watchRepo(repoPath);
      }
    }
  }

  private disposeWatchers(): void {
    for (const watcher of this._watchers.values()) {
      watcher.dispose();
    }
    this._watchers.clear();
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
  }

  dispose(): void {
    this.disposeWatchers();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
