import * as assert from "node:assert";
import { test } from "node:test";
import { getMessageRepoPath } from "./types.ts";
import type { DashboardMessage, DiffWebviewMessage } from "./types.ts";

test("getMessageRepoPath", async (t) => {
  await t.test("should extract repoPath from DashboardMessage with repoPath", () => {
    const msg: DashboardMessage = { type: "openRepo", repoPath: "/my/repo/path" };
    assert.strictEqual(getMessageRepoPath(msg), "/my/repo/path");
  });

  await t.test("should extract repoPath from DiffWebviewMessage with repoPath", () => {
    const msg: DiffWebviewMessage = { type: "stageFile", repoPath: "/my/repo/path", filePath: "file.ts" };
    assert.strictEqual(getMessageRepoPath(msg), "/my/repo/path");
  });

  await t.test("should return undefined for DashboardMessage without repoPath", () => {
    const msg: DashboardMessage = { type: "scan" };
    assert.strictEqual(getMessageRepoPath(msg), undefined);
  });

  await t.test("should return undefined for DiffWebviewMessage without repoPath", () => {
    const msg: DiffWebviewMessage = { type: "refresh" };
    assert.strictEqual(getMessageRepoPath(msg), undefined);
  });
});
