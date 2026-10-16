import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "vscode";
import { FileWatcher, isGitStateFile } from "./fileWatcher.ts";
import { GitExecutor } from "../git/gitExecutor.ts";
import { makeTestRepo } from "../git/testRepo.ts";
import type { RepoManager } from "./repoManager.ts";

const isWin = process.platform === "win32";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeRepoManager(paths: string[]) {
  const refreshes: { path: string; fromWatcher?: boolean }[] = [];
  const emitter = new EventEmitter();
  const rm = {
    onDidChangeRepos: emitter.event,
    activeRepoPaths: new Set(paths),
    git: new GitExecutor(),
    refreshRepo: async (p: string, opts?: { fromWatcher?: boolean }) => {
      refreshes.push({ path: p, fromWatcher: opts?.fromWatcher });
    },
  };
  return { rm: rm as unknown as RepoManager, refreshes };
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(25);
  }
  return cond();
}

describe("FileWatcher", () => {
  test("git state pattern covers fetch/reset/packed-refs and lock files, not refs/objects", () => {
    for (const name of ["HEAD", "HEAD.lock", "index", "index.lock", "FETCH_HEAD", "ORIG_HEAD",
      "packed-refs", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REBASE_HEAD", "rebase-merge", "COMMIT_EDITMSG"]) {
      assert.ok(isGitStateFile(name), name);
    }
    for (const name of ["refs", "objects", "logs", "config", "description", "hooks"]) {
      assert.ok(!isGitStateFile(name), name);
    }
  });

  test("events during suppression schedule one trailing refresh instead of being dropped", async () => {
    const { rm, refreshes } = fakeRepoManager(["/r/a"]);
    const fw = new FileWatcher(rm);
    try {
      fw.suppressRefresh("/r/a", 700);
      (fw as any)._debouncedRefresh("/r/a");
      (fw as any)._debouncedRefresh("/r/a");
      await sleep(550);
      assert.strictEqual(refreshes.length, 0, "must wait for the suppression window to end");
      assert.ok(await waitFor(() => refreshes.length > 0, 1000), "trailing refresh must fire");
      await sleep(100);
      assert.deepStrictEqual(refreshes, [{ path: "/r/a", fromWatcher: true }]);
    } finally {
      fw.dispose();
    }
  });

  test("unsuppressed events refresh after the debounce with fromWatcher", async () => {
    const { rm, refreshes } = fakeRepoManager(["/r/b"]);
    const fw = new FileWatcher(rm);
    try {
      (fw as any)._debouncedRefresh("/r/b");
      assert.ok(await waitFor(() => refreshes.length > 0, 1500));
      assert.deepStrictEqual(refreshes, [{ path: "/r/b", fromWatcher: true }]);
    } finally {
      fw.dispose();
    }
  });

  test("a terminal `git fetch`-style FETCH_HEAD write triggers a refresh (real dir)", { skip: isWin }, async () => {
    const repo = makeTestRepo({ commit: true });
    const { rm, refreshes } = fakeRepoManager([repo.dir]);
    const fw = new FileWatcher(rm);
    try {
      fw.watchAll();
      await waitFor(() => (fw as any)._watchers.has(repo.dir), 1000);
      fs.writeFileSync(path.join(repo.dir, ".git", "FETCH_HEAD"), "x\n");
      assert.ok(await waitFor(() => refreshes.length > 0), "FETCH_HEAD change must refresh");
    } finally {
      fw.dispose();
      repo.cleanup();
    }
  });

  test("watches a linked worktree's real git dir (.git is a gitdir: file)", { skip: isWin }, async () => {
    const repo = makeTestRepo({ commit: true });
    const wt = `${repo.dir}-wt`;
    repo.git("worktree", "add", "-q", "-b", "wt-branch", wt);
    const { rm, refreshes } = fakeRepoManager([wt]);
    const fw = new FileWatcher(rm);
    try {
      assert.ok(fs.statSync(path.join(wt, ".git")).isFile(), "precondition: worktree .git is a file");
      fw.watchAll();
      assert.ok(await waitFor(() => (fw as any)._watchers.has(wt), 1000), "worktree must be watched");
      fs.writeFileSync(path.join(wt, "new.txt"), "x\n");
      repo.git("-C", wt, "add", "new.txt");
      repo.git("-C", wt, "commit", "-q", "-m", "wt commit");
      assert.ok(await waitFor(() => refreshes.some((r) => r.path === wt)), "worktree commit must refresh");
    } finally {
      fw.dispose();
      fs.rmSync(wt, { recursive: true, force: true });
      repo.cleanup();
    }
  });
});
