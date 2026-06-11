import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import type { RepoStatus, FileChange, CommitEntry } from "../types.ts";
import { ChangeType, FileStatus } from "../types.ts";
import { isValidRef } from "../utils/gitValidation.ts";

const execFileAsync = promisify(execFile);

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GrepSearchOptions {
  caseSensitive?: boolean;
  /** Treat query as POSIX extended regex; literal (fixed-string) otherwise. */
  regex?: boolean;
  wholeWord?: boolean;
  /** Pathspecs to include (e.g. "src", "*.ts"). */
  include?: string[];
  /** Pathspecs to exclude (negated automatically). */
  exclude?: string[];
  maxResults?: number;
}

export interface GrepSearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
}

interface ShortStatusResult {
  staged: number;
  unstaged: number;
  untracked: number;
  branch: string;
  ahead: number;
  behind: number;
  headOid: string;
  mergeState?: import("../types.ts").MergeState;
}

export class GitExecutor {
  // Global concurrency limiter for git processes
  private static readonly MAX_CONCURRENT = 15;
  private _running = 0;
  private _queue: (() => void)[] = [];

  private _acquireSlot(): Promise<void> {
    if (this._running < GitExecutor.MAX_CONCURRENT) {
      this._running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._queue.push(() => { this._running++; resolve(); });
    });
  }

  private _releaseSlot(): void {
    this._running--;
    const next = this._queue.shift();
    if (next) next();
  }

  // Short-TTL cache for status() to deduplicate concurrent calls
  private _statusCache = new Map<string, { result: RepoStatus; time: number }>();
  private _statusInflight = new Map<string, Promise<RepoStatus>>();
  // Watcher debounce + periodic tick + post-command refresh can all request a
  // shortStatus for the same repo within milliseconds — share one process.
  private _shortStatusInflight = new Map<string, Promise<ShortStatusResult>>();
  private _statusEpoch = new Map<string, number>(); // guards against stale in-flight writes
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
    // Lazy purge expired entries when cache grows large
    if (this._metaCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of this._metaCache.entries()) {
        if (now - v.time > GitExecutor.META_CACHE_TTL) {
          this._metaCache.delete(k);
        }
      }
    }
  }

  invalidateMetaCache(repoPath?: string): void {
    if (repoPath) {
      // ":" suffix prevents prefix collisions (e.g. /a/foo matching /a/foo-bar keys)
      for (const key of this._metaCache.keys()) {
        if (key.startsWith(repoPath + ":")) this._metaCache.delete(key);
      }
    } else {
      this._metaCache.clear();
    }
  }

  // Network operations (pull/push/fetch) get a longer timeout than local ones
  private static readonly NETWORK_TIMEOUT = 120_000; // ms

  // Per-repo mutation mutex: dashboard pull, palette pull/push and syncAll can
  // otherwise overlap on the same repo and surface index.lock errors to the
  // user. Reads stay parallel — only mutating ops go through _serialized().
  private _repoLocks = new Map<string, Promise<void>>();

  private async _serialized<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this._repoLocks.get(repoPath) ?? Promise.resolve();
    // Chain onto the existing tail; run fn regardless of how prev settled.
    const run = prev.then(fn, fn);
    // The stored tail must never reject, or the chain would stick rejected.
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this._repoLocks.set(repoPath, tail);
    try {
      return await run;
    } finally {
      // Only clear if no later op replaced the tail in the meantime.
      if (this._repoLocks.get(repoPath) === tail) this._repoLocks.delete(repoPath);
    }
  }

  private async _run(
    args: string[],
    cwd: string,
    opts?: { timeoutMs?: number; input?: string }
  ): Promise<RunResult> {
    await this._acquireSlot();
    try {
      const promise = execFileAsync("git", args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: opts?.timeoutMs ?? 30_000, // 30s default per operation
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C", // stable English output for error-string matching
          GIT_OPTIONAL_LOCKS: "0", // status polling must not take index.lock
        },
      });
      if (opts?.input !== undefined && promise.child.stdin) {
        // If git exits before draining stdin (e.g. the repo vanished), the
        // write emits EPIPE on the stream — without a listener that's an
        // uncaught 'error' event that crashes the extension host.
        promise.child.stdin.on("error", () => {});
        promise.child.stdin.write(opts.input);
        promise.child.stdin.end();
      }
      const { stdout, stderr } = await promise;
      return { stdout, stderr, code: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(err),
        code: e.code ?? 1,
      };
    } finally {
      this._releaseSlot();
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
    this._statusEpoch.set(repoPath, (this._statusEpoch.get(repoPath) ?? 0) + 1);
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

  /** Shallow copy with copied arrays so callers can't mutate the cached object. */
  private _cloneStatus(s: RepoStatus): RepoStatus {
    return {
      ...s,
      staged: [...s.staged],
      unstaged: [...s.unstaged],
      untracked: [...s.untracked],
    };
  }

  async status(repoPath: string): Promise<RepoStatus> {
    // Return cached result if fresh
    const cached = this._statusCache.get(repoPath);
    if (cached && Date.now() - cached.time < GitExecutor.STATUS_CACHE_TTL) {
      return this._cloneStatus(cached.result);
    }

    // Deduplicate: if a call is already in-flight for this repo, return the same Promise
    const inflight = this._statusInflight.get(repoPath);
    if (inflight) return inflight.then((r) => this._cloneStatus(r));

    const epoch = this._statusEpoch.get(repoPath) ?? 0;
    const promise = this._statusUncached(repoPath, epoch);
    this._statusInflight.set(repoPath, promise);
    try {
      return this._cloneStatus(await promise);
    } finally {
      this._statusInflight.delete(repoPath);
    }
  }

  private async _statusUncached(repoPath: string, epoch: number): Promise<RepoStatus> {
    const result = await this._run(
      ["status", "--porcelain=v2", "--branch", "-z", "-uall"],
      repoPath
    );
    if (result.code !== 0) {
      throw new Error(
        `git status failed: ${result.stderr.trim() || `exit code ${result.code}`}`
      );
    }

    let branch = "HEAD";
    let upstream: string | undefined;
    let ahead = 0;
    let behind = 0;
    const staged: FileChange[] = [];
    const unstaged: FileChange[] = [];
    const untracked: FileChange[] = [];

    // -z mode: entries are NUL-separated, paths are NOT C-quoted, and rename
    // entries ("2 ...") consume TWO tokens: "<header fields> <path>" then "<origPath>"
    const entries = result.stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const line = entries[i];
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
          // Format: 2 XY sub mH mI mW hH hI X<score> <path> NUL <origPath> NUL
          // 9 fixed space-delimited header fields, remainder is the new path;
          // the next NUL-separated token is the original path.
          filePath = parts.slice(9).join(" ");
          oldPath = entries[++i] || undefined;
        } else {
          // Format: 1 XY sub mH mI mW hH hI <path>
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

    // Detect merge/rebase/cherry-pick state from .git sentinel files
    let mergeState: import("../types.ts").MergeState;
    const gitDir = path.join(repoPath, ".git");
    if (fs.existsSync(path.join(gitDir, "MERGE_HEAD"))) {
      mergeState = "merging";
    } else if (fs.existsSync(path.join(gitDir, "rebase-merge")) || fs.existsSync(path.join(gitDir, "rebase-apply"))) {
      mergeState = "rebasing";
    } else if (fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
      mergeState = "cherry-picking";
    }

    const statusResult = { branch, upstream, ahead, behind, staged, unstaged, untracked, mergeState };
    // Only cache if no invalidation happened while the git process was running
    if ((this._statusEpoch.get(repoPath) ?? 0) === epoch) {
      this._statusCache.set(repoPath, { result: statusResult, time: Date.now() });
    }
    return statusResult;
  }

  async shortStatus(repoPath: string): Promise<ShortStatusResult> {
    const inflight = this._shortStatusInflight.get(repoPath);
    if (inflight) return inflight;
    const promise = this._shortStatusUncached(repoPath);
    this._shortStatusInflight.set(repoPath, promise);
    try {
      return await promise;
    } finally {
      this._shortStatusInflight.delete(repoPath);
    }
  }

  private async _shortStatusUncached(repoPath: string): Promise<ShortStatusResult> {
    const result = await this._run(
      ["status", "--porcelain=v2", "--branch", "-z", "-uall"],
      repoPath
    );
    if (result.code !== 0) {
      throw new Error(
        `git status failed: ${result.stderr.trim() || `exit code ${result.code}`}`
      );
    }

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    let branch = "HEAD";
    let ahead = 0;
    let behind = 0;
    let headOid = "";

    // -z mode: NUL-separated entries; rename entries consume two tokens
    const entries = result.stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const line = entries[i];
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
        if (line.startsWith("2 ")) i++; // skip the origPath token of a rename
        const xy = line.split(" ")[1];
        if (xy[0] !== ".") staged++;
        if (xy[1] !== ".") unstaged++;
      } else if (line.startsWith("? ")) {
        untracked++;
      } else if (line.startsWith("u ")) {
        unstaged++;
      }
    }

    // Detect merge/rebase/cherry-pick state
    let mergeState: import("../types.ts").MergeState;
    const gitDir = path.join(repoPath, ".git");
    if (fs.existsSync(path.join(gitDir, "MERGE_HEAD"))) {
      mergeState = "merging";
    } else if (fs.existsSync(path.join(gitDir, "rebase-merge")) || fs.existsSync(path.join(gitDir, "rebase-apply"))) {
      mergeState = "rebasing";
    } else if (fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
      mergeState = "cherry-picking";
    }

    return { staged, unstaged, untracked, branch, ahead, behind, headOid, mergeState };
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
    await this._serialized(repoPath, async () => {
      await this._run(["add", "--", ...files], repoPath);
      this.invalidateStatus(repoPath);
    });
  }

  async unstage(repoPath: string, files: string[]): Promise<void> {
    for (const f of files) {
      this._validateFilePath(repoPath, f);
    }
    await this._serialized(repoPath, async () => {
      await this._run(["reset", "HEAD", "--", ...files], repoPath);
      this.invalidateStatus(repoPath);
    });
  }

  async commit(repoPath: string, message: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["commit", "-m", message], repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Commit failed");
      }
      return result.stdout;
    });
  }

  async commitAmend(repoPath: string, message: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["commit", "--amend", "-m", message], repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Amend failed");
      }
      return result.stdout;
    });
  }

  async lastCommitMessage(repoPath: string): Promise<string> {
    const result = await this._run(["log", "-1", "--format=%s"], repoPath);
    return result.stdout.trim();
  }

  async push(repoPath: string, force = false): Promise<string> {
    return this._serialized(repoPath, async () => {
      const args = ["push"];
      if (force) {
        args.push("--force-with-lease");
      }
      const result = await this._run(args, repoPath, { timeoutMs: GitExecutor.NETWORK_TIMEOUT });
      if (result.code !== 0) {
        throw new Error(result.stderr || "Push failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async getBranch(repoPath: string): Promise<string> {
    const result = await this._run(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoPath
    );
    return result.stdout.trim() || "HEAD";
  }

  async resetSoft(repoPath: string, ref = "HEAD~1"): Promise<void> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["reset", "--soft", ref], repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Reset failed");
      }
    });
  }

  async resetHard(repoPath: string): Promise<void> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["reset", "--hard", "HEAD"], repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Reset failed");
      }
    });
  }

  async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    const cacheKey = `${repoPath}:remoteUrl`;
    // Values are wrapped so a "no remote" result (undefined) is cached too —
    // repos without an origin are common and re-spawning git on every scan
    // for them defeats the cache entirely.
    const cached = this._getCachedMeta<{ value: string | undefined }>(cacheKey);
    if (cached !== undefined) return cached.value;
    const result = await this._run(
      ["remote", "get-url", "origin"],
      repoPath
    );
    const url = result.stdout.trim() || undefined;
    this._setCachedMeta(cacheKey, { value: url });
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
    // Wrapped value: a repo with no commits yet (undefined) is cached too.
    const cached = this._getCachedMeta<{ value: string | undefined }>(cacheKey);
    if (cached !== undefined) return cached.value;
    const result = await this._run(
      ["log", "-1", "--format=%ai"],
      repoPath
    );
    const date = result.stdout.trim() || undefined;
    this._setCachedMeta(cacheKey, { value: date });
    return date;
  }

  /**
   * Combined: get commits since a date AND the most recent commit date.
   * Uses lastCommitDate cache (30s TTL) to avoid extra git process when cached.
   */
  async logSinceWithDate(
    repoPath: string,
    since: string,
    count = 50
  ): Promise<{ lastDate: string | undefined; commits: CommitEntry[] }> {
    const cacheKey = `${repoPath}:lastCommitDate`;
    const cachedDate = this._getCachedMeta<{ value: string | undefined }>(cacheKey);

    if (cachedDate !== undefined) {
      // Cache hit — only need session commits (1 git call)
      const commits = await this.logSince(repoPath, since, count);
      return { lastDate: cachedDate.value, commits };
    }

    // Cache miss — run both in parallel (2 git calls, but parallel)
    const [lastDate, commits] = await Promise.all([
      this.lastCommitDate(repoPath),
      this.logSince(repoPath, since, count),
    ]);
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
    return this._serialized(repoPath, async () => {
      const result = await this._run(["fetch", "--prune"], repoPath, { timeoutMs: GitExecutor.NETWORK_TIMEOUT });
      if (result.code !== 0) {
        throw new Error(result.stderr || "Fetch failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async fetchBranch(repoPath: string, branch: string): Promise<string> {
    if (!isValidRef(branch)) throw new Error("Invalid branch name");
    return this._serialized(repoPath, async () => {
      const result = await this._run(["fetch", "origin", branch, "--prune"], repoPath, { timeoutMs: GitExecutor.NETWORK_TIMEOUT });
      if (result.code !== 0) {
        throw new Error(result.stderr || "Fetch failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    const symbolic = await this._run(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repoPath
    );
    if (symbolic.code === 0 && symbolic.stdout.trim()) {
      return symbolic.stdout.trim().replace(/^origin\//, "");
    }
    const master = await this._run(
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/master"],
      repoPath
    );
    if (master.code === 0 && master.stdout.trim()) return "master";
    return "main";
  }

  async isWorkingTreeClean(repoPath: string): Promise<boolean> {
    const result = await this._run(["status", "--porcelain"], repoPath);
    return result.code === 0 && result.stdout.trim() === "";
  }

  /**
   * Fast-forward local `branch` to match `origin/branch` without checkout.
   * Uses `git fetch origin branch:branch` which is an atomic FF-only ref update:
   * succeeds on FF, fails (non-throwing) on divergence or missing remote ref.
   * Cannot be used when `branch` is the currently checked-out branch.
   */
  async fastForwardRef(repoPath: string, branch: string): Promise<boolean> {
    if (!isValidRef(branch)) throw new Error("Invalid branch name");
    return this._serialized(repoPath, async () => {
      const result = await this._run(
        ["fetch", "origin", `${branch}:${branch}`],
        repoPath,
        { timeoutMs: GitExecutor.NETWORK_TIMEOUT }
      );
      return result.code === 0;
    });
  }

  async pullFastForwardOnly(repoPath: string): Promise<boolean> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["pull", "--ff-only"], repoPath, { timeoutMs: GitExecutor.NETWORK_TIMEOUT });
      return result.code === 0;
    });
  }

  async pull(repoPath: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["pull"], repoPath, { timeoutMs: GitExecutor.NETWORK_TIMEOUT });
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Pull failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async diffStatSummary(repoPath: string): Promise<{ files: string[]; additions: number; deletions: number }> {
    const result = await this._run(["diff", "--numstat", "HEAD"], repoPath);
    if (result.code !== 0 || !result.stdout.trim()) return { files: [], additions: 0, deletions: 0 };
    let additions = 0;
    let deletions = 0;
    const files: string[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        additions += parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
        deletions += parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
        files.push(parts[2]);
      }
    }
    return { files, additions, deletions };
  }

  async fileCount(repoPath: string): Promise<number> {
    const result = await this._run(["ls-files"], repoPath);
    if (!result.stdout.trim()) return 0;
    return result.stdout.trim().split("\n").length;
  }

  async diffStatFile(repoPath: string, file: string, staged: boolean): Promise<{ additions: number; deletions: number }> {
    this._validateFilePath(repoPath, file);
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
    // Zero stashes is the common case — cache it too, otherwise every scan
    // re-spawns `git stash list` for every clean repo.
    const count =
      result.code !== 0 || !result.stdout.trim()
        ? 0
        : result.stdout.trim().split("\n").length;
    this._setCachedMeta(cacheKey, count);
    return count;
  }

  async branches(repoPath: string): Promise<{ name: string; current: boolean }[]> {
    // --format avoids fragile text parsing: "%(HEAD)" is "*" for the current
    // branch (space otherwise), "%09" is a tab separator, name is the short ref.
    const result = await this._run(
      ["branch", "--list", "--no-color", "--format=%(HEAD)%09%(refname:short)"],
      repoPath
    );
    if (!result.stdout.trim()) return [];
    const branches: { name: string; current: boolean }[] = [];
    for (const line of result.stdout.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const name = line.slice(tab + 1).trim();
      // Detached HEAD shows up as "(HEAD detached at abc1234)" — not a real branch
      if (!name || name.startsWith("(")) continue;
      branches.push({ name, current: line.slice(0, tab) === "*" });
    }
    return branches;
  }

  async checkout(repoPath: string, branch: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["checkout", branch], repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Checkout failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async createBranch(repoPath: string, branch: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["checkout", "-b", branch], repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Branch creation failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async checkoutFile(repoPath: string, file: string): Promise<void> {
    this._validateFilePath(repoPath, file);
    return this._serialized(repoPath, async () => {
      const result = await this._run(["checkout", "--", file], repoPath);
      this.invalidateStatus(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Discard failed");
      }
    });
  }

  async checkoutAll(repoPath: string): Promise<void> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["checkout", "--", "."], repoPath);
      this.invalidateStatus(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Discard all failed");
      }
    });
  }

  async clean(repoPath: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["clean", "-fd"], repoPath);
      this.invalidateStatus(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Clean failed");
      }
      return result.stdout;
    });
  }

  async cleanFile(repoPath: string, file: string): Promise<void> {
    this._validateFilePath(repoPath, file);
    return this._serialized(repoPath, async () => {
      const result = await this._run(["clean", "-f", "--", file], repoPath);
      this.invalidateStatus(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Clean file failed");
      }
    });
  }

  async stashList(repoPath: string): Promise<{ index: number; message: string; date: string }[]> {
    const result = await this._run(
      ["stash", "list", "--format=%gd%n%ai%n%s%n---END---"],
      repoPath
    );
    if (!result.stdout.trim()) return [];
    const blocks = result.stdout.split("---END---\n").filter((b) => b.trim());
    return blocks.map((block, i) => {
      const lines = block.trim().split("\n");
      return {
        index: i,
        date: lines[1] ?? "",
        message: lines[2] ?? lines[0] ?? "",
      };
    });
  }

  async stashPush(repoPath: string, message?: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const args = ["stash", "push"];
      if (message) {
        args.push("-m", message);
      }
      const result = await this._run(args, repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Stash push failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async stashPop(repoPath: string): Promise<string> {
    return this._serialized(repoPath, async () => {
      const result = await this._run(["stash", "pop"], repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Stash pop failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async stashApply(repoPath: string, index: number): Promise<string> {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("Invalid stash index");
    }
    return this._serialized(repoPath, async () => {
      const result = await this._run(["stash", "apply", `stash@{${index}}`], repoPath);
      this.invalidateStatus(repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Stash apply failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async stashDrop(repoPath: string, index: number): Promise<string> {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("Invalid stash index");
    }
    return this._serialized(repoPath, async () => {
      const result = await this._run(["stash", "drop", `stash@{${index}}`], repoPath);
      this.invalidateMetaCache(repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Stash drop failed");
      }
      return result.stdout || result.stderr;
    });
  }

  async stashShow(repoPath: string, index: number): Promise<string> {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("Invalid stash index");
    }
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
      ["blame", "-L", `${line},${line}`, "--porcelain", "--", file],
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

  async grep(repoPath: string, query: string, maxResults = 100, subdir?: string): Promise<{ file: string; line: number; text: string }[]> {
    if (subdir !== undefined) this._validateFilePath(repoPath, subdir);
    const result = await this._run(
      ["grep", "-n", "-I", "--no-color", "-i", "--untracked", "-e", query, "--", ...(subdir ? [subdir] : []), ":!*.min.*", ":!*.lock"],
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

  /**
   * Full-featured content search for the search panel. Unlike grep(), this
   * searches untracked files, defaults to literal (fixed-string) matching,
   * reports match columns, and surfaces git errors (e.g. invalid regex)
   * instead of swallowing them.
   */
  async grepSearch(
    repoPath: string,
    query: string,
    opts: GrepSearchOptions = {}
  ): Promise<{ matches: GrepSearchMatch[]; truncated: boolean }> {
    const max = opts.maxResults ?? 2000;
    const args = ["grep", "-n", "--column", "-I", "--no-color", "--untracked"];
    if (!opts.caseSensitive) args.push("-i");
    args.push(opts.regex ? "-E" : "-F");
    if (opts.wholeWord) args.push("-w");
    args.push("-e", query, "--");
    for (const inc of opts.include ?? []) args.push(inc);
    for (const exc of opts.exclude ?? []) args.push(`:!${exc}`);

    const result = await this._run(args, repoPath);
    // Exit 1 with empty stderr = no matches; anything else is a real error
    // (invalid regex, bad pathspec) the caller should show to the user.
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(result.stderr.trim() || "git grep failed");
    }
    if (result.code === 1 && result.stderr.trim()) {
      throw new Error(result.stderr.trim());
    }

    const matches: GrepSearchMatch[] = [];
    let truncated = false;
    for (const l of result.stdout.split("\n")) {
      if (!l) continue;
      if (matches.length >= max) {
        truncated = true;
        break;
      }
      // Format: file:line:column:text
      const c1 = l.indexOf(":");
      if (c1 < 0) continue;
      const c2 = l.indexOf(":", c1 + 1);
      if (c2 < 0) continue;
      const c3 = l.indexOf(":", c2 + 1);
      if (c3 < 0) continue;
      const file = l.slice(0, c1);
      const line = parseInt(l.slice(c1 + 1, c2), 10);
      const column = parseInt(l.slice(c2 + 1, c3), 10);
      if (isNaN(line) || isNaN(column)) continue;
      let text = l.slice(c3 + 1);
      // Window very long lines (minified files) around the match so the
      // webview always renders the matched portion.
      if (text.length > 400) {
        const start = Math.max(0, column - 1 - 80);
        text =
          (start > 0 ? "…" : "") +
          text.slice(start, start + 360) +
          (start + 360 < text.length ? "…" : "");
      }
      matches.push({ file, line, column, text });
    }
    return { matches, truncated };
  }

  /**
   * Which of the given repo-relative paths are gitignored. Exit code 1 means
   * "none ignored" (not an error), so an empty result is the common case.
   */
  async checkIgnore(repoPath: string, paths: string[]): Promise<Set<string>> {
    const ignored = new Set<string>();
    if (paths.length === 0) return ignored;
    for (const p of paths) this._validateFilePath(repoPath, p);
    // -z requires --stdin; with both, input and output are NUL-separated and
    // output paths are echoed verbatim (no C-quoting).
    const result = await this._run(["check-ignore", "--stdin", "-z"], repoPath, {
      input: paths.join("\0") + "\0",
    });
    for (const p of result.stdout.split("\0")) {
      if (p) ignored.add(p);
    }
    return ignored;
  }

  // Concurrent directory expansions all need the same ignore set — share one
  // process while the first call is still running.
  private _ignoredPathsInflight = new Map<string, Promise<Set<string>>>();

  /**
   * All gitignored paths in the repo in one batched call (vs. one
   * `check-ignore` spawn per directory). Entries are repo-relative with
   * forward slashes; ignored directories appear once with a trailing "/"
   * (their contents are NOT listed individually — callers must do prefix
   * matching). Cached in the meta cache (30s TTL, cleared by
   * invalidateMetaCache).
   */
  async ignoredPaths(repoPath: string): Promise<Set<string>> {
    const cacheKey = `${repoPath}:ignoredPaths`;
    const cached = this._getCachedMeta<Set<string>>(cacheKey);
    if (cached !== undefined) return cached;

    const inflight = this._ignoredPathsInflight.get(repoPath);
    if (inflight) return inflight;

    const promise = (async () => {
      const result = await this._run(
        ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
        repoPath
      );
      const ignored = new Set<string>();
      if (result.code === 0) {
        for (const p of result.stdout.split("\0")) {
          if (p) ignored.add(p);
        }
      }
      this._setCachedMeta(cacheKey, ignored);
      return ignored;
    })();
    this._ignoredPathsInflight.set(repoPath, promise);
    try {
      return await promise;
    } finally {
      this._ignoredPathsInflight.delete(repoPath);
    }
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
    // --merged=<ref> binds the value to the flag (no flag injection), and
    // --format avoids the "* " / "+ " marker parsing entirely
    const result = await this._run(
      ["branch", "--no-color", `--merged=${mainBranch}`, "--format=%(refname:short)"],
      repoPath
    );
    if (result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .map((l) => l.trim())
      // "(HEAD detached at ...)" pseudo-entries aren't real branches
      .filter((b) => b && !b.startsWith("(") && b !== mainBranch && b !== "main" && b !== "master" && b !== "develop");
  }

  async deleteBranch(repoPath: string, branch: string): Promise<void> {
    if (branch.startsWith("-")) throw new Error("Invalid branch name");
    return this._serialized(repoPath, async () => {
      const result = await this._run(["branch", "-d", "--", branch], repoPath);
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to delete branch ${branch}`);
      }
    });
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
