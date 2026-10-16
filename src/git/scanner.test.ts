import { test, describe } from "node:test";
import * as assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Scanner } from "./scanner.ts";
import type { GitExecutor } from "./gitExecutor.ts";

describe("Scanner", () => {
  describe("scanFast", () => {
    test("handles readdir errors gracefully", async (t) => {
      const mockGit = {} as GitExecutor;

      const logs: string[] = [];
      const logFn = (msg: string) => logs.push(msg);

      const scanner = new Scanner(mockGit, 2, [], logFn);

      t.mock.method(fs.promises, "access", async (_p: fs.PathLike) => {
        throw new Error("ENOENT: no such file or directory");
      });

      t.mock.method(fs.promises, "readdir", async (_p: fs.PathLike, _options: any) => {
        throw new Error("EACCES: permission denied, scandir '/mock/dir'");
      });

      const result = await scanner.scanFast("/mock/dir");

      assert.deepStrictEqual(result, []);

      const errorLog = logs.find(log => log.includes("readdir error") && log.includes("EACCES"));
      assert.ok(errorLog, "Should log the readdir error");
    });

    test("reports progress (throttled, with a final report)", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-scan-"));
      try {
        for (let i = 0; i < 120; i++) fs.mkdirSync(path.join(root, `d${i}`));
        fs.mkdirSync(path.join(root, "d7", ".git"));
        fs.mkdirSync(path.join(root, "d42", ".git"));
        const scanner = new Scanner({} as GitExecutor, 3);
        const reports: { dirsScanned: number; reposFound: number }[] = [];
        const repos = await scanner.scanFast(root, (p) => reports.push(p));
        assert.strictEqual(repos.length, 2);
        assert.ok(reports.length >= 2 && reports.length <= 5, `throttled: got ${reports.length} reports`);
        assert.deepStrictEqual(reports[reports.length - 1], { dirsScanned: 121, reposFound: 2 });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
