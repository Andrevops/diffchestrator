import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import type { RepoStatus, FileChange, CommitEntry } from "../types.ts";
import { ChangeType, FileStatus } from "../types.ts";

const execFileAsync = promisify(execFile);

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitExecutor {
  // Short-TTL cache for status() to deduplicate concurrent calls
  private _statusCache = new Map<string, { result: RepoStatus; time: number }>();
  private _statusInflight = new Map<string, Promise<RepoStatus>>();
  private static readonly STATUS_CACHE_TTL = 1000; // ms

  // Metadata cache (30s TTL) for frequently accessed data
  private _metaCache = new Map<string, { value: unknown; time: number }>();
  private static readonly META_CACHE_TTL = 30_000; // ms

  private _getCachedMeta<T>(key: string): T | undefined {
    const entry = this._metaCache.get(key);
    if (entry && Date.now() - entry.time < GitExecutor.META_CACHE_TTL) {
      return entry.value as T;
    }
    return undefined;
  }

  private _setCachedMeta(key: string, value: unknown): void {
    this._metaCache.set(key, { value, time: Date.now() });
  }

  invalidateMetaCache(repoPath?: string): void {
    if (repoPath) {
      for (const key of this._metaCache.keys()) {
        if (key.startsWith(repoPath)) this._metaCache.delete(key);
      }
    } else {
      this._metaCache.clear();
    }
  }

  private async _run(args: string[], cwd: string): Promise<RunResult> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return { stdout, stderr, code: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(err),
        code: e.code ?? 1,
      };
    }
  }

  private _validateFilePath(repoPath: string, file: string): void {
    const resolved = path.resolve(repoPath, file);
    if (!resolved.startsWith(path.resolve(repoPath) + path.sep) && resolved !== path.resolve(repoPath)) {
      throw new Error(`Path traversal detected: ${file}`);
    }
  }

  invalidateStatus(repoPath: string): void {
    this._statusCache.delete(repoPath);
  }

  async isGitRepo(dirPath: string): Promise<boolean> {
    const gitDir = path.join(dirPath, ".git");
    try {
      const stat = fs.statSync(gitDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async status(repoPath: string): Promise<RepoStatus> {
    // Return cached result if fresh
    const cached = this._statusCache.get(repoPath);
    if (cached && Date.now() - cached.time < GitExecutor.STATUS_CACHE_TTL) {
      return cached.result;
    }

    // Deduplicate: if a call is already in-flight for this repo, return the same Promise
    const inflight = this._statusInflight.get(repoPath);
    if (inflight) return inflight;

    const promise = this._statusUncached(repoPath);
    this._statusInflight.set(repoPath, promise);
    try {
      return await promise;
    } finally {
      this._statusInflight.delete(repoPath);
    }
  }

  private async _statusUncached(repoPath: string): Promise<RepoStatus> {
    const result = await this._run(
      ["status", "--porcelain=v2", "--branch", "-uall"],
      repoPath
    );

    let branch = "HEAD";
    let upstream: string | undefined;
    let ahead = 0;
    let behind = 0;
    const staged: FileChange[] = [];
    const unstaged: FileChange[] = [];
    const untracked: FileChange[] = [];

    for (const line of result.stdout.split("\n")) {
      if (!line) {
        continue;
      }

      if (line.startsWith("# branch.head ")) {
        branch = line.slice("# branch.head ".length);
      } else if (line.startsWith("# branch.upstream ")) {
        upstream = line.slice("# branch.upstream ".length);
      } else if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          ahead = parseInt(match[1], 10);
          behind = parseInt(match[2], 10);
        }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const parts = line.split(" ");
        const xy = parts[1];
        const isRename = line.startsWith("2 ");

        let filePath: string;
        let oldPath: string | undefined;

        if (isRename) {
          // Format: 2 XY sub mH mI mW hH hI score path\torigPath
          const tabIndex = line.indexOf("\t");
          const pathPart = line.slice(line.lastIndexOf(" ", tabIndex) + 1);
          const pathParts = pathPart.split("\t");
          filePath = pathParts[0];
          oldPath = pathParts[1];
        } else {
          // Format: 1 XY sub mH mI mW hH hI path
          filePath = parts.slice(8).join(" ");
        }

        const indexStatus = xy[0];
        const worktreeStatus = xy[1];

        // Staged change (index column)
        if (indexStatus !== ".") {
          staged.push({
            path: filePath,
            oldPath,
            changeType: this._parseChangeType(indexStatus),
            status: FileStatus.Staged,
          });
        }

        // Unstaged change (worktree column)
        if (worktreeStatus !== ".") {
          unstaged.push({
            path: filePath,
            oldPath,
            changeType: this._parseChangeType(worktreeStatus),
            status: FileStatus.Unstaged,
          });
        }
      } else if (line.startsWith("? ")) {
        const filePath = line.slice(2);
        untracked.push({
          path: filePath,
          changeType: ChangeType.Added,
          status: FileStatus.Untracked,
        });
      } else if (line.startsWith("u ")) {
        // Unmerged entry
        const parts = line.split(" ");
        const filePath = parts.slice(10).join(" ");
        unstaged.push({
          path: filePath,
          changeType: ChangeType.Unmerged,
          status: FileStatus.Unstaged,
        });
      }
    }

    const statusResult = { branch, upstream, ahead, behind, staged, unstaged, untracked };
    this._statusCache.set(repoPath, { result: statusResult, time: Date.now() });
    return statusResult;
  }

  async shortStatus(
    repoPath: string
  ): Promise<{ staged: number; unstaged: number; untracked: number; branch: string; ahead: number; behind: number; headOid: string }> {
    const result = await this._run(
      ["status", "--porcelain=v2", "--branch", "-uall"],
      repoPath
    );

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    let branch = "HEAD";
    let ahead = 0;
    let behind = 0;
    let headOid = "";

    for (const line of result.stdout.split("\n")) {
      if (!line) {
        continue;
      }
      if (line.startsWith("# branch.oid ")) {
        headOid = line.slice("# branch.oid ".length);
      } else if (line.startsWith("# branch.head ")) {
        branch = line.slice("# branch.head ".length);
      } else if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          ahead = parseInt(match[1], 10);
          behind = parseInt(match[2], 10);
        }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const xy = line.split(" ")[1];
        if (xy[0] !== ".") staged++;
        if (xy[1] !== ".") unstaged++;
      } else if (line.startsWith("? ")) {
        untracked++;
      } else if (line.startsWith("u ")) {
        unstaged++;
      }
    }

    return { staged, unstaged, untracked, branch, ahead, behind, headOid };
  }

  async diff(
    repoPath: string,
    staged?: boolean,
    file?: string
  ): Promise<string> {
    const args = ["diff"];
    if (staged) {
      args.push("--cached");
    }
    args.push("--no-color");
    if (file) {
      this._validateFilePath(repoPath, file);
      args.push("--", file);
    }
    const result = await this._run(args, repoPath);
    return result.stdout;
  }

  async stage(repoPath: string, files: string[]): Promise<void> {
    for (const f of files) {
      this._validateFilePath(repoPath, f);
    }
    await this._run(["add", "--", ...files], repoPath);
    this._statusCache.delete(repoPath);
  }

  async unstage(repoPath: string, files: string[]): Promise<void> {
    for (const f of files) {
      this._validateFilePath(repoPath, f);
    }
    await this._run(["reset", "HEAD", "--", ...files], repoPath);
    this._statusCache.delete(repoPath);
  }

  async commit(repoPath: string, message: string): Promise<string> {
    const result = await this._run(["commit", "-m", message], repoPath);
    this._statusCache.delete(repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Commit failed");
    }
    return result.stdout;
  }

  async push(repoPath: string, force = false): Promise<string> {
    const args = ["push"];
    if (force) {
      args.push("--force-with-lease");
    }
    const result = await this._run(args, repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Push failed");
    }
    return result.stdout || result.stderr;
  }

  async getBranch(repoPath: string): Promise<string> {
    const result = await this._run(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoPath
    );
    return result.stdout.trim() || "HEAD";
  }

  async resetSoft(repoPath: string, ref = "HEAD~1"): Promise<void> {
    const result = await this._run(["reset", "--soft", ref], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Reset failed");
    }
  }

  async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    const cacheKey = `${repoPath}:remoteUrl`;
    const cached = this._getCachedMeta<string>(cacheKey);
    if (cached !== undefined) return cached;
    const result = await this._run(
      ["remote", "get-url", "origin"],
      repoPath
    );
    const url = result.stdout.trim() || undefined;
    if (url) this._setCachedMeta(cacheKey, url);
    return url;
  }

  async log(repoPath: string, count = 10): Promise<CommitEntry[]> {
    const result = await this._run(
      [
        "log",
        `-${count}`,
        "--format=%H%n%h%n%an%n%ai%n%s%n---END---",
      ],
      repoPath
    );

    if (!result.stdout.trim()) {
      return [];
    }

    const entries: CommitEntry[] = [];
    const blocks = result.stdout.split("---END---\n");

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      if (lines.length >= 5) {
        entries.push({
          hash: lines[0],
          shortHash: lines[1],
          author: lines[2],
          date: lines[3],
          message: lines.slice(4).join("\n"),
        });
      }
    }

    return entries;
  }

  async logSince(
    repoPath: string,
    since: string,
    count = 50
  ): Promise<CommitEntry[]> {
    const result = await this._run(
      [
        "log",
        `--since=${since}`,
        `-${count}`,
        "--format=%H%n%h%n%an%n%ai%n%s%n---END---",
      ],
      repoPath
    );

    if (!result.stdout.trim()) {
      return [];
    }

    const entries: CommitEntry[] = [];
    const blocks = result.stdout.split("---END---\n");

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      if (lines.length >= 5) {
        entries.push({
          hash: lines[0],
          shortHash: lines[1],
          author: lines[2],
          date: lines[3],
          message: lines.slice(4).join("\n"),
        });
      }
    }

    return entries;
  }

  async lastCommitDate(repoPath: string): Promise<string | undefined> {
    const cacheKey = `${repoPath}:lastCommitDate`;
    const cached = this._getCachedMeta<string>(cacheKey);
    if (cached !== undefined) return cached;
    const result = await this._run(
      ["log", "-1", "--format=%ai"],
      repoPath
    );
    const date = result.stdout.trim() || undefined;
    if (date) this._setCachedMeta(cacheKey, date);
    return date;
  }

  /**
   * Combined: get commits since a date AND the most recent commit date in one call.
   * Saves one git process vs calling logSince + lastCommitDate separately.
   */
  async logSinceWithDate(
    repoPath: string,
    since: string,
    count = 50
  ): Promise<{ lastDate: string | undefined; commits: CommitEntry[] }> {
    // Get lastCommitDate from cache or single call
    const lastDate = await this.lastCommitDate(repoPath);
    // Get session commits
    const commits = await this.logSince(repoPath, since, count);
    return { lastDate, commits };
  }

  async show(repoPath: string, ref: string): Promise<string> {
    if (ref.startsWith("-")) return ""; // block flag injection
    const result = await this._run(["show", ref], repoPath);
    if (result.code !== 0) {
      return "";
    }
    return result.stdout;
  }

  async fetch(repoPath: string): Promise<string> {
    const result = await this._run(["fetch", "--prune"], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Fetch failed");
    }
    return result.stdout || result.stderr;
  }

  async pull(repoPath: string): Promise<string> {
    const result = await this._run(["pull"], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Pull failed");
    }
    return result.stdout || result.stderr;
  }

  async diffStatFile(repoPath: string, file: string, staged: boolean): Promise<{ additions: number; deletions: number }> {
    const args = staged
      ? ["diff", "--cached", "--numstat", "--", file]
      : ["diff", "--numstat", "--", file];
    const result = await this._run(args, repoPath);
    if (result.code !== 0 || !result.stdout.trim()) return { additions: 0, deletions: 0 };
    const parts = result.stdout.trim().split("\t");
    return {
      additions: parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0,
      deletions: parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0,
    };
  }

  async stashCount(repoPath: string): Promise<number> {
    const cacheKey = `${repoPath}:stashCount`;
    const cached = this._getCachedMeta<number>(cacheKey);
    if (cached !== undefined) return cached;
    const result = await this._run(["stash", "list"], repoPath);
    if (result.code !== 0 || !result.stdout.trim()) return 0;
    const count = result.stdout.trim().split("\n").length;
    this._setCachedMeta(cacheKey, count);
    return count;
  }

  async branches(repoPath: string): Promise<{ name: string; current: boolean }[]> {
    const result = await this._run(["branch", "--list", "--no-color"], repoPath);
    if (!result.stdout.trim()) return [];
    return result.stdout.split("\n").filter(l => l.trim()).map(line => ({
      name: line.replace(/^\*?\s+/, "").trim(),
      current: line.startsWith("*"),
    }));
  }

  async checkout(repoPath: string, branch: string): Promise<string> {
    const result = await this._run(["checkout", branch], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Checkout failed");
    }
    return result.stdout || result.stderr;
  }

  async createBranch(repoPath: string, branch: string): Promise<string> {
    const result = await this._run(["checkout", "-b", branch], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Branch creation failed");
    }
    return result.stdout || result.stderr;
  }

  async checkoutFile(repoPath: string, file: string): Promise<void> {
    this._validateFilePath(repoPath, file);
    const result = await this._run(["checkout", "--", file], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Discard failed");
    }
  }

  async checkoutAll(repoPath: string): Promise<void> {
    const result = await this._run(["checkout", "--", "."], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Discard all failed");
    }
  }

  async clean(repoPath: string): Promise<string> {
    const result = await this._run(["clean", "-fd"], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Clean failed");
    }
    return result.stdout;
  }

  async cleanFile(repoPath: string, file: string): Promise<void> {
    this._validateFilePath(repoPath, file);
    const result = await this._run(["clean", "-f", "--", file], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Clean file failed");
    }
  }

  async stashList(repoPath: string): Promise<{ index: number; message: string }[]> {
    const result = await this._run(["stash", "list"], repoPath);
    if (!result.stdout.trim()) return [];
    return result.stdout.split("\n").filter(l => l.trim()).map((line, i) => ({
      index: i,
      message: line,
    }));
  }

  async stashPush(repoPath: string, message?: string): Promise<string> {
    const args = ["stash", "push"];
    if (message) {
      args.push("-m", message);
    }
    const result = await this._run(args, repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Stash push failed");
    }
    return result.stdout || result.stderr;
  }

  async stashPop(repoPath: string): Promise<string> {
    const result = await this._run(["stash", "pop"], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Stash pop failed");
    }
    return result.stdout || result.stderr;
  }

  async stashApply(repoPath: string, index: number): Promise<string> {
    const result = await this._run(["stash", "apply", `stash@{${index}}`], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Stash apply failed");
    }
    return result.stdout || result.stderr;
  }

  async stashShow(repoPath: string, index: number): Promise<string> {
    const result = await this._run(["stash", "show", "-p", `stash@{${index}}`], repoPath);
    return result.stdout;
  }

  async blame(repoPath: string, file: string, line: number): Promise<{
    hash: string;
    author: string;
    date: string;
    summary: string;
  } | undefined> {
    this._validateFilePath(repoPath, file);
    const result = await this._run(
      ["blame", "-L", `${line},${line}`, "--porcelain", file],
      repoPath
    );
    if (result.code !== 0 || !result.stdout.trim()) {
      return undefined;
    }

    const lines = result.stdout.split("\n");
    let hash = "";
    let author = "";
    let date = "";
    let summary = "";

    for (const l of lines) {
      if (!hash && l.match(/^[0-9a-f]{40}/)) {
        hash = l.split(" ")[0];
      } else if (l.startsWith("author ")) {
        author = l.slice("author ".length);
      } else if (l.startsWith("author-time ")) {
        const ts = parseInt(l.slice("author-time ".length), 10);
        date = new Date(ts * 1000).toISOString();
      } else if (l.startsWith("summary ")) {
        summary = l.slice("summary ".length);
      }
    }

    if (!hash) return undefined;
    return { hash, author, date, summary };
  }

  async grep(repoPath: string, query: string, maxResults = 100): Promise<{ file: string; line: number; text: string }[]> {
    const result = await this._run(
      ["grep", "-n", "-I", "--no-color", "-i", "-e", query, "--", ":!*.min.*", ":!*.lock"],
      repoPath
    );
    // git grep exits 1 when no matches — not an error
    if (!result.stdout.trim()) return [];

    const matches: { file: string; line: number; text: string }[] = [];
    for (const l of result.stdout.split("\n")) {
      if (!l.trim()) continue;
      // Format: file:line:text
      const firstColon = l.indexOf(":");
      if (firstColon < 0) continue;
      const secondColon = l.indexOf(":", firstColon + 1);
      if (secondColon < 0) continue;
      const file = l.slice(0, firstColon);
      const lineNo = parseInt(l.slice(firstColon + 1, secondColon), 10);
      const text = l.slice(secondColon + 1);
      if (!isNaN(lineNo)) {
        matches.push({ file, line: lineNo, text: text.trim() });
      }
      if (matches.length >= maxResults) break;
    }
    return matches;
  }

  async listFiles(repoPath: string, query?: string): Promise<string[]> {
    const result = await this._run(
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      repoPath
    );

    const files = result.stdout
      .split("\n")
      .filter((f) => f.trim().length > 0);

    if (query) {
      const lower = query.toLowerCase();
      return files.filter((f) => f.toLowerCase().includes(lower));
    }

    return files;
  }

  async mergedBranches(repoPath: string, mainBranch: string): Promise<string[]> {
    // Use -- to prevent branch names from being interpreted as flags
    const result = await this._run(["branch", "--merged", "--no-color", "--", mainBranch], repoPath);
    if (result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .map((l) => l.trim().replace(/^\* /, ""))
      .filter((b) => b && b !== mainBranch && b !== "main" && b !== "master" && b !== "develop");
  }

  async deleteBranch(repoPath: string, branch: string): Promise<void> {
    if (branch.startsWith("-")) throw new Error("Invalid branch name");
    const result = await this._run(["branch", "-d", "--", branch], repoPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || `Failed to delete branch ${branch}`);
    }
  }

  private _parseChangeType(code: string): ChangeType {
    switch (code) {
      case "M":
        return ChangeType.Modified;
      case "A":
        return ChangeType.Added;
      case "D":
        return ChangeType.Deleted;
      case "R":
        return ChangeType.Renamed;
      case "C":
        return ChangeType.Copied;
      case "T":
        return ChangeType.TypeChanged;
      case "U":
        return ChangeType.Unmerged;
      default:
        return ChangeType.Unknown;
    }
  }
}
