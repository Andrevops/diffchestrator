import { test, describe } from "node:test";
import * as assert from "node:assert";
import fs from "node:fs";
import { Scanner } from "./scanner.ts";
import type { GitExecutor } from "./gitExecutor.ts";

describe("Scanner", () => {
  describe("scanFast", () => {
    test("handles readdir errors gracefully", async (t) => {
      const mockGit = {} as GitExecutor;

      const logs: string[] = [];
      const logFn = (msg: string) => logs.push(msg);

      const scanner = new Scanner(mockGit, 2, [], logFn);

      t.mock.method(fs.promises, "access", async (p: fs.PathLike) => {
        throw new Error("ENOENT: no such file or directory");
      });

      t.mock.method(fs.promises, "readdir", async (p: fs.PathLike, options: any) => {
        throw new Error("EACCES: permission denied, scandir '/mock/dir'");
      });

      const result = await scanner.scanFast("/mock/dir");

      assert.deepStrictEqual(result, []);

      const errorLog = logs.find(log => log.includes("readdir error") && log.includes("EACCES"));
      assert.ok(errorLog, "Should log the readdir error");
    });
  });
});
