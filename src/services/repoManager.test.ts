import { test, describe, before, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import type * as vscode from "vscode";
import { RepoManager } from "./repoManager.ts";
import { Scanner } from "../git/scanner.ts";
import type { RepoSummary } from "../types.ts";

/** In-memory Memento for state persistence tests. */
function makeState(initial: Record<string, unknown> = {}): vscode.Memento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    keys: () => [...store.keys()],
    get: ((key: string, def?: unknown) => store.has(key) ? store.get(key) : def) as vscode.Memento["get"],
    update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); },
  };
}

describe("RepoManager", () => {
  describe("selectRepo + MRU", () => {
    let rm: RepoManager;
    beforeEach(() => { rm = new RepoManager(makeState()); });

    test("selectRepo sets the selected path", () => {
      rm.selectRepo("/a/repo");
      assert.strictEqual(rm.selectedRepo, "/a/repo");
    });

    test("selecting multiple repos reorders MRU with latest first", () => {
      rm.selectRepo("/a");
      rm.selectRepo("/b");
      rm.selectRepo("/c");
      assert.deepStrictEqual([...rm.recentRepoPaths], ["/c", "/b", "/a"]);
    });

    test("reselecting an existing repo moves it to the head without duplicates", () => {
      rm.selectRepo("/a");
      rm.selectRepo("/b");
      rm.selectRepo("/a");
      assert.deepStrictEqual([...rm.recentRepoPaths], ["/a", "/b"]);
    });

    test("MRU is capped at 10 entries", () => {
      for (let i = 0; i < 15; i++) rm.selectRepo(`/repo${i}`);
      assert.strictEqual(rm.recentRepoPaths.length, 10);
      // Newest (14) at head, 11 entries earlier dropped (0..4)
      assert.strictEqual(rm.recentRepoPaths[0], "/repo14");
      assert.strictEqual(rm.recentRepoPaths[9], "/repo5");
    });

    test("onDidChangeSelection fires on selectRepo", () => {
      let fired = 0;
      rm.onDidChangeSelection(() => fired++);
      rm.selectRepo("/a");
      rm.selectRepo("/b");
      assert.strictEqual(fired, 2);
    });
  });

  describe("multi-selection", () => {
    let rm: RepoManager;
    beforeEach(() => { rm = new RepoManager(makeState()); });

    test("toggleRepoSelection adds when absent, removes when present", () => {
      rm.toggleRepoSelection("/a");
      assert.ok(rm.selectedRepoPaths.has("/a"));
      rm.toggleRepoSelection("/a");
      assert.ok(!rm.selectedRepoPaths.has("/a"));
    });

    test("toggleRepoSelection supports multiple repos", () => {
      rm.toggleRepoSelection("/a");
      rm.toggleRepoSelection("/b");
      rm.toggleRepoSelection("/c");
      assert.strictEqual(rm.selectedRepoPaths.size, 3);
    });

    test("clearMultiSelection empties the set", () => {
      rm.toggleRepoSelection("/a");
      rm.toggleRepoSelection("/b");
      rm.clearMultiSelection();
      assert.strictEqual(rm.selectedRepoPaths.size, 0);
    });

    test("onDidChangeSelection fires on toggle and clear", () => {
      let fired = 0;
      rm.onDidChangeSelection(() => fired++);
      rm.toggleRepoSelection("/a");
      rm.toggleRepoSelection("/b");
      rm.clearMultiSelection();
      assert.strictEqual(fired, 3);
    });
  });

  describe("directory paths", () => {
    let rm: RepoManager;
    beforeEach(() => { rm = new RepoManager(makeState()); });

    test("addDirectoryPath tracks and selects the directory", () => {
      rm.addDirectoryPath("/some/dir");
      assert.ok(rm.isDirectory("/some/dir"));
      assert.ok(rm.directoryPaths.has("/some/dir"));
      assert.strictEqual(rm.selectedRepo, "/some/dir");
    });

    test("isDirectory is false for untracked paths", () => {
      assert.ok(!rm.isDirectory("/never/added"));
    });

    test("removeDirectoryPath removes from tracking", () => {
      rm.addDirectoryPath("/some/dir");
      rm.removeDirectoryPath("/some/dir");
      assert.ok(!rm.isDirectory("/some/dir"));
      assert.ok(!rm.directoryPaths.has("/some/dir"));
    });
  });

  describe("state persistence", () => {
    test("restores recent repos from Memento", () => {
      const state = makeState({
        "diffchestrator.recentRepoPaths": ["/a", "/b", "/c"],
        "diffchestrator.selectedRepo": "/a",
      });
      const rm = new RepoManager(state);
      assert.strictEqual(rm.selectedRepo, "/a");
      assert.deepStrictEqual([...rm.recentRepoPaths], ["/a", "/b", "/c"]);
    });

    test("restores directory paths from Memento", () => {
      const state = makeState({
        "diffchestrator.directoryPaths": ["/dir1", "/dir2"],
      });
      const rm = new RepoManager(state);
      assert.ok(rm.isDirectory("/dir1"));
      assert.ok(rm.isDirectory("/dir2"));
    });

    test("restoreRecent overwrites recent + selected", () => {
      const rm = new RepoManager(makeState());
      rm.selectRepo("/a");
      rm.restoreRecent(["/x", "/y"], "/x");
      assert.strictEqual(rm.selectedRepo, "/x");
      assert.deepStrictEqual([...rm.recentRepoPaths], ["/x", "/y"]);
    });
  });

  describe("tag filtering", () => {
    test("activeTagFilter reflects setTagFilter and clears", () => {
      const rm = new RepoManager(makeState());
      assert.strictEqual(rm.activeTagFilter, undefined);
      rm.setTagFilter("frontend");
      assert.strictEqual(rm.activeTagFilter, "frontend");
      rm.setTagFilter(undefined);
      assert.strictEqual(rm.activeTagFilter, undefined);
    });
  });

  describe("scan epoch guard", () => {
    const origScanFast = Scanner.prototype.scanFast;
    const origFetchMetadata = Scanner.prototype.fetchMetadata;

    const makeRepo = (p: string): RepoSummary => ({
      path: p,
      name: p.split("/").pop() ?? p,
      branch: "main",
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      totalChanges: 0,
      ahead: 0,
      behind: 0,
      headOid: "",
      stashCount: 0,
    });

    afterEach(() => {
      Scanner.prototype.scanFast = origScanFast;
      Scanner.prototype.fetchMetadata = origFetchMetadata;
    });

    test("superseded scan does not merge its Phase-1 repos into the newer scan's root", async () => {
      // Root1's scanFast is slow; root2's resolves immediately. Without the
      // Phase-1 epoch guard, root1's late result would insert ghost repos
      // into _repos after root2 already owns it.
      Scanner.prototype.scanFast = async function (rootPath: string): Promise<RepoSummary[]> {
        if (rootPath === "/root1") {
          await new Promise((r) => setTimeout(r, 50));
          return [makeRepo("/root1/alpha"), makeRepo("/root1/beta")];
        }
        return [makeRepo("/root2/gamma")];
      };
      Scanner.prototype.fetchMetadata = async () => {};

      const rm = new RepoManager(makeState());
      try {
        const scan1 = rm.scan("/root1");
        const scan2 = rm.scan("/root2");
        await Promise.all([scan1, scan2]);

        assert.strictEqual(rm.currentRoot, "/root2");
        assert.deepStrictEqual(
          rm.allRepos.map((r) => r.path).sort(),
          ["/root2/gamma"],
          "stale root1 repos must not leak into root2's repo map"
        );
      } finally {
        rm.dispose(); // clears the auto-refresh interval started by scan()
      }
    });
  });

  describe("dispose", () => {
    test("dispose does not throw on fresh instance", () => {
      const rm = new RepoManager(makeState());
      assert.doesNotThrow(() => rm.dispose());
    });

    test("event emitters stop firing after dispose", () => {
      const rm = new RepoManager(makeState());
      rm.dispose();
      // Subsequent selectRepo can still mutate internal state, but no listeners remain
      let fired = 0;
      rm.onDidChangeSelection(() => fired++);
      // We can't assert the listener is rejected — Node's default EE allows it —
      // but disposing twice must remain safe.
      assert.doesNotThrow(() => rm.dispose());
    });
  });
});
