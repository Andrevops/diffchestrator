import * as vscode from "vscode";
import * as fs from "fs";
import type { RepoManager } from "./repoManager";

/**
 * Git-dir entries whose change means repo state (counts, branch, HEAD,
 * ahead/behind, merge state) may have changed. Matched as a prefix so the
 * "<name>.lock" files git writes before renaming also count. FETCH_HEAD and
 * packed-refs cover a terminal `git fetch` (remote-tracking refs themselves
 * live in refs/, which a non-recursive watch doesn't see).
 */
const GIT_STATE_PATTERN =
  /^(HEAD|ORIG_HEAD|FETCH_HEAD|index|packed-refs|COMMIT_EDITMSG|MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|rebase-merge|rebase-apply)/;

export function isGitStateFile(name: string): boolean {
  return GIT_STATE_PATTERN.test(name);
}

export class FileWatcher implements vscode.Disposable {
  private static readonly DEBOUNCE_MS = 500;
  private _watchers = new Map<string, fs.FSWatcher[]>();
  /** Repos whose git dir is being resolved — guards against double-watching. */
  private _pending = new Set<string>();
  private _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _repoManager: RepoManager;
  private _disposables: vscode.Disposable[] = [];
  private _suppressUntil = new Map<string, number>();
  private _disposed = false;

  constructor(repoManager: RepoManager) {
    this._repoManager = repoManager;

    // Re-watch when the repo list changes. Subscribe ONCE here — watchAll()
    // is called after every scan/root switch and must not stack listeners.
    this._repoManager.onDidChangeRepos(
      () => this._syncWatchers(),
      null,
      this._disposables
    );
  }

  /**
   * Defer watcher-driven refreshes for a repo after an explicit refreshRepo().
   * Events arriving inside the window are not dropped: they collapse into
   * ONE trailing refresh scheduled just after the window ends, so changes
   * that land mid-refresh (e.g. the rest of a commit's .git writes) are
   * still picked up.
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
      void this._watchRepo(repoPath);
    }
  }

  private async _watchRepo(repoPath: string): Promise<void> {
    if (this._watchers.has(repoPath) || this._pending.has(repoPath)) return;
    this._pending.add(repoPath);
    let dirs;
    try {
      // .git may be a "gitdir:" file (worktree/submodule) — watch the real dir.
      dirs = await this._repoManager.git.resolveGitDirs(repoPath);
    } finally {
      this._pending.delete(repoPath);
    }
    // Disposed, or the repo left the active set, while we resolved
    if (!dirs || this._disposed || this._watchers.has(repoPath)) return;
    if (!this._repoManager.activeRepoPaths.has(repoPath)) return;

    const targets = dirs.commonDir === dirs.gitDir ? [dirs.gitDir] : [dirs.gitDir, dirs.commonDir];
    const watchers: fs.FSWatcher[] = [];
    for (const dir of targets) {
      try {
        const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
          // Only react to meaningful git state changes
          if (filename && isGitStateFile(filename.toString())) {
            this._debouncedRefresh(repoPath);
          }
        });
        watcher.on("error", () => {
          // Repo may have been deleted
          watcher.close();
          const list = this._watchers.get(repoPath);
          if (list) {
            const rest = list.filter((w) => w !== watcher);
            if (rest.length > 0) this._watchers.set(repoPath, rest);
            else this._watchers.delete(repoPath);
          }
        });
        watchers.push(watcher);
      } catch {
        // git dir may not exist (yet)
      }
    }
    if (watchers.length > 0) this._watchers.set(repoPath, watchers);
  }

  private _debouncedRefresh(repoPath: string): void {
    if (this._disposed) return;
    let delay = FileWatcher.DEBOUNCE_MS;
    const until = this._suppressUntil.get(repoPath);
    if (until !== undefined) {
      const remaining = until - Date.now();
      // Inside a suppression window: push the refresh to just after it
      if (remaining > 0) delay = Math.max(delay, remaining + 50);
      else this._suppressUntil.delete(repoPath);
    }

    const existing = this._debounceTimers.get(repoPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this._debounceTimers.delete(repoPath);
      // fromWatcher: this refresh must not suppress the watcher itself, or
      // the commit's own trailing .git writes would be swallowed.
      if (!this._disposed) void this._repoManager.refreshRepo(repoPath, { fromWatcher: true });
    }, delay);

    this._debounceTimers.set(repoPath, timer);
  }

  private _syncWatchers(): void {
    const currentPaths = this._repoManager.activeRepoPaths;

    if (currentPaths.size === 0 && this._watchers.size === 0) return;

    // Remove watchers for repos that no longer exist
    for (const [watchedPath, watchers] of this._watchers) {
      if (!currentPaths.has(watchedPath)) {
        for (const w of watchers) w.close();
        this._watchers.delete(watchedPath);
      }
    }

    // Add watchers for new repos
    for (const repoPath of currentPaths) {
      if (!this._watchers.has(repoPath)) {
        void this._watchRepo(repoPath);
      }
    }
  }

  private disposeWatchers(): void {
    for (const watchers of this._watchers.values()) {
      for (const w of watchers) w.close();
    }
    this._watchers.clear();
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
  }

  dispose(): void {
    this._disposed = true;
    this.disposeWatchers();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
