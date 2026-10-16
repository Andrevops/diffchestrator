import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { GitExecutor, GrepZParser, type GrepRecord } from "./gitExecutor.ts";
import { makeTestRepo, type TestRepo } from "./testRepo.ts";

const isWin = process.platform === "win32";

/** Mock the streaming runner: feeds `stdout` in `chunkSize` pieces and honors early stop. */
function streamExecutor(stdout: string, code = 0, stderr = "", chunkSize = 7, failure?: string) {
  const executor = new GitExecutor();
  const calls: string[][] = [];
  (executor as any)._runStream = async (args: string[], _cwd: string, onData: (c: string) => boolean) => {
    calls.push(args);
    for (let i = 0; i < stdout.length; i += chunkSize) {
      if (!onData(stdout.slice(i, i + chunkSize))) return { code: -1, stderr: "", stopped: true };
    }
    return { code, stderr, stopped: false, failure };
  };
  return { executor, calls };
}

describe("GrepZParser", () => {
  test("parses records split across arbitrary chunk boundaries", () => {
    const out = "a:b.txt\x001\x001\x00hello world\nsub/café.txt\x0012\x005\x00foo: hello\n";
    for (const size of [1, 2, 3, 5, 11, out.length]) {
      const p = new GrepZParser(true);
      const recs: GrepRecord[] = [];
      for (let i = 0; i < out.length; i += size) p.push(out.slice(i, i + size), (r) => (recs.push(r), true));
      assert.deepStrictEqual(recs, [
        { file: "a:b.txt", line: 1, column: 1, text: "hello world" },
        { file: "sub/café.txt", line: 12, column: 5, text: "foo: hello" },
      ], `chunk size ${size}`);
    }
  });

  test("without --column", () => {
    const p = new GrepZParser(false);
    const recs: GrepRecord[] = [];
    p.push("x.ts\x003\x00a:b:c\n", (r) => (recs.push(r), true));
    assert.deepStrictEqual(recs, [{ file: "x.ts", line: 3, column: 0, text: "a:b:c" }]);
  });

  test("stops when emit returns false", () => {
    const p = new GrepZParser(false);
    const recs: GrepRecord[] = [];
    const cont = p.push("a\x001\x00x\nb\x002\x00y\nc\x003\x00z\n", (r) => (recs.push(r), recs.length < 2));
    assert.strictEqual(cont, false);
    assert.strictEqual(recs.length, 2);
  });
});

