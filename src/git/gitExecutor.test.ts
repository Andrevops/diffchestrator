import { test, describe } from "node:test";
import * as assert from "node:assert";
import { GitExecutor } from "./gitExecutor.ts";
import { ChangeType, FileStatus } from "../types.ts";
import * as path from "node:path";

describe("GitExecutor Path Validation", () => {
  const executor = new GitExecutor();
  const repoPath = path.resolve("/tmp/repo");

  // Mock _run to avoid actual git commands
  (executor as any)._run = async () => ({ stdout: "", stderr: "", code: 0 });

  const invalidPaths = [
    "../outside.txt",
    "../../etc/passwd",
    "/absolute/path/outside",
    "sub/../../../outside",
  ];

  const validPaths = [
    "file.txt",
    "src/index.ts",
    "./local.file",
    "sub/folder/file.ext",
    "", // Root of repo
  ];

  describe("diff()", () => {
    for (const p of invalidPaths) {
      test(`should throw for invalid path: ${p}`, async () => {
        await assert.rejects(() => executor.diff(repoPath, false, p), {
          message: /Path traversal detected/,
        });
      });
    }

    for (const p of validPaths) {
      test(`should accept valid path: ${p}`, async () => {
        await assert.doesNotReject(() => executor.diff(repoPath, false, p));
      });
    }
  });

  describe("stage()", () => {
    test("should throw if any path in the list is invalid", async () => {
      await assert.rejects(
        () => executor.stage(repoPath, ["valid.txt", "../invalid.txt"]),
        { message: /Path traversal detected/ }
      );
    });

    test("should accept list of valid paths", async () => {
      await assert.doesNotReject(() =>
        executor.stage(repoPath, ["valid1.txt", "src/valid2.ts"])
      );
    });
  });

  describe("unstage()", () => {
    test("should throw if any path in the list is invalid", async () => {
      await assert.rejects(
        () => executor.unstage(repoPath, ["valid.txt", "../invalid.txt"]),
        { message: /Path traversal detected/ }
      );
    });
  });

  describe("checkoutFile()", () => {
    test("should throw for invalid path", async () => {
      await assert.rejects(() => executor.checkoutFile(repoPath, "../invalid.txt"), {
        message: /Path traversal detected/,
      });
    });
  });

  describe("cleanFile()", () => {
    test("should throw for invalid path", async () => {
      await assert.rejects(() => executor.cleanFile(repoPath, "../invalid.txt"), {
        message: /Path traversal detected/,
      });
    });
  });

  describe("blame()", () => {
    test("should throw for invalid path", async () => {
      await assert.rejects(() => executor.blame(repoPath, "../invalid.txt", 1), {
        message: /Path traversal detected/,
      });
    });
  });
});

describe("GitExecutor Stash Validation", () => {
  const executor = new GitExecutor();
  const repoPath = path.resolve("/tmp/repo");

  // Mock _run
  (executor as any)._run = async () => ({ stdout: "", stderr: "", code: 0 });

  describe("stashApply()", () => {
    test("should reject negative index", async () => {
      await assert.rejects(() => executor.stashApply(repoPath, -1), {
        message: /Invalid stash index/,
      });
    });

    test("should reject non-integer index", async () => {
      await assert.rejects(() => executor.stashApply(repoPath, 1.5), {
        message: /Invalid stash index/,
      });
    });

    test("should reject NaN", async () => {
      await assert.rejects(() => executor.stashApply(repoPath, NaN), {
        message: /Invalid stash index/,
      });
    });

    test("should accept valid index 0", async () => {
      await assert.doesNotReject(() => executor.stashApply(repoPath, 0));
    });

    test("should accept valid index 5", async () => {
      await assert.doesNotReject(() => executor.stashApply(repoPath, 5));
    });
  });

  describe("show()", () => {
    test("should block flag injection", async () => {
      const result = await executor.show(repoPath, "--exec=malicious");
      assert.strictEqual(result, "");
    });

    test("should block -flag injection", async () => {
      const result = await executor.show(repoPath, "-n1");
      assert.strictEqual(result, "");
    });

    test("should accept valid ref", async () => {
      await assert.doesNotReject(() => executor.show(repoPath, "HEAD"));
    });

    test("should accept commit hash", async () => {
      await assert.doesNotReject(() => executor.show(repoPath, "abc1234"));
    });
  });
});


