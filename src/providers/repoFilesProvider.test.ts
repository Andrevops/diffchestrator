import { test, describe, before } from "node:test";
import * as assert from "node:assert";
import * as vscode from "vscode";
import { diffLeftPath } from "./diffSides.ts";
import { RepoFilesProvider } from "./repoFilesProvider.ts";
import { fakeRepoManager } from "./testFakes.ts";
import { ChangeType, FileStatus, type FileChange, type RepoStatus } from "../types.ts";
import type { RepoManager } from "../services/repoManager.ts";

describe("diffLeftPath (rename HEAD side)", () => {
  const rename = (status: FileChange["status"]): FileChange => ({
    path: "new.ts", oldPath: "old.ts", changeType: ChangeType.Renamed, status,
  });

  test("staged rename reads the ORIGINAL path from HEAD", () => {
    assert.strictEqual(diffLeftPath(rename(FileStatus.Staged)), "old.ts");
  });

  test("unstaged side compares against the index, which has the new path", () => {
    assert.strictEqual(diffLeftPath(rename(FileStatus.Unstaged)), "new.ts");
  });

  test("non-rename uses its path", () => {
    assert.strictEqual(
      diffLeftPath({ path: "a.ts", changeType: ChangeType.Modified, status: FileStatus.Staged }),
      "a.ts"
    );
  });
});

describe("RepoFilesProvider change map", () => {
  // The stub lacks this event; RepoFilesProvider subscribes in its constructor.
  before(() => {
    (vscode.workspace as any).onDidSaveTextDocument ??= () => ({ dispose: () => {} });
  });

  const status = (paths: string[]): RepoStatus => ({
    branch: "main", ahead: 0, behind: 0, staged: [], untracked: [],
    unstaged: paths.map((p) => ({ path: p, changeType: ChangeType.Modified, status: FileStatus.Unstaged })),
  });

  test("a load that started before a file event cannot overwrite the post-event reload", async () => {
    const gates: ((s: RepoStatus) => void)[] = [];
    const invalidated: string[] = [];
    const { rm } = fakeRepoManager({
      selectedRepo: "/r",
      git: {
        status: () => new Promise<RepoStatus>((resolve) => gates.push(resolve)),
        invalidateStatus: (p: string) => invalidated.push(p),
      },
    });
    const provider = new RepoFilesProvider(rm as unknown as RepoManager);
    try {
      // 1) An expand starts a status load (pre-event)
      const first = (provider as any)._ensureChangedFiles();
      await new Promise((r) => setImmediate(r));
      // 2) A file event flushes: must invalidate GitExecutor's cache and start a NEW load
      const flush = (provider as any)._flushRefresh();
      await new Promise((r) => setImmediate(r));
      assert.deepStrictEqual(invalidated, ["/r"], "flush must invalidate the status cache");
      assert.strictEqual(gates.length, 2, "flush must not join the pre-event load");
      // 3) Post-event load finishes first, then the stale one
      gates[1](status(["fresh.ts"]));
      await flush;
      gates[0](status(["stale.ts"]));
      await first;
      assert.ok(provider.getChange("/r/fresh.ts"), "post-event change must be present");
      assert.strictEqual(provider.getChange("/r/stale.ts"), undefined, "stale load must be discarded");
    } finally {
      provider.dispose();
    }
  });
});
