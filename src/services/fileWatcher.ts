import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { RepoManager } from "./repoManager";

export class FileWatcher implements vscode.Disposable {
  private static readonly GIT_STATE_PATTERN = /^(HEAD|index|COMMIT_EDITMSG|refs|MERGE_HEAD|REBASE_HEAD)/;
  private _watchers = new Map<string, fs.FSWatcher>();
  private _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _repoManager: RepoManager;
  private _disposables: vscode.Disposable[] = [];
  private _suppressUntil = new Map<string, number>();

  constructor(repoManager: RepoManager) {
    this._repoManager = repoManager;
  }

  /**
   * Suppress file watcher refresh for a repo temporarily.
   * Used after explicit refreshRepo() calls to avoid double refresh.
   */
  suppressRefresh(repoPath: string, durationMs = 600): void {
    this._suppressUntil.set(repoPath, Date.now() + durationMs);
  }

  /**
   * Start watching all currently-known repos.
   * Call this after a scan completes.
   */
  watchAll(): void {
    this.disposeWatchers();

    for (const repoPath of this._repoManager.activeRepoPaths) {
      this._watchRepo(repoPath);
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

    const gitDir = path.join(repoPath, ".git");
    try {
      const watcher = fs.watch(gitDir, { persistent: false }, (_event, filename) => {
        // Only react to meaningful git state changes
        if (filename && FileWatcher.GIT_STATE_PATTERN.test(filename)) {
          this._debouncedRefresh(repoPath);
        }
      });
      watcher.on("error", () => {
        // Repo may have been deleted
        this._watchers.delete(repoPath);
      });
      this._watchers.set(repoPath, watcher);
    } catch {
      // .git directory may not exist yet
    }
  }

  private _debouncedRefresh(repoPath: string): void {
    // Check suppression
    const until = this._suppressUntil.get(repoPath);
    if (until && Date.now() < until) return;
    this._suppressUntil.delete(repoPath);

    const existing = this._debounceTimers.get(repoPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this._debounceTimers.delete(repoPath);
      this._repoManager.refreshRepo(repoPath);
    }, 500);

    this._debounceTimers.set(repoPath, timer);
  }

  private _syncWatchers(): void {
    const currentPaths = this._repoManager.activeRepoPaths;

    if (currentPaths.size === 0 && this._watchers.size === 0) return;

    // Remove watchers for repos that no longer exist
    for (const [watchedPath, watcher] of this._watchers) {
      if (!currentPaths.has(watchedPath)) {
        watcher.close();
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
      watcher.close();
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
