import * as vscode from "vscode";
import { Scanner } from "../git/scanner";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoSummary } from "../types";
import { CTX } from "../constants";

export class RepoManager implements vscode.Disposable {
  private _repos = new Map<string, RepoSummary>();
  private _selectedRepo: string | undefined;
  private _selectedRepoPaths = new Set<string>();
  private _currentRoot: string | undefined;
  private _changedOnly: boolean;
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;
  private _git = new GitExecutor();

  private _onDidChangeRepos = new vscode.EventEmitter<void>();
  readonly onDidChangeRepos = this._onDidChangeRepos.event;

  private _onDidChangeSelection = new vscode.EventEmitter<void>();
  readonly onDidChangeSelection = this._onDidChangeSelection.event;

  private _onDidScanProgress = new vscode.EventEmitter<{
    dirsScanned: number;
    reposFound: number;
  }>();
  readonly onDidScanProgress = this._onDidScanProgress.event;

  constructor() {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    this._changedOnly = config.get<boolean>("changedOnlyDefault", true);
    vscode.commands.executeCommand("setContext", CTX.changedOnly, this._changedOnly);
  }

  get repos(): RepoSummary[] {
    return [...this._repos.values()];
  }
  get selectedRepo(): string | undefined {
    return this._selectedRepo;
  }
  get selectedRepoPaths(): Set<string> {
    return this._selectedRepoPaths;
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

  getRepo(repoPath: string): RepoSummary | undefined {
    return this._repos.get(repoPath);
  }

  async scan(rootPath: string): Promise<void> {
    this._currentRoot = rootPath;
    this._repos.clear();
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const maxDepth = config.get<number>("scanMaxDepth", 6);
    const extraSkip = config.get<string[]>("scanExtraSkipDirs", []);

    const scanner = new Scanner(maxDepth, extraSkip);
    scanner.on("progress", (p) => this._onDidScanProgress.fire(p));

    const repos = await scanner.scan(rootPath);
    for (const r of repos) {
      this._repos.set(r.path, r);
    }
    vscode.commands.executeCommand("setContext", CTX.hasRepos, this._repos.size > 0);
    this._onDidChangeRepos.fire();
    this.startAutoRefresh();
  }

  async refreshRepo(repoPath: string): Promise<void> {
    try {
      const counts = await this._git.shortStatus(repoPath);
      const branch = await this._git.getBranch(repoPath);
      const existing = this._repos.get(repoPath);
      if (existing) {
        existing.stagedCount = counts.staged;
        existing.unstagedCount = counts.unstaged;
        existing.untrackedCount = counts.untracked;
        existing.totalChanges = counts.staged + counts.unstaged + counts.untracked;
        existing.branch = branch;
        this._onDidChangeRepos.fire();
      }
    } catch {
      /* ignore */
    }
  }

  async refreshAll(): Promise<void> {
    await Promise.all([...this._repos.keys()].map((p) => this.refreshRepo(p)));
  }

  selectRepo(repoPath: string): void {
    this._selectedRepo = repoPath;
    vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, true);
    this._onDidChangeSelection.fire();
  }

  clearSelectedRepo(): void {
    this._selectedRepo = undefined;
    vscode.commands.executeCommand("setContext", CTX.hasSelectedRepo, false);
    this._onDidChangeSelection.fire();
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
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const interval = config.get<number>("autoRefreshInterval", 10);
    if (interval > 0) {
      this._refreshTimer = setInterval(() => this.refreshAll(), interval * 1000);
    }
  }

  dispose(): void {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._onDidChangeRepos.dispose();
    this._onDidChangeSelection.dispose();
    this._onDidScanProgress.dispose();
  }
}
