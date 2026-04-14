import { test, describe } from "node:test";
import * as assert from "node:assert";
import { GitExecutor } from "./gitExecutor.ts";
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
