import * as vscode from "vscode";
import * as path from "path";
import { Scanner } from "../git/scanner";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoSummary } from "../types";
import { CTX } from "../constants";

const STATE_RECENT_REPOS = "diffchestrator.recentRepoPaths";
const STATE_SELECTED_REPO = "diffchestrator.selectedRepo";
const STATE_CURRENT_ROOT = "diffchestrator.currentRoot";
const STATE_DIRECTORY_PATHS = "diffchestrator.directoryPaths";

export class RepoManager implements vscode.Disposable {
  private _repos = new Map<string, RepoSummary>();
  private _activeRepoPathsCache: Set<string> | undefined;
  private _selectedRepo: string | undefined;
  private _selectedRepoPaths = new Set<string>();
  private _recentRepoPaths: string[] = [];
  private _selectionPerRoot = new Map<string, { selected?: string; multi: string[]; recent: string[] }>();
  /** Cached repo paths per root — populated during scan() and lazily for cross-root lookups */
  private _pathsByRoot = new Map<string, string[]>();
  private _directoryPaths = new Set<string>();
  private _swapTarget: { path: string; root?: string } | undefined;
  private _swappingBack = false;
  private _state: vscode.Memento | undefined;
  private _currentRoot: string | undefined;
  private _changedOnly: boolean;
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;
  private _git = new GitExecutor();
  private _fileWatcher?: { suppressRefresh(repoPath: string, ms?: number): void };
  private _windowFocused = true;
  private _focusDisposable: vscode.Disposable | undefined;

  private _onDidChangeRepos = new vscode.EventEmitter<void>();
  readonly onDidChangeRepos = this._onDidChangeRepos.event;
  private _repoChangeCoalesceTimer: ReturnType<typeof setTimeout> | undefined;

  private _onDidChangeSelection = new vscode.EventEmitter<void>();
  readonly onDidChangeSelection = this._onDidChangeSelection.event;

  // Fired when a new commit is detected in any repo
  private _onDidDetectCommit = new vscode.EventEmitter<{ repoPath: string; repoName: string }>();
  readonly onDidDetectCommit = this._onDidDetectCommit.event;

  // Fired when a clean repo gets new changes (debounced — waits for quiet period)
  private _onDidDetectChanges = new vscode.EventEmitter<{ repoPath: string; repoName: string; count: number }>();
  readonly onDidDetectChanges = this._onDidDetectChanges.event;
  private _changesDebounce = new Map<string, ReturnType<typeof setTimeout>>();

  private _onDidScanProgress = new vscode.EventEmitter<{
    dirsScanned: number;
    reposFound: number;
  }>();
  readonly onDidScanProgress = this._onDidScanProgress.event;