describe("GitExecutor grepSearch (mocked stream)", () => {
  test("defaults: -z, literal, case-insensitive, untracked, with column", async () => {
    const { executor, calls } = streamExecutor("");
    await executor.grepSearch("/tmp/repo-gs1", "needle");
    const args = calls[0];
    assert.ok(args.includes("-z"), "must use NUL-separated output");
    assert.ok(args.includes("--untracked"), "must search untracked files");
    assert.ok(args.includes("--column"), "must report match columns");
    assert.ok(args.includes("-F"), "literal search by default");
    assert.ok(args.includes("-i"), "case-insensitive by default");
    assert.ok(!args.includes("-E"));
    assert.ok(!args.includes("-w"));
    // Query passed via -e so leading-dash queries are safe
    assert.strictEqual(args[args.indexOf("-e") + 1], "needle");
  });

  test("options map to git flags and pathspecs", async () => {
    const { executor, calls } = streamExecutor("");
    await executor.grepSearch("/tmp/repo-gs2", "nee(dle)?", {
      caseSensitive: true,
      regex: true,
      wholeWord: true,
      include: ["src", "*.ts"],
      exclude: ["*.test.ts"],
    });
    const args = calls[0];
    assert.ok(args.includes("-E"), "regex mode uses extended regex");
    assert.ok(!args.includes("-F"));
    assert.ok(!args.includes("-i"), "case-sensitive drops -i");
    assert.ok(args.includes("-w"));
    const sep = args.indexOf("--");
    assert.deepStrictEqual(args.slice(sep + 1), ["src", "*.ts", ":!*.test.ts"]);
  });

  test("truncates at maxResults and stops the stream early", async () => {
    const stdout = Array.from({ length: 10 }, (_, i) => `f.ts\x00${i + 1}\x001\x00x\n`).join("");
    const { executor } = streamExecutor(stdout);
    const { matches, truncated } = await executor.grepSearch("/tmp/repo-gs4", "x", { maxResults: 5 });
    assert.strictEqual(matches.length, 5);
    assert.strictEqual(truncated, true);
  });

  test("exactly maxResults matches is not truncated", async () => {
    const stdout = Array.from({ length: 5 }, (_, i) => `f.ts\x00${i + 1}\x001\x00x\n`).join("");
    const { executor } = streamExecutor(stdout);
    const { matches, truncated } = await executor.grepSearch("/tmp/repo-gs4b", "x", { maxResults: 5 });
    assert.strictEqual(matches.length, 5);
    assert.strictEqual(truncated, false);
  });

  test("windows very long lines around the match", async () => {
    const long = "a".repeat(1000) + "NEEDLE" + "b".repeat(1000);
    const { executor } = streamExecutor(`min.js\x001\x001001\x00${long}\n`, 0, "", 4096);
    const { matches } = await executor.grepSearch("/tmp/repo-gs5", "NEEDLE");
    assert.ok(matches[0].text.length < 400, "long line must be windowed");
    assert.ok(matches[0].text.includes("NEEDLE"), "window must contain the match");
  });

  test("exit 1 with no stderr is no-matches, not an error", async () => {
    const { executor } = streamExecutor("", 1);
    const { matches } = await executor.grepSearch("/tmp/repo-gs6", "nothing");
    assert.deepStrictEqual(matches, []);
  });

  test("git errors (e.g. invalid regex) are surfaced", async () => {
    const { executor } = streamExecutor("", 128, "fatal: command line: unmatched ( or \\(");
    await assert.rejects(
      () => executor.grepSearch("/tmp/repo-gs7", "bad(", { regex: true }),
      { message: /unmatched/ }
    );
  });

  test("a timeout is an error, not 'no matches'", async () => {
    const { executor } = streamExecutor("", -1, "", 7, "timeout");
    await assert.rejects(() => executor.grepSearch("/tmp/repo-gs8", "x"), { message: /timed out/ });
  });

  test("a kill by signal is an error", async () => {
    const { executor } = streamExecutor("", -1, "", 7, "signal");
    await assert.rejects(() => executor.grepSearch("/tmp/repo-gs9", "x"), { message: /signal|failed/ });
  });
});

describe("GitExecutor exit codes (mocked _run)", () => {
  function runExecutor(handler: (args: string[]) => { stdout?: string; stderr?: string; code: number; failure?: string }) {
    const executor = new GitExecutor();
    const calls: string[][] = [];
    (executor as any)._run = async (args: string[]) => {
      calls.push(args);
      const r = handler(args);
      return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code, failure: r.failure };
    };
    return { executor, calls };
  }

  test("stage() throws on failure (e.g. index.lock)", async () => {
    const { executor } = runExecutor(() => ({ code: 128, stderr: "fatal: Unable to create '.git/index.lock': File exists." }));
    await assert.rejects(() => executor.stage("/tmp/repo-ec1", ["a.txt"]), { message: /index\.lock/ });
  });

  test("unstage() throws on failure", async () => {
    const { executor } = runExecutor((args) =>
      args[0] === "rev-parse" ? { code: 0, stdout: "abc\n" } : { code: 128, stderr: "fatal: index.lock" });
    await assert.rejects(() => executor.unstage("/tmp/repo-ec2", ["a.txt"]), { message: /index\.lock/ });
  });

  test("unstage() uses rm --cached when HEAD is unborn", async () => {
    const { executor, calls } = runExecutor((args) => (args[0] === "rev-parse" ? { code: 1 } : { code: 0 }));
    await executor.unstage("/tmp/repo-ec3", ["a.txt"]);
    assert.deepStrictEqual(calls[1].slice(0, 3), ["rm", "--cached", "-r"]);
  });

  test("diff() throws on maxBuffer overflow instead of truncating", async () => {
    const { executor } = runExecutor(() => ({ code: -1, stdout: "partial", failure: "maxBuffer" }));
    await assert.rejects(() => executor.diff("/tmp/repo-ec4"), { message: /too large/ });
  });

  test("diff() throws on non-zero exit", async () => {
    const { executor } = runExecutor(() => ({ code: 128, stderr: "fatal: bad object" }));
    await assert.rejects(() => executor.diff("/tmp/repo-ec5"), { message: /bad object/ });
  });

  test("listFiles() throws on overflow and on failure", async () => {
    const over = runExecutor(() => ({ code: -1, stdout: "a\0b", failure: "maxBuffer" }));
    await assert.rejects(() => over.executor.listFiles("/tmp/repo-ec6"), { message: /too large/ });
    const bad = runExecutor(() => ({ code: 128, stderr: "fatal: not a git repository" }));
    await assert.rejects(() => bad.executor.listFiles("/tmp/repo-ec7"), { message: /not a git repository/ });
  });

  test("_run maps a timeout kill to code -1 + failure, never exit 1", async () => {
    const executor = new GitExecutor();
    // `git hash-object --stdin` blocks reading stdin; a 50ms timeout kills it.
    const r = await (executor as any)._run(["hash-object", "--stdin"], process.cwd(), { timeoutMs: 50, input: undefined });
    // stdin isn't written/closed when input is undefined, so git waits until killed
    assert.strictEqual(r.code, -1);
    assert.strictEqual(r.failure, "timeout");
  });
});

