import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import type { RepoStatus, FileChange, CommitEntry } from "../types";
import { ChangeType, FileStatus } from "../types";

const execFileAsync = promisify(execFile);

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitExecutor {
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
    const result = await this._run(
      ["status", "--porcelain=v2", "--branch", "-unormal"],
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

    return { branch, upstream, ahead, behind, staged, unstaged, untracked };
  }

  async shortStatus(
    repoPath: string
  ): Promise<{ staged: number; unstaged: number; untracked: number }> {
    const result = await this._run(
      ["status", "--porcelain=v2", "-unormal"],
      repoPath
    );

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;

    for (const line of result.stdout.split("\n")) {
      if (!line) {
        continue;
      }
      if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const xy = line.split(" ")[1];
        if (xy[0] !== ".") staged++;
        if (xy[1] !== ".") unstaged++;
      } else if (line.startsWith("? ")) {
        untracked++;
      } else if (line.startsWith("u ")) {
        unstaged++;
      }
    }

    return { staged, unstaged, untracked };
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

  async diffUntracked(repoPath: string, file: string): Promise<string> {
    this._validateFilePath(repoPath, file);
    const result = await this._run(
      ["diff", "--no-color", "--no-index", "--", "/dev/null", file],
      repoPath
    );
    return result.stdout;
  }

  async stage(repoPath: string, files: string[]): Promise<void> {
    for (const f of files) {
      this._validateFilePath(repoPath, f);
    }
    await this._run(["add", "--", ...files], repoPath);
  }

  async unstage(repoPath: string, files: string[]): Promise<void> {
    for (const f of files) {
      this._validateFilePath(repoPath, f);
    }
    await this._run(["reset", "HEAD", "--", ...files], repoPath);
  }

  async commit(repoPath: string, message: string): Promise<string> {
    const result = await this._run(["commit", "-m", message], repoPath);
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

  async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    const result = await this._run(
      ["remote", "get-url", "origin"],
      repoPath
    );
    const url = result.stdout.trim();
    return url || undefined;
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

  async show(repoPath: string, ref: string): Promise<string> {
    const result = await this._run(["show", ref], repoPath);
    if (result.code !== 0) {
      return "";
    }
    return result.stdout;
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
