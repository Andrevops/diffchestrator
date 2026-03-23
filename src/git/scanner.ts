import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { GitExecutor } from "./gitExecutor";
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
  private git = new GitExecutor();
  private maxDepth: number;
  private extraSkipDirs: Set<string>;
  dirsScanned = 0;

  constructor(maxDepth: number, extraSkipDirs: string[] = []) {
    super();
    this.maxDepth = maxDepth;
    this.extraSkipDirs = new Set([...SKIP_DIRS, ...extraSkipDirs]);
  }

  async scan(rootPath: string): Promise<RepoSummary[]> {
    this.dirsScanned = 0;
    const repoPaths: string[] = [];
    // BFS
    const queue: Array<{ path: string; depth: number }> = [
      { path: rootPath, depth: 0 },
    ];
    while (queue.length > 0) {
      const { path: dirPath, depth } = queue.shift()!;
      this.dirsScanned++;
      this.emit("progress", {
        dirsScanned: this.dirsScanned,
        reposFound: repoPaths.length,
      });

      const gitDir = path.join(dirPath, ".git");
      try {
        if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
          repoPaths.push(dirPath);
          continue; // Don't recurse into git repos
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

    // Fetch metadata concurrently (higher concurrency for initial scan)
    const repos: RepoSummary[] = [];
    const CONCURRENCY = 10;
    for (let i = 0; i < repoPaths.length; i += CONCURRENCY) {
      const batch = repoPaths.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((p) => this.buildSummary(p))
      );
      for (const r of results) {
        if (r) {
          repos.push(r);
          this.emit("repo", r);
        }
      }
    }
    return repos;
  }

  private async buildSummary(repoPath: string): Promise<RepoSummary | null> {
    try {
      // shortStatus returns branch — no need for separate getBranch call
      const [remoteUrl, counts] = await Promise.all([
        this.git.getRemoteUrl(repoPath).catch(() => undefined),
        this.git
          .shortStatus(repoPath)
          .catch(() => ({ staged: 0, unstaged: 0, untracked: 0, branch: "HEAD", ahead: 0, behind: 0, headOid: "" })),
      ]);
      return {
        path: repoPath,
        name: path.basename(repoPath),
        branch: counts.branch,
        remoteUrl,
        stagedCount: counts.staged,
        unstagedCount: counts.unstaged,
        untrackedCount: counts.untracked,
        totalChanges: counts.staged + counts.unstaged + counts.untracked,
        ahead: counts.ahead,
        behind: counts.behind,
        headOid: counts.headOid,
      };
    } catch {
      return null;
    }
  }
}