describe("GitExecutor parsers on real git output", { skip: isWin }, () => {
  let repo: TestRepo;
  const executor = new GitExecutor();

  before(() => {
    repo = makeTestRepo({ commit: true });
    repo.write("a:b.txt", "hello world\nfoo hello\n");
    repo.write("café.txt", "hello\n");
    repo.write("old name.txt", "x\ny\nz\n");
    repo.write("dir/真.ts", "const hello = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "files");
    repo.write("untracked file.txt", "hello untracked\n");
  });
  after(() => repo.cleanup());

  test("grepSearch handles colons and non-ASCII in paths", async () => {
    const { matches, truncated } = await executor.grepSearch(repo.dir, "hello");
    assert.strictEqual(truncated, false);
    const got = matches.map((m) => `${m.file}|${m.line}|${m.column}|${m.text}`).sort();
    assert.deepStrictEqual(got, [
      "a:b.txt|1|1|hello world",
      "a:b.txt|2|5|foo hello",
      "café.txt|1|1|hello",
      "dir/真.ts|1|7|const hello = 1;",
      "untracked file.txt|1|1|hello untracked",
    ]);
  });

  test("grepSearch caps results and reports truncation", async () => {
    const { matches, truncated } = await executor.grepSearch(repo.dir, "hello", { maxResults: 2 });
    assert.strictEqual(matches.length, 2);
    assert.strictEqual(truncated, true);
  });

  test("grepSearch surfaces an invalid regex", async () => {
    await assert.rejects(() => executor.grepSearch(repo.dir, "bad(", { regex: true }));
  });

  test("grep (quick pick) handles colons and non-ASCII in paths", async () => {
    const matches = await executor.grep(repo.dir, "HELLO", 100);
    const files = [...new Set(matches.map((m) => m.file))].sort();
    assert.deepStrictEqual(files, ["a:b.txt", "café.txt", "dir/真.ts", "untracked file.txt"]);
    const ab = matches.find((m) => m.file === "a:b.txt" && m.line === 2);
    assert.strictEqual(ab?.text, "foo hello");
  });

  test("listFiles returns verbatim unicode paths (no C-quoting)", async () => {
    const files = (await executor.listFiles(repo.dir)).sort();
    assert.deepStrictEqual(files, ["README.md", "a:b.txt", "café.txt", "dir/真.ts", "old name.txt", "untracked file.txt"]);
    assert.deepStrictEqual(await executor.listFiles(repo.dir, "CAFÉ"), ["café.txt"]);
  });

  test("diffStatSummary handles renames and unicode", async () => {
    repo.git("mv", "old name.txt", "new name.txt");
    fs.appendFileSync(path.join(repo.dir, "new name.txt"), "w\n");
    fs.appendFileSync(path.join(repo.dir, "café.txt"), "more\n");
    try {
      const s = await executor.diffStatSummary(repo.dir);
      assert.deepStrictEqual(s.files.sort(), ["café.txt", "new name.txt"]);
      assert.strictEqual(s.additions, 2);
      assert.strictEqual(s.deletions, 0);
    } finally {
      repo.git("reset", "-q", "--hard");
    }
  });

  test("stage/unstage round-trip and unstage on an unborn branch", async () => {
    const fresh = makeTestRepo();
    try {
      fresh.write("new.txt", "x\n");
      await executor.stage(fresh.dir, ["new.txt"]);
      let s = await executor.status(fresh.dir);
      assert.deepStrictEqual(s.staged.map((f) => f.path), ["new.txt"]);
      await executor.unstage(fresh.dir, ["new.txt"]); // no HEAD yet
      s = await executor.status(fresh.dir);
      assert.deepStrictEqual(s.staged, []);
      assert.deepStrictEqual(s.untracked.map((f) => f.path), ["new.txt"]);
      // whole-tree unstage (diff panel uses ".")
      await executor.stage(fresh.dir, ["."]);
      await executor.unstage(fresh.dir, ["."]);
      s = await executor.status(fresh.dir);
      assert.deepStrictEqual(s.staged, []);
    } finally {
      fresh.cleanup();
    }
  });

  test("unstage with HEAD keeps working-tree changes", async () => {
    repo.write("café.txt", "hello\nchanged\n");
    try {
      await executor.stage(repo.dir, ["café.txt"]);
      await executor.unstage(repo.dir, ["café.txt"]);
      const s = await executor.status(repo.dir);
      assert.deepStrictEqual(s.staged, []);
      assert.deepStrictEqual(s.unstaged.map((f) => f.path), ["café.txt"]);
    } finally {
      repo.git("checkout", "--", "café.txt");
    }
  });

  test("stashCount tracks terminal stash push/drop without waiting for a TTL, and caches when unchanged", async () => {
    const ex = new GitExecutor();
    let spawns = 0;
    const realRun = (ex as any)._run.bind(ex);
    (ex as any)._run = async (args: string[], cwd: string, o?: unknown) => {
      if (args[0] === "stash") spawns++;
      return realRun(args, cwd, o);
    };
    assert.strictEqual(await ex.stashCount(repo.dir), 0);
    assert.strictEqual(spawns, 0, "no stash reflog → 0 without spawning");
    repo.write("café.txt", "hello\nstashed\n");
    repo.git("stash", "push", "-q");
    assert.strictEqual(await ex.stashCount(repo.dir), 1, "terminal stash push is seen immediately");
    assert.strictEqual(await ex.stashCount(repo.dir), 1);
    assert.strictEqual(spawns, 1, "unchanged reflog → cached");
    repo.git("stash", "drop", "-q");
    assert.strictEqual(await ex.stashCount(repo.dir), 0, "terminal stash drop is seen immediately");
  });

  test("firstParent returns the parent oid, undefined for a root commit", async () => {
    const head = repo.git("rev-parse", "HEAD").trim();
    const parent = repo.git("rev-parse", "HEAD^").trim();
    assert.strictEqual(await executor.firstParent(repo.dir, head), parent);
    const root = repo.git("rev-list", "--max-parents=0", "HEAD").trim();
    assert.strictEqual(await executor.firstParent(repo.dir, root), undefined);
    assert.strictEqual(await executor.firstParent(repo.dir, "--output=x"), undefined);
  });

  test("stage throws when git fails (index.lock held)", async () => {
    const lock = path.join(repo.dir, ".git", "index.lock");
    fs.writeFileSync(lock, "");
    try {
      repo.write("café.txt", "hello\nlocked\n");
      await assert.rejects(() => executor.stage(repo.dir, ["café.txt"]), { message: /index\.lock/ });
    } finally {
      fs.rmSync(lock, { force: true });
      repo.git("checkout", "--", "café.txt");
    }
  });
});
