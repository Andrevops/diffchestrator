import fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import type { GitExecutor } from "./gitExecutor";
import type { RepoSummary } from "../types";

const SKIP_DIRS = new Set([
  "node_modules",
  ".terraform",
  ".terragrunt-cache",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  "build",
  "dist",
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  "target",
]);

export class Scanner extends EventEmitter {
  private maxDepth: number;
  private extraSkipDirs: Set<string>;
  private _log: ((msg: string) => void) | undefined;
  dirsScanned = 0;

  private git: GitExecutor;

  constructor(git: GitExecutor, maxDepth: number, extraSkipDirs: string[] = [], log?: (msg: string) => void) {
    super();
    this.git = git;
    this.maxDepth = maxDepth;
    this.extraSkipDirs = new Set([...SKIP_DIRS, ...extraSkipDirs]);
    this._log = log;
  }

  /** Directory-walk concurrency. Serial BFS pays one full fs round-trip per
   *  directory, which dominates scan time on WSL/network mounts. */
  private static readonly SCAN_CONCURRENCY = 24;

  /**
   * Phase 1: Fast BFS to find .git directories. No git calls.
   * Directories are walked SCAN_CONCURRENCY at a time (fs.promises, so the
   * extension host event loop isn't blocked) — this runs on activation and
   * in the terminal-click hot path. Returns skeleton RepoSummary objects.
   */
  async scanFast(rootPath: string): Promise<RepoSummary[]> {
    this.dirsScanned = 0;
    const repos: RepoSummary[] = [];
    const queue: Array<{ path: string; depth: number }> = [
      { path: rootPath, depth: 0 },
    ];
    // Index pointer instead of queue.shift() — shift() is O(n) per call
    let head = 0;
    let active = 0;
    this._log?.(`[scan] start BFS root=${rootPath} maxDepth=${this.maxDepth}`);

    await new Promise<void>((resolve) => {
      const pump = (): void => {
        if (active === 0 && head >= queue.length) {
          resolve();
          return;
        }
        while (active < Scanner.SCAN_CONCURRENCY && head < queue.length) {
          const { path: dirPath, depth } = queue[head++];
          active++;
          void this._scanDir(dirPath, depth, queue, repos).then(() => {
            active--;
            pump();
          });
        }
      };
      pump();
    });

    // Concurrent completion order is nondeterministic — sort for stable output
    repos.sort((a, b) => a.path.localeCompare(b.path));
    this._log?.(`[scan] done: ${repos.length} repos found, ${this.dirsScanned} dirs scanned`);
    return repos;
  }

  private async _scanDir(
    dirPath: string,
    depth: number,
    queue: Array<{ path: string; depth: number }>,
    repos: RepoSummary[]
  ): Promise<void> {
    this.dirsScanned++;

    const gitDir = path.join(dirPath, ".git");
    try {
      // .git directory (normal repo) or .git file (worktree/submodule gitdir pointer).
      // Don't require isDirectory() — 9p/drvfs mounts may report wrong type.
      await fs.promises.access(gitDir);
      this._log?.(`[scan] FOUND repo depth=${depth} ${dirPath}`);
      repos.push({
        path: dirPath,
        name: path.basename(dirPath),
        branch: "",
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        totalChanges: 0,
        ahead: 0,
        behind: 0,
        headOid: "",
        stashCount: 0,
      });
      return;
    } catch {
      /* no .git entry */
    }

    if (depth >= this.maxDepth) return;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        let isDir = entry.isDirectory();
        // 9p/drvfs mounts may report DT_UNKNOWN — fall back to stat
        if (!isDir && !entry.isFile() && !entry.isSymbolicLink()) {
          try {
            isDir = (await fs.promises.stat(path.join(dirPath, entry.name))).isDirectory();
          } catch { /* stat failed — treat as non-dir */ }
        }
        if (isDir && !this.extraSkipDirs.has(entry.name)) {
          queue.push({
            path: path.join(dirPath, entry.name),
            depth: depth + 1,
          });
        }
      }
    } catch (err) {
      this._log?.(`[scan] readdir error depth=${depth} ${dirPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Phase 2: Fetch git metadata for a repo (branch, status, remote).
   * Called in background after the tree is already visible.
   */
  async fetchMetadata(repo: RepoSummary): Promise<void> {
    try {
      const [remoteUrl, counts, stashes] = await Promise.all([
        this.git.getRemoteUrl(repo.path).catch(() => undefined),
        this.git
          .shortStatus(repo.path)
          .catch(() => ({ staged: 0, unstaged: 0, untracked: 0, branch: "HEAD", ahead: 0, behind: 0, headOid: "", mergeState: undefined })),
        this.git.stashCount(repo.path).catch(() => 0),
      ]);
      repo.branch = counts.branch;
      repo.remoteUrl = remoteUrl;
      repo.stagedCount = counts.staged;
      repo.unstagedCount = counts.unstaged;
      repo.untrackedCount = counts.untracked;
      repo.totalChanges = counts.staged + counts.unstaged + counts.untracked;
      repo.ahead = counts.ahead;
      repo.behind = counts.behind;
      repo.headOid = counts.headOid;
      repo.mergeState = counts.mergeState;
      repo.stashCount = stashes;
    } catch {
      /* ignore — skeleton data stays */
    }
  }

  /**
   * Legacy: full scan (BFS + metadata). Used by rescan.
   */
  async scan(rootPath: string): Promise<RepoSummary[]> {
    const repos = await this.scanFast(rootPath);
    const CONCURRENCY = 10;
    for (let i = 0; i < repos.length; i += CONCURRENCY) {
      await Promise.all(
        repos.slice(i, i + CONCURRENCY).map((r) => this.fetchMetadata(r))
      );
    }
    return repos;
  }
}
