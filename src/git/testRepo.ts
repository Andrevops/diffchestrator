// Test-only helper: throwaway git repos in a temp dir for tests that need
// real `git` output (parsing, flags, exit codes). Not imported by src code.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface TestRepo {
  dir: string;
  git: (...args: string[]) => string;
  write: (rel: string, content: string) => void;
  cleanup: () => void;
}

export function makeTestRepo(opts: { commit?: boolean } = {}): TestRepo {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diffchestrator-test-")));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
    LC_ALL: "C",
  };
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  if (opts.commit) {
    write("README.md", "init\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  }
  return {
    dir,
    git,
    write,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Executable shell script that touches `marker` when run. */
export function makeMarkerScript(dir: string, name: string, marker: string): string {
  const script = path.join(dir, name);
  fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
  fs.chmodSync(script, 0o755);
  return script;
}