describe("GitExecutor Error Handling", () => {
  const executor = new GitExecutor();

  test("should handle execFileAsync failure with fallback RunResult", async () => {
    // We can simulate an internal failure by providing an invalid cwd with a null byte,
    // which causes child_process.execFile to throw synchronously.
    const result = await (executor as any)._run(["status"], "\0invalid-cwd");

    assert.strictEqual(result.stdout, "");
    assert.ok(result.stderr.includes("ERR_INVALID_ARG_VALUE") || result.stderr.includes("invalid"), "Stderr should contain the error message");
    // Depending on node version, code might be 'ERR_INVALID_ARG_VALUE' or something else, but it should not be 0.
    assert.notStrictEqual(result.code, 0);
  });
});

describe("GitExecutor Porcelain v2 -z Parsing", () => {
  // Fixture mirrors real `git status --porcelain=v2 --branch -z -uall` output:
  // NUL-separated entries, no C-quoting, rename origPath as a separate NUL token.
  const H = "1111111111111111111111111111111111111111";
  const fixture =
    `# branch.oid ${H}\0` +
    "# branch.head main\0" +
    "# branch.upstream origin/main\0" +
    "# branch.ab +3 -2\0" +
    `1 .M N... 100644 100644 100644 ${H} ${H} café.txt\0` +
    `2 R. N... 100644 100644 100644 ${H} ${H} R100 my renamed file.txt\0my old file.txt\0` +
    `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} conflict file.txt\0` +
    "? untracked file.txt\0";

  function mockedExecutor(stdout: string): GitExecutor {
    const executor = new GitExecutor();
    (executor as any)._run = async () => ({ stdout, stderr: "", code: 0 });
    return executor;
  }

  test("status() parses branch headers", async () => {
    const s = await mockedExecutor(fixture).status("/tmp/repo-z1");
    assert.strictEqual(s.branch, "main");
    assert.strictEqual(s.upstream, "origin/main");
    assert.strictEqual(s.ahead, 3);
    assert.strictEqual(s.behind, 2);
  });

  test("status() parses unicode filename", async () => {
    const s = await mockedExecutor(fixture).status("/tmp/repo-z2");
    assert.strictEqual(s.unstaged.some((f) => f.path === "café.txt" && f.changeType === ChangeType.Modified), true);
  });

  test("status() parses staged rename with spaces (path + NUL-separated origPath)", async () => {
    const s = await mockedExecutor(fixture).status("/tmp/repo-z3");
    const rename = s.staged.find((f) => f.changeType === ChangeType.Renamed);
    assert.ok(rename, "Expected a staged rename entry");
    assert.strictEqual(rename.path, "my renamed file.txt");
    assert.strictEqual(rename.oldPath, "my old file.txt");
  });

  test("status() parses unmerged entry", async () => {
    const s = await mockedExecutor(fixture).status("/tmp/repo-z4");
    const unmerged = s.unstaged.find((f) => f.changeType === ChangeType.Unmerged);
    assert.ok(unmerged, "Expected an unmerged entry");
    assert.strictEqual(unmerged.path, "conflict file.txt");
    assert.strictEqual(unmerged.status, FileStatus.Unstaged);
  });

  test("status() parses untracked entry with spaces", async () => {
    const s = await mockedExecutor(fixture).status("/tmp/repo-z5");
    assert.deepStrictEqual(s.untracked.map((f) => f.path), ["untracked file.txt"]);
  });

  test("shortStatus() counts entries and skips rename origPath token", async () => {
    // origPath deliberately looks like an untracked entry — the stateful
    // iterator must consume it as the rename's second token, not parse it
    const tricky =
      `# branch.oid ${H}\0` +
      "# branch.head main\0" +
      "# branch.ab +1 -0\0" +
      `1 .M N... 100644 100644 100644 ${H} ${H} café.txt\0` +
      `2 R. N... 100644 100644 100644 ${H} ${H} R100 new name.txt\0? not untracked.txt\0` +
      `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} conflict.txt\0` +
      "? 真.txt\0";
    const s = await mockedExecutor(tricky).shortStatus("/tmp/repo-z6");
    assert.strictEqual(s.staged, 1); // rename (index column R)
    assert.strictEqual(s.unstaged, 2); // café.txt (worktree M) + unmerged
    assert.strictEqual(s.untracked, 1); // 真.txt only — origPath token skipped
    assert.strictEqual(s.branch, "main");
    assert.strictEqual(s.ahead, 1);
    assert.strictEqual(s.behind, 0);
    assert.strictEqual(s.headOid, H);
  });

  test("status() invokes git status with -z", async () => {
    const executor = new GitExecutor();
    let capturedArgs: string[] = [];
    (executor as any)._run = async (args: string[]) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", code: 0 };
    };
    await executor.status("/tmp/repo-z7");
    assert.ok(capturedArgs.includes("-z"), `Expected -z in args: ${capturedArgs.join(" ")}`);
  });
});

