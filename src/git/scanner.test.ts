import { test, describe } from "node:test";
import * as assert from "node:assert";
import fs from "node:fs";
import { Scanner } from "./scanner.ts";
import type { GitExecutor } from "./gitExecutor.ts";

describe("Scanner", () => {
  describe("scanFast", () => {
    test("handles readdirSync errors gracefully", (t) => {
      const mockGit = {} as GitExecutor;

      const logs: string[] = [];
      const logFn = (msg: string) => logs.push(msg);

      const scanner = new Scanner(mockGit, 2, [], logFn);

      t.mock.method(fs, "existsSync", (p: fs.PathLike) => {
        return false;
      });

      t.mock.method(fs, "readdirSync", (p: fs.PathLike, options: any) => {
        throw new Error("EACCES: permission denied, scandir '/mock/dir'");
      });

      const result = scanner.scanFast("/mock/dir");

      assert.deepStrictEqual(result, []);

      const errorLog = logs.find(log => log.includes("readdir error") && log.includes("EACCES"));
      assert.ok(errorLog, "Should log the readdirSync error");
    });
  });
});
