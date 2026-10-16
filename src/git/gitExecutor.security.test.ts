import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { GitExecutor } from "./gitExecutor.ts";
import { makeTestRepo, makeMarkerScript, type TestRepo } from "./testRepo.ts";

const isWin = process.platform === "win32";

describe("GitExecutor safety flags (args)", () => {
  function capture(): { executor: GitExecutor; calls: string[][] } {
    const executor = new GitExecutor();
    const calls: string[][] = [];
    (executor as any)._run = async (args: string[]) => {
      calls.push(args);
      return { stdout: "", stderr: "", code: 0 };
    };
    return { executor, calls };
  }

  test("_run prepends -c core.fsmonitor=false to every invocation", () => {
    assert.deepStrictEqual([...GitExecutor.SAFETY_CONFIG_ARGS], ["-c", "core.fsmonitor=false"]);
  });

  test("diff() passes --no-ext-diff and --no-textconv", async () => {
    const { executor, calls } = capture();
    await executor.diff("/tmp/repo-sf1", false);
    await executor.diff("/tmp/repo-sf1", true, "a.txt");
    for (const args of calls) {
      assert.ok(args.includes("--no-ext-diff"), args.join(" "));
      assert.ok(args.includes("--no-textconv"), args.join(" "));
    }
  });

  test("show(), stashShow(), diffStatSummary(), diffStatFile() pass --no-ext-diff", async () => {
    const { executor, calls } = capture();
    await executor.show("/tmp/repo-sf2", "HEAD");
    await executor.stashShow("/tmp/repo-sf2", 0);
    await executor.diffStatSummary("/tmp/repo-sf2");
    await executor.diffStatFile("/tmp/repo-sf2", "a.txt", false);
    assert.strictEqual(calls.length, 4);
    for (const args of calls) {
      assert.ok(args.includes("--no-ext-diff"), args.join(" "));
      assert.ok(args.includes("--no-textconv"), args.join(" "));
    }
  });

  test("blame() passes --no-textconv", async () => {
    const { executor, calls } = capture();
    await executor.blame("/tmp/repo-sf3", "a.txt", 1);
    assert.ok(calls[0].includes("--no-textconv"));
  });
});

describe("GitExecutor does not execute repo-configured commands (real git)", { skip: isWin }, () => {
  let repo: TestRepo;
  let marker: string;

  before(() => {
    repo = makeTestRepo({ commit: true });
    marker = path.join(repo.dir, "..", `${path.basename(repo.dir)}-pwned`);
  });
  after(() => {
    repo.cleanup();
    fs.rmSync(marker, { force: true });
  });

  test("core.fsmonitor hook is not run by status()", async () => {
    const script = makeMarkerScript(path.dirname(marker), `${path.basename(repo.dir)}-fsmon.sh`, marker);
    try {
      repo.git("config", "core.fsmonitor", script);
      repo.write("README.md", "changed\n");
      // Control: plain git really does run the hook — proves the test bites.
      execFileSync("git", ["status", "--porcelain"], { cwd: repo.dir, stdio: "ignore" });
      assert.ok(fs.existsSync(marker), "control: plain git status should run the fsmonitor hook");
      fs.rmSync(marker);

      const executor = new GitExecutor();
      const s = await executor.status(repo.dir);
      assert.strictEqual(s.unstaged.length, 1);
      await executor.shortStatus(repo.dir);
      assert.ok(!fs.existsSync(marker), "fsmonitor hook must not run");
    } finally {
      repo.git("config", "--unset", "core.fsmonitor");
      repo.git("checkout", "--", "README.md");
      fs.rmSync(script, { force: true });
    }
  });

  test("diff.external and textconv drivers are not run by diff()/show()/stashShow()", async () => {
    const script = makeMarkerScript(path.dirname(marker), `${path.basename(repo.dir)}-ext.sh`, marker);
    try {
      repo.git("config", "diff.external", script);
      repo.git("config", "diff.evil.textconv", script);
      repo.write(".gitattributes", "*.md diff=evil\n");
      repo.git("add", ".gitattributes");
      repo.git("commit", "-q", "-m", "attrs");
      repo.write("README.md", "changed\n");

      // Control: plain git diff runs the external driver.
      execFileSync("git", ["diff"], { cwd: repo.dir, stdio: "ignore" });
      assert.ok(fs.existsSync(marker), "control: plain git diff should run diff.external");
      fs.rmSync(marker);

      const executor = new GitExecutor();
      const d = await executor.diff(repo.dir, false);
      assert.match(d, /^\+changed$/m, "diff must be git's own unified diff");
      await executor.show(repo.dir, "HEAD");
      await executor.show(repo.dir, "HEAD:README.md");
      await executor.diffStatSummary(repo.dir);
      repo.git("stash", "push", "-q");
      await executor.stashShow(repo.dir, 0);
      await executor.blame(repo.dir, "README.md", 1);
      assert.ok(!fs.existsSync(marker), "external diff / textconv must not run");
    } finally {
      repo.git("config", "--unset", "diff.external");
      fs.rmSync(script, { force: true });
    }
  });
});