describe("GitExecutor Status Error Handling", () => {
  test("status() throws on non-zero exit and does not cache the failure", async () => {
    const executor = new GitExecutor();
    let fail = true;
    (executor as any)._run = async () =>
      fail
        ? { stdout: "", stderr: "fatal: not a git repository", code: 128 }
        : { stdout: "# branch.head main\0", stderr: "", code: 0 };

    await assert.rejects(() => executor.status("/tmp/repo-err1"), {
      message: /fatal: not a git repository/,
    });

    // A failed run must not be cached as a clean repo — next call retries
    fail = false;
    const s = await executor.status("/tmp/repo-err1");
    assert.strictEqual(s.branch, "main");
  });

  test("shortStatus() throws on non-zero exit with stderr in message", async () => {
    const executor = new GitExecutor();
    (executor as any)._run = async () => ({ stdout: "", stderr: "fatal: bad revision", code: 128 });
    await assert.rejects(() => executor.shortStatus("/tmp/repo-err2"), {
      message: /fatal: bad revision/,
    });
  });
});

describe("GitExecutor Status Cache Isolation", () => {
  test("status() returns a defensive copy — mutating callers can't poison the cache", async () => {
    const executor = new GitExecutor();
    const H = "1111111111111111111111111111111111111111";
    (executor as any)._run = async () => ({
      stdout: `# branch.head main\0` + `1 .M N... 100644 100644 100644 ${H} ${H} a.txt\0`,
      stderr: "",
      code: 0,
    });

    const first = await executor.status("/tmp/repo-copy");
    first.unstaged.length = 0; // mutate the returned object
    (first as any).branch = "poisoned";

    const second = await executor.status("/tmp/repo-copy"); // cache hit (1s TTL)
    assert.strictEqual(second.branch, "main");
    assert.strictEqual(second.unstaged.length, 1);
  });
});

describe("GitExecutor Branch Parsing", () => {
  function mockedExecutor(stdout: string): GitExecutor {
    const executor = new GitExecutor();
    (executor as any)._run = async () => ({ stdout, stderr: "", code: 0 });
    return executor;
  }

  test("branches() parses %(HEAD)-tab-%(refname:short) format", async () => {
    // " " = normal, "*" = current; worktree branches also show " " with --format
    const out = " \tfeature/x\n*\tmain\n \twt-branch\n";
    const branches = await mockedExecutor(out).branches("/tmp/repo");
    assert.deepStrictEqual(branches, [
      { name: "feature/x", current: false },
      { name: "main", current: true },
      { name: "wt-branch", current: false },
    ]);
  });

  test("branches() tolerates legacy '+' worktree marker", async () => {
    const out = "*\tmain\n+\twt-branch\n";
    const branches = await mockedExecutor(out).branches("/tmp/repo");
    assert.deepStrictEqual(branches, [
      { name: "main", current: true },
      { name: "wt-branch", current: false },
    ]);
  });

  test("branches() filters out detached HEAD pseudo-entry", async () => {
    const out = "*\t(HEAD detached at abc1234)\n \tmain\n \tfeature/x\n";
    const branches = await mockedExecutor(out).branches("/tmp/repo");
    assert.deepStrictEqual(branches, [
      { name: "main", current: false },
      { name: "feature/x", current: false },
    ]);
  });

  test("branches() returns [] for empty output", async () => {
    const branches = await mockedExecutor("").branches("/tmp/repo");
    assert.deepStrictEqual(branches, []);
  });

  test("mergedBranches() excludes protected branches and detached HEAD", async () => {
    const out = "main\nfeature/done\nmaster\ndevelop\n(HEAD detached at abc1234)\nfix/old\n";
    const merged = await mockedExecutor(out).mergedBranches("/tmp/repo", "main");
    assert.deepStrictEqual(merged, ["feature/done", "fix/old"]);
  });

  test("mergedBranches() binds the ref via --merged=<ref>", async () => {
    const executor = new GitExecutor();
    let capturedArgs: string[] = [];
    (executor as any)._run = async (args: string[]) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", code: 0 };
    };
    await executor.mergedBranches("/tmp/repo", "main");
    assert.ok(capturedArgs.includes("--merged=main"), `Expected --merged=main in args: ${capturedArgs.join(" ")}`);
  });
});

