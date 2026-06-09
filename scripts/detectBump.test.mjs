import * as assert from "node:assert";
import { test } from "node:test";
import { classifyBump } from "./detectBump.mjs";

test("classifyBump: feat → minor", () => {
  assert.strictEqual(classifyBump(["feat: add dashboard tab"]), "minor");
  assert.strictEqual(classifyBump(["feat(terminal): add icons"]), "minor");
});

test("classifyBump: fix → patch", () => {
  assert.strictEqual(classifyBump(["fix: stop per-event refresh"]), "patch");
  assert.strictEqual(classifyBump(["fix(terminal): keep focus"]), "patch");
});

test("classifyBump: breaking-change bang on any type → major", () => {
  assert.strictEqual(classifyBump(["feat!: drop legacy config"]), "major");
  assert.strictEqual(classifyBump(["fix!: change diff payload shape"]), "major");
  assert.strictEqual(classifyBump(["refactor(scope)!: rename commands"]), "major");
  assert.strictEqual(classifyBump(["chore(deps)!: require node 20"]), "major");
});

test("classifyBump: BREAKING CHANGE text → major", () => {
  assert.strictEqual(classifyBump(["feat: thing", "BREAKING CHANGE: config renamed"]), "major");
  assert.strictEqual(classifyBump(["BREAKING-CHANGE: config renamed"]), "major");
  assert.strictEqual(classifyBump(["breaking change: lowercase still counts"]), "major");
});

test("classifyBump: chore/docs/etc. default to patch", () => {
  assert.strictEqual(classifyBump(["chore: tidy makefile"]), "patch");
  assert.strictEqual(classifyBump(["docs: update readme", "ci: bump action"]), "patch");
});

test("classifyBump: highest bump wins across mixed commits", () => {
  assert.strictEqual(classifyBump(["chore: tidy", "feat: new view", "fix: typo"]), "minor");
  assert.strictEqual(classifyBump(["fix: typo", "feat: new view", "refactor!: breaking"]), "major");
});

test("classifyBump: non-breaking bang placement is not major", () => {
  // Bang must be immediately before the colon in the type prefix
  assert.strictEqual(classifyBump(["feat: add support for ! in search"]), "minor");
  assert.strictEqual(classifyBump(["fix: handle trailing !: in labels"]), "patch");
});
