import * as assert from "node:assert";
import { test, describe } from "node:test";
import { planDiscard, type DiscardState } from "./discardLogic.ts";

const state = (o: Partial<DiscardState>): DiscardState => ({
  staged: false, unstaged: false, untracked: false, addedInIndex: false, ...o,
});

describe("planDiscard", () => {
  test("untracked file is deleted", () => {
    const p = planDiscard("a.txt", state({ untracked: true, itemStatus: "untracked" }))!;
    assert.deepStrictEqual(p.choices.map((c) => c.action), ["clean"]);
    assert.match(p.message, /Delete untracked file "a.txt"/);
  });

  test("unstaged-only file uses checkout", () => {
    const p = planDiscard("a.txt", state({ unstaged: true, itemStatus: "unstaged" }))!;
    assert.deepStrictEqual(p.choices.map((c) => c.action), ["checkout"]);
  });

  test("staged-only file restores from HEAD (checkout would keep the staged change)", () => {
    const p = planDiscard("a.txt", state({ staged: true, itemStatus: "staged" }))!;
    assert.deepStrictEqual(p.choices.map((c) => c.action), ["restoreHead"]);
    assert.match(p.message, /restoring it from HEAD/);
  });

  test("newly added staged file says it will be deleted", () => {
    const p = planDiscard("new.ts", state({ staged: true, addedInIndex: true, itemStatus: "staged" }))!;
    assert.deepStrictEqual(p.choices.map((c) => c.action), ["restoreHead"]);
    assert.match(p.message, /unstaged and deleted/);
    assert.match(p.choices[0].done, /Removed newly added/);
  });

  test("staged + modified offers both, primary depends on acted-on item", () => {
    const fromStaged = planDiscard("a.txt", state({ staged: true, unstaged: true, itemStatus: "staged" }))!;
    assert.deepStrictEqual(fromStaged.choices.map((c) => c.action), ["restoreHead", "checkout"]);
    const fromUnstaged = planDiscard("a.txt", state({ staged: true, unstaged: true, itemStatus: "unstaged" }))!;
    assert.deepStrictEqual(fromUnstaged.choices.map((c) => c.action), ["checkout", "restoreHead"]);
    // The checkout toast must not claim the staged change was discarded
    assert.match(fromUnstaged.choices[0].done, /staged changes kept/);
  });

  test("clean file → nothing to do", () => {
    assert.strictEqual(planDiscard("a.txt", state({ itemStatus: "unstaged" })), undefined);
  });
});