describe("GitExecutor Meta Cache", () => {
  const executor = new GitExecutor();

  test("invalidateMetaCache clears all entries", () => {
    // Populate cache via internal method
    (executor as any)._setCachedMeta("repo1:remoteUrl", "https://example.com");
    (executor as any)._setCachedMeta("repo2:remoteUrl", "https://example.com");
    executor.invalidateMetaCache();
    assert.strictEqual((executor as any)._getCachedMeta("repo1:remoteUrl"), undefined);
    assert.strictEqual((executor as any)._getCachedMeta("repo2:remoteUrl"), undefined);
  });

  test("invalidateMetaCache clears entries for specific repo", () => {
    (executor as any)._setCachedMeta("repo1:remoteUrl", "url1");
    (executor as any)._setCachedMeta("repo1:stashCount", 3);
    (executor as any)._setCachedMeta("repo2:remoteUrl", "url2");
    executor.invalidateMetaCache("repo1");
    assert.strictEqual((executor as any)._getCachedMeta("repo1:remoteUrl"), undefined);
    assert.strictEqual((executor as any)._getCachedMeta("repo1:stashCount"), undefined);
    assert.strictEqual((executor as any)._getCachedMeta("repo2:remoteUrl"), "url2");
  });

  test("invalidateMetaCache does not clear sibling repos sharing a path prefix", () => {
    (executor as any)._setCachedMeta("/a/foo:remoteUrl", "url-foo");
    (executor as any)._setCachedMeta("/a/foo-bar:remoteUrl", "url-foo-bar");
    executor.invalidateMetaCache("/a/foo");
    assert.strictEqual((executor as any)._getCachedMeta("/a/foo:remoteUrl"), undefined);
    assert.strictEqual((executor as any)._getCachedMeta("/a/foo-bar:remoteUrl"), "url-foo-bar");
  });

  test("mutators invalidate the meta cache for their repo", async () => {
    const mutEx = new GitExecutor();
    (mutEx as any)._run = async () => ({ stdout: "", stderr: "", code: 0 });
    const ops: [string, () => Promise<unknown>][] = [
      ["commit", () => mutEx.commit("/a/repo", "msg")],
      ["commitAmend", () => mutEx.commitAmend("/a/repo", "msg")],
      ["stashPush", () => mutEx.stashPush("/a/repo")],
      ["stashPop", () => mutEx.stashPop("/a/repo")],
      ["stashApply", () => mutEx.stashApply("/a/repo", 0)],
      ["stashDrop", () => mutEx.stashDrop("/a/repo", 0)],
      ["pull", () => mutEx.pull("/a/repo")],
      ["resetSoft", () => mutEx.resetSoft("/a/repo")],
      ["resetHard", () => mutEx.resetHard("/a/repo")],
    ];
    for (const [name, op] of ops) {
      (mutEx as any)._setCachedMeta("/a/repo:stashCount", 7);
      await op();
      assert.strictEqual(
        (mutEx as any)._getCachedMeta("/a/repo:stashCount"),
        undefined,
        `${name} should invalidate the meta cache`
      );
    }
  });

  test("cache respects TTL", async () => {
    // Set a value with artificially expired time
    (executor as any)._metaCache.set("expired:key", { value: "old", time: 0 });
    assert.strictEqual((executor as any)._getCachedMeta("expired:key"), undefined);
  });

  test("cache returns value within TTL", () => {
    (executor as any)._setCachedMeta("fresh:key", "value");
    assert.strictEqual((executor as any)._getCachedMeta("fresh:key"), "value");
  });
});
