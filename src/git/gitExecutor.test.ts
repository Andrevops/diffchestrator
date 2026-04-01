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
