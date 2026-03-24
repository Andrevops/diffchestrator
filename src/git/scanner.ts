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
  dirsScanned = 0;

  constructor(private git: GitExecutor, maxDepth: number, extraSkipDirs: string[] = []) {
    super();
    this.maxDepth = maxDepth;
    this.extraSkipDirs = new Set([...SKIP_DIRS, ...extraSkipDirs]);
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

    while (queue.length > 0) {
      const { path: dirPath, depth } = queue.shift()!;
      this.dirsScanned++;

      const gitDir = path.join(dirPath, ".git");
      try {
        if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
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
          });
          continue;
        }
      } catch {
        /* stat failure — skip */
      }

      if (depth >= this.maxDepth) continue;

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !this.extraSkipDirs.has(entry.name)) {
            queue.push({
              path: path.join(dirPath, entry.name),
              depth: depth + 1,
            });
          }
        }
      } catch {
        /* permission denied etc */
      }
    }

    return repos;
  }

  /**
   * Phase 2: Fetch git metadata for a repo (branch, status, remote).
   * Called in background after the tree is already visible.
   */
  async fetchMetadata(repo: RepoSummary): Promise<void> {
    try {
      const [remoteUrl, counts] = await Promise.all([
        this.git.getRemoteUrl(repo.path).catch(() => undefined),
        this.git
          .shortStatus(repo.path)
          .catch(() => ({ staged: 0, unstaged: 0, untracked: 0, branch: "HEAD", ahead: 0, behind: 0, headOid: "" })),
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
