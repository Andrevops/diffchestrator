import * as fs from "fs";
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

  constructor(private git: GitExecutor, maxDepth: number, extraSkipDirs: string[] = [], log?: (msg: string) => void) {
    super();
    this.maxDepth = maxDepth;
    this.extraSkipDirs = new Set([...SKIP_DIRS, ...extraSkipDirs]);
    this._log = log;
  }

  /**
   * Phase 1: Fast BFS to find .git directories. No git calls.
   * Returns skeleton RepoSummary objects immediately.
   */
  scanFast(rootPath: string): RepoSummary[] {
    this.dirsScanned = 0;
    const repos: RepoSummary[] = [];
    const queue: Array<{ path: string; depth: number }> = [
      { path: rootPath, depth: 0 },
    ];
    this._log?.(`[scan] start BFS root=${rootPath} maxDepth=${this.maxDepth}`);

    while (queue.length > 0) {
      const { path: dirPath, depth } = queue.shift()!;
      this.dirsScanned++;

      const gitDir = path.join(dirPath, ".git");
      try {
        if (fs.existsSync(gitDir)) {
          // .git directory (normal repo) or .git file (worktree/submodule gitdir pointer).
          // Don't require isDirectory() — 9p/drvfs mounts may report wrong type.
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
          continue;
        }
        this._log?.(`[scan] no .git depth=${depth} ${dirPath}`);
      } catch (err) {
        this._log?.(`[scan] .git check error depth=${depth} ${dirPath}: ${err instanceof Error ? err.message : err}`);
      }

      if (depth >= this.maxDepth) {
        this._log?.(`[scan] maxDepth reached depth=${depth} ${dirPath}`);
        continue;
      }

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          let isDir = entry.isDirectory();
          // 9p/drvfs mounts may report DT_UNKNOWN — fall back to statSync
          if (!isDir && !entry.isFile() && !entry.isSymbolicLink()) {
            try {
              isDir = fs.statSync(path.join(dirPath, entry.name)).isDirectory();
              if (isDir) this._log?.(`[scan] stat fallback: "${entry.name}" is dir (Dirent was unknown) in ${dirPath}`);
            } catch { /* stat failed — treat as non-dir */ }
          }
          const skipped = this.extraSkipDirs.has(entry.name);
          if (isDir && !skipped) {
            queue.push({
              path: path.join(dirPath, entry.name),
              depth: depth + 1,
            });
          } else {
            this._log?.(`[scan] skip entry="${entry.name}" isDir=${isDir} skipped=${skipped} in ${dirPath}`);
          }
        }
      } catch (err) {
        this._log?.(`[scan] readdir error depth=${depth} ${dirPath}: ${err instanceof Error ? err.message : err}`);
      }
    }

    this._log?.(`[scan] done: ${repos.length} repos found, ${this.dirsScanned} dirs scanned`);
    return repos;
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
          .catch(() => ({ staged: 0, unstaged: 0, untracked: 0, branch: "HEAD", ahead: 0, behind: 0, headOid: "" })),
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
    const repos = this.scanFast(rootPath);
    const CONCURRENCY = 10;
    for (let i = 0; i < repos.length; i += CONCURRENCY) {
      await Promise.all(
        repos.slice(i, i + CONCURRENCY).map((r) => this.fetchMetadata(r))
      );
    }
    return repos;
  }
}