  constructor(state?: vscode.Memento) {
    this._state = state;
    const config = vscode.workspace.getConfiguration("diffchestrator");
    this._changedOnly = config.get<boolean>("changedOnlyDefault", true);
    vscode.commands.executeCommand("setContext", CTX.changedOnly, this._changedOnly);

    // Restore persisted state
    if (state) {
      this._recentRepoPaths = state.get<string[]>(STATE_RECENT_REPOS, []);
      this._selectedRepo = state.get<string | undefined>(STATE_SELECTED_REPO, undefined);
      this._currentRoot = state.get<string | undefined>(STATE_CURRENT_ROOT, undefined);
      for (const p of state.get<string[]>(STATE_DIRECTORY_PATHS, [])) {
        this._directoryPaths.add(p);
      }
      if (this._selectedRepo) {
        vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, true);
      }
    }
  }

  private _taggedPathsCache: Set<string> | undefined;

  get repos(): RepoSummary[] {
    const all = [...this._repos.values()];
    if (!this._tagFilter) return all;
    if (!this._taggedPathsCache) {
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const tags: Record<string, string[]> = config.get("repoTags", {});
      this._taggedPathsCache = new Set(tags[this._tagFilter] ?? []);
    }
    return all.filter((r) => this._taggedPathsCache!.has(r.path));
  }

  get activeRepoPaths(): Set<string> {
    if (!this._activeRepoPathsCache) {
      if (!this._tagFilter) {
        this._activeRepoPathsCache = new Set(this._repos.keys());
      } else {
        const config = vscode.workspace.getConfiguration("diffchestrator");
        const tags: Record<string, string[]> = config.get("repoTags", {});
        const tagged = new Set(tags[this._tagFilter] ?? []);
        const active = new Set<string>();
        for (const path of this._repos.keys()) {
          if (tagged.has(path)) {
            active.add(path);
          }
        }
        this._activeRepoPathsCache = active;
      }
    }
    return this._activeRepoPathsCache;
  }

  get allRepos(): RepoSummary[] {
    return [...this._repos.values()];
  }

  /** Get repo paths across ALL configured roots (current + other roots). */
  getAllRootRepoPaths(): { root: string; repoPath: string; repoName: string }[] {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const roots = config.get<string[]>("scanRoots", []);
    const maxDepth = config.get<number>("scanMaxDepth", 6);
    const extraSkip = config.get<string[]>("scanExtraSkipDirs", []);
    const result: { root: string; repoPath: string; repoName: string }[] = [];

    for (const root of roots) {
      if (root === this._currentRoot) {
        // Use already-scanned repos for current root
        for (const r of this._repos.values()) {
          result.push({ root, repoPath: r.path, repoName: r.name });
        }
      } else {
        // Lazily discover repos for other roots
        if (!this._pathsByRoot.has(root)) {
          const scanner = new Scanner(this._git, maxDepth, extraSkip);
          this._pathsByRoot.set(root, scanner.scanFast(root).map((r) => r.path));
        }
        for (const p of this._pathsByRoot.get(root) ?? []) {
          result.push({ root, repoPath: p, repoName: path.basename(p) });
        }
      }
    }
    return result;
  }

  /** Check if a path is tracked as a directory (not a repo). */
  isDirectory(p: string): boolean {
    return this._directoryPaths.has(p) && !this._repos.has(p);
  }

  /** All tracked directory paths. */
  get directoryPaths(): ReadonlySet<string> {
    return this._directoryPaths;
  }

  /** Add a directory to Active Repos and select it. */
  addDirectoryPath(dirPath: string): void {
    this._directoryPaths.add(dirPath);
    this.selectRepo(dirPath);
  }

  /** Remove a directory from tracking. */
  removeDirectoryPath(dirPath: string): void {
    this._directoryPaths.delete(dirPath);
    this._persistState();
  }

  setTagFilter(tag: string | undefined): void {
    this._tagFilter = tag;
    this._taggedPathsCache = undefined;
    this._activeRepoPathsCache = undefined;
    this._onDidChangeRepos.fire();
  }

  get activeTagFilter(): string | undefined {
    return this._tagFilter;
  }

  restoreRecent(recent: string[], selected?: string): void {
    this._recentRepoPaths = recent;
    this._selectedRepo = selected;
    if (selected) {
      vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, true);
    }
    this._persistState();
    this._onDidChangeSelection.fire();
  }
  private _persistState(): void {
    if (!this._state) return;
    this._state.update(STATE_RECENT_REPOS, this._recentRepoPaths);
    this._state.update(STATE_SELECTED_REPO, this._selectedRepo);
    this._state.update(STATE_CURRENT_ROOT, this._currentRoot);
    this._state.update(STATE_DIRECTORY_PATHS, [...this._directoryPaths]);
  }

  get selectedRepoPaths(): ReadonlySet<string> {
    return this._selectedRepoPaths;
  }
  get selectedRepo(): string | undefined {
    return this._selectedRepo;
  }
  get recentRepoPaths(): readonly string[] {
    return this._recentRepoPaths;
  }
  get currentRoot(): string | undefined {
    return this._currentRoot;
  }

  get changedOnly(): boolean {
    return this._changedOnly;
  }
  get git(): GitExecutor {
    return this._git;
  }

  get windowFocused(): boolean {
    return this._windowFocused;
  }

  private _tagFilter: string | undefined;

  set fileWatcher(fw: { suppressRefresh(repoPath: string, ms?: number): void }) {
    this._fileWatcher = fw;
  }

  getRepo(repoPath: string): RepoSummary | undefined {
    return this._repos.get(repoPath);
  }

  /** Coalesce rapid repo-change events into one fire per tick */
  private _fireRepoChangeCoalesced(): void {
    if (this._repoChangeCoalesceTimer) return;
    this._repoChangeCoalesceTimer = setTimeout(() => {
      this._repoChangeCoalesceTimer = undefined;
      this._onDidChangeRepos.fire();
    }, 50);
  }

  async scan(rootPath: string): Promise<void> {
    // Save current root's selection state before switching
    if (this._currentRoot) {
      this._selectionPerRoot.set(this._currentRoot, {
        selected: this._selectedRepo,
        multi: [...this._selectedRepoPaths],
        recent: [...this._recentRepoPaths],
      });
    }

    // Save swap target before clearing selection (so swap works after root switch)
    if (!this._swappingBack && this._selectedRepo) {
      this._swapTarget = { path: this._selectedRepo, root: this._currentRoot };
    }

    this._currentRoot = rootPath;
    this._repos.clear();
    this._activeRepoPathsCache = undefined;

    // Restore previous selection for this root (if any)
    const saved = this._selectionPerRoot.get(rootPath);
    if (saved) {
      this._selectedRepo = saved.selected;
      this._selectedRepoPaths = new Set(saved.multi);
      this._recentRepoPaths = saved.recent;
      vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, !!saved.selected);
      vscode.commands.executeCommand("setContext", CTX.hasMultiSelection, saved.multi.length > 0);
    } else {
      this._selectedRepo = undefined;
      this._selectedRepoPaths.clear();
      vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, false);
      vscode.commands.executeCommand("setContext", CTX.hasMultiSelection, false);
    }
    this._onDidChangeSelection.fire();
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const maxDepth = config.get<number>("scanMaxDepth", 6);
    const extraSkip = config.get<string[]>("scanExtraSkipDirs", []);

    const scanner = new Scanner(this._git, maxDepth, extraSkip);

    // Phase 1: Fast BFS — no git calls, repos appear instantly
    const repos = scanner.scanFast(rootPath);
    for (const r of repos) {
      this._repos.set(r.path, r);
    }
    this._activeRepoPathsCache = undefined;
    vscode.commands.executeCommand("setContext", CTX.hasRepos, this._repos.size > 0);
    this._onDidChangeRepos.fire();

    // Phase 2: Fetch git metadata in background, update tree as batches complete
    const BATCH = 10;
    const fetchOnScan = config.get<boolean>("fetchOnScan", false);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Diffchestrator: Scanning repos${fetchOnScan ? " + fetching" : ""}` },
      async (progress) => {
        for (let i = 0; i < repos.length; i += BATCH) {
          progress.report({ message: `${Math.min(i + BATCH, repos.length)}/${repos.length}` });
          await Promise.all(repos.slice(i, i + BATCH).map(async (r) => {
            await scanner.fetchMetadata(r);
            if (fetchOnScan) {
              try { await this._git.fetch(r.path); } catch { /* ignore fetch failures */ }
            }
          }));
          this._fireRepoChangeCoalesced();
        }
      }
    );

    this._pathsByRoot.set(rootPath, repos.map((r) => r.path));

    this.startAutoRefresh();
  }

  /**
   * Find a repo in a non-current scan root by matching the terminal name
   * against repo basenames. Lazily discovers repos via scanFast (BFS, no
   * git calls) for roots not yet cached.
   */
  findRepoInOtherRoots(terminalName: string): { root: string; path: string } | undefined {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const roots = config.get<string[]>("scanRoots", []);
    const maxDepth = config.get<number>("scanMaxDepth", 6);
    const extraSkip = config.get<string[]>("scanExtraSkipDirs", []);

    for (const root of roots) {
      if (root === this._currentRoot) continue;

      // Lazily discover repo paths for this root
      if (!this._pathsByRoot.has(root)) {
        const scanner = new Scanner(this._git, maxDepth, extraSkip);
        this._pathsByRoot.set(root, scanner.scanFast(root).map((r) => r.path));
      }

      const paths = this._pathsByRoot.get(root) ?? [];
      // Longest basename first to avoid partial matches ("foo" matching "foo-bar")
      const sorted = [...paths].sort(
        (a, b) => path.basename(b).length - path.basename(a).length
      );

      for (const p of sorted) {
        if (terminalName.includes(path.basename(p))) {
          return { root, path: p };
        }
      }
    }
    return undefined;
  }

  async refreshRepo(repoPath: string): Promise<void> {
    // Suppress file watcher to avoid double refresh
    this._fileWatcher?.suppressRefresh(repoPath);
    // Invalidate status cache so Changed Files view gets fresh data
    this._git.invalidateStatus(repoPath);
    try {
      // shortStatus now returns branch too — single git process instead of two
      const s = await this._git.shortStatus(repoPath);
      const existing = this._repos.get(repoPath);
      if (!existing) return;

      const totalChanges = s.staged + s.unstaged + s.untracked;

      // Only fire event if something actually changed
      if (
        existing.stagedCount === s.staged &&
        existing.unstagedCount === s.unstaged &&
        existing.untrackedCount === s.untracked &&
        existing.branch === s.branch &&
        existing.ahead === s.ahead &&
        existing.behind === s.behind &&
        existing.headOid === s.headOid
      ) {
        return; // nothing changed, skip cascade
      }

      // Detect new commit (HEAD changed)
      const newCommit = existing.headOid && s.headOid && existing.headOid !== s.headOid;
      // Detect new changes on a previously clean repo
      const newChanges = existing.totalChanges === 0 && totalChanges > 0;

      existing.stagedCount = s.staged;
      existing.unstagedCount = s.unstaged;
      existing.untrackedCount = s.untracked;
      existing.totalChanges = totalChanges;
      existing.branch = s.branch;
      existing.ahead = s.ahead;
      existing.behind = s.behind;
      existing.headOid = s.headOid;
      this._fireRepoChangeCoalesced();

      // Fire specific notifications (after state update)
      const repoName = existing.name;
      if (newCommit) {
        // Commit notification fires immediately — work is done
        this._onDidDetectCommit.fire({ repoPath, repoName });
        // Clear any pending changes debounce since the commit supersedes it
        const pendingTimer = this._changesDebounce.get(repoPath);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          this._changesDebounce.delete(repoPath);
        }
      }
      if (newChanges) {
        // Debounce changes notification — wait 15s of quiet before firing,
        // so we don't notify mid-edit while Claude is still working
        const existingTimer = this._changesDebounce.get(repoPath);
        if (existingTimer) clearTimeout(existingTimer);
        this._changesDebounce.set(repoPath, setTimeout(() => {
          this._changesDebounce.delete(repoPath);
          // Re-check: still has changes and no commit happened since
          const current = this._repos.get(repoPath);
          if (current && current.totalChanges > 0) {
            this._onDidDetectChanges.fire({ repoPath, repoName, count: current.totalChanges });
          }
        }, 15_000));
      }
    } catch {
      /* ignore */
    }
  }

  async refreshAll(): Promise<void> {
    const repos = [...this._repos.keys()];
    if (repos.length === 0) return;
    const BATCH = 10;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Diffchestrator: Refreshing" },
      async (progress) => {
        for (let i = 0; i < repos.length; i += BATCH) {
          progress.report({ message: `${Math.min(i + BATCH, repos.length)}/${repos.length}` });
          await Promise.all(repos.slice(i, i + BATCH).map((p) => this.refreshRepo(p)));
        }
      }
    );
  }

  /**
   * Remove a repo from the recent list. If it was the active repo,
   * select the next one or clear selection.
   */
  closeRecentRepo(repoPath: string): void {
    this._recentRepoPaths = this._recentRepoPaths.filter((p) => p !== repoPath);
    this._directoryPaths.delete(repoPath);
    if (this._selectedRepo === repoPath) {
      if (this._recentRepoPaths.length > 0) {
        this._selectedRepo = this._recentRepoPaths[0];
      } else {
        this._selectedRepo = undefined;
        vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, false);
      }
    }
    this._persistState();
    this._onDidChangeSelection.fire();
  }

  clearAllRecentRepos(): void {
    this._recentRepoPaths = [];
    this._directoryPaths.clear();
    this._selectedRepo = undefined;
    vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, false);
    this._persistState();
    this._onDidChangeSelection.fire();
  }

  private _freezeMru = false;

  get swapTarget(): { path: string; root?: string } | undefined {
    return this._swapTarget;
  }

  setSwapTarget(target: { path: string; root?: string }): void {
    this._swapTarget = target;
  }

  beginSwap(): void {
    this._swappingBack = true;
  }

  endSwap(): void {
    this._swappingBack = false;
  }

  selectRepo(repoPath: string): void {
    // Track swap target: save current position before switching (skip during swap-back)
    if (!this._swappingBack && this._selectedRepo && this._selectedRepo !== repoPath) {
      this._swapTarget = { path: this._selectedRepo, root: this._currentRoot };
    }
    this._selectedRepo = repoPath;
    // Track recent repos (MRU order, capped at 10) — skip re-sort during cycle
    if (!this._freezeMru) {
      this._recentRepoPaths = [
        repoPath,
        ...this._recentRepoPaths.filter((p) => p !== repoPath),
      ].slice(0, 10);
    }
    vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, true);
    this._persistState();
    this._onDidChangeSelection.fire();
  }

  /**
   * Rotate through all visible repos (favorites + recent, deduplicated,
   * filtered by current root). Cycles without MRU re-sort.
   */
  cycleNextRepo(): string | undefined {
    const root = this._currentRoot;
    const isUnderRoot = (p: string) => !root || p.startsWith(root + path.sep);

    // Cycle through all recently opened repos (which includes any opened favorites),
    // filtered by current root
    const cyclePaths = this._recentRepoPaths.filter(
      (p) => isUnderRoot(p) && (this._repos.has(p) || this._directoryPaths.has(p))
    );

    if (cyclePaths.length < 2) return undefined;

    const currentIdx = cyclePaths.indexOf(this._selectedRepo ?? "");
    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % cyclePaths.length : 0;
    // Freeze MRU so the subsequent selectRepo (from viewDiff) doesn't re-sort
    this._freezeMru = true;
    setTimeout(() => { this._freezeMru = false; }, 500);

    this._selectedRepo = cyclePaths[nextIdx];
    vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, true);
    this._persistState();
    this._onDidChangeSelection.fire();
    return this._selectedRepo;
  }

  toggleRepoSelection(repoPath: string): void {
    if (this._selectedRepoPaths.has(repoPath)) {
      this._selectedRepoPaths.delete(repoPath);
    } else {
      this._selectedRepoPaths.add(repoPath);
    }
    vscode.commands.executeCommand(
      "setContext",
      CTX.hasMultiSelection,
      this._selectedRepoPaths.size > 0
    );
    this._onDidChangeSelection.fire();
  }

  clearMultiSelection(): void {
    this._selectedRepoPaths.clear();
    vscode.commands.executeCommand("setContext", CTX.hasMultiSelection, false);
    this._onDidChangeSelection.fire();
  }

  toggleChangedOnly(): void {
    this._changedOnly = !this._changedOnly;
    vscode.commands.executeCommand("setContext", CTX.changedOnly, this._changedOnly);
    this._onDidChangeRepos.fire();
  }

  private startAutoRefresh(): void {
    if (this._refreshTimer) clearInterval(this._refreshTimer);

    this._focusDisposable?.dispose();
    this._focusDisposable = vscode.window.onDidChangeWindowState((state) => {
      this._windowFocused = state.focused;
      if (state.focused) {
        // Reset timer first to prevent it from firing during/after our refresh
        this._resetTimer();
        this.refreshAll();
      }
    });

    this._resetTimer();
  }

  private _resetTimer(): void {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const interval = config.get<number>("autoRefreshInterval", 10);
    if (interval > 0) {
      this._refreshTimer = setInterval(() => {
        if (this._windowFocused) {
          this.refreshAll();
        }
      }, interval * 1000);
    }
  }

  dispose(): void {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._focusDisposable?.dispose();
    for (const timer of this._changesDebounce.values()) clearTimeout(timer);
    this._changesDebounce.clear();
    this._onDidChangeRepos.dispose();
    this._onDidChangeSelection.dispose();
    this._onDidDetectCommit.dispose();
    this._onDidDetectChanges.dispose();
    this._onDidScanProgress.dispose();
  }
}
