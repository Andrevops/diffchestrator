import * as assert from "node:assert";
import { test, describe } from "node:test";
import { formatRepoList, pluralRepos, planSync, type SyncCandidate } from "./repoList.ts";

describe("formatRepoList", () => {
  test("empty list renders empty string", () => {
    assert.strictEqual(formatRepoList([]), "");
  });

  test("short list is fully bulleted", () => {
    assert.strictEqual(formatRepoList(["a", "b"]), "• a\n• b");
  });

  test("long list is truncated with a remainder line", () => {
    const names = Array.from({ length: 13 }, (_, i) => `r${i}`);
    const out = formatRepoList(names, 10).split("\n");
    assert.strictEqual(out.length, 11);
    assert.strictEqual(out[9], "• r9");
    assert.strictEqual(out[10], "…and 3 more");
  });

  test("exactly max entries has no remainder line", () => {
    assert.strictEqual(formatRepoList(["a", "b", "c"], 3), "• a\n• b\n• c");
  });

  test("max below 1 still shows one entry", () => {
    assert.strictEqual(formatRepoList(["a", "b"], 0), "• a\n…and 1 more");
  });
});

test("pluralRepos", () => {
  assert.strictEqual(pluralRepos(1), "1 repo");
  assert.strictEqual(pluralRepos(0), "0 repos");
  assert.strictEqual(pluralRepos(4), "4 repos");
});

describe("planSync", () => {
  const repo = (name: string, o: Partial<SyncCandidate> = {}): SyncCandidate => ({
    name, path: `/r/${name}`, ahead: 0, behind: 0, stagedCount: 0, unstagedCount: 0, ...o,
  });

  test("clean behind repo is pulled", () => {
    const p = planSync([repo("a", { behind: 2 })]);
    assert.deepStrictEqual(p.pull.map((r) => r.name), ["a"]);
    assert.strictEqual(p.push.length, 0);
  });

  test("dirty behind repo is skipped, not pulled or pushed", () => {
    const p = planSync([repo("a", { behind: 1, unstagedCount: 1 }), repo("b", { behind: 1, stagedCount: 2 })]);
    assert.deepStrictEqual(p.skippedDirty.map((r) => r.name), ["a", "b"]);
    assert.strictEqual(p.pull.length, 0);
    assert.strictEqual(p.push.length, 0);
  });

  test("ahead-only repo is pushed even when dirty", () => {
    const p = planSync([repo("a", { ahead: 1, unstagedCount: 3 })]);
    assert.deepStrictEqual(p.push.map((r) => r.name), ["a"]);
  });

  test("diverged repo is skipped entirely", () => {
    const p = planSync([repo("a", { ahead: 1, behind: 1 })]);
    assert.deepStrictEqual(p.skippedDiverged.map((r) => r.name), ["a"]);
    assert.strictEqual(p.pull.length + p.push.length + p.skippedDirty.length, 0);
  });

  test("up-to-date repos are ignored", () => {
    const p = planSync([repo("a"), repo("b", { unstagedCount: 5 })]);
    assert.strictEqual(p.pull.length + p.push.length + p.skippedDirty.length + p.skippedDiverged.length, 0);
  });
});
