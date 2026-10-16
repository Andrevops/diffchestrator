import * as assert from "node:assert";
import { test } from "node:test";
import {
  bumpVersion,
  classifyBump,
  extractReleaseNotes,
  groupChangelog,
  parseGitLog,
  prependChangelog,
  renderChangelogEntry,
} from "./releaseLib.mjs";

const rec = (subject, body = "") => `${subject}\x1f${body}\x1e`;

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
  assert.strictEqual(classifyBump(["fix(scope)!: change diff payload shape"]), "major");
  assert.strictEqual(classifyBump(["refactor(scope)!: rename commands"]), "major");
  assert.strictEqual(classifyBump(["chore(deps)!: require node 20"]), "major");
});

test("classifyBump: BREAKING CHANGE text → major", () => {
  assert.strictEqual(classifyBump(["feat: thing", "BREAKING CHANGE: config renamed"]), "major");
  assert.strictEqual(classifyBump(["BREAKING-CHANGE: config renamed"]), "major");
  assert.strictEqual(classifyBump(["breaking change: lowercase still counts"]), "major");
});

test("classifyBump: BREAKING CHANGE footer in body → major", () => {
  const commits = parseGitLog(
    rec("feat: rename settings", "Some details.\n\nBREAKING CHANGE: diffchestrator.roots renamed to scanRoots") +
      rec("fix: typo"),
  );
  assert.strictEqual(classifyBump(commits), "major");
  assert.strictEqual(
    classifyBump([{ subject: "fix: x", body: "Refs: #1\nBREAKING-CHANGE: payload shape changed" }]),
    "major",
  );
});

test("classifyBump: body prose mentioning breaking change is not a footer", () => {
  assert.strictEqual(
    classifyBump([{ subject: "feat: x", body: "This is not a BREAKING CHANGE for users." }]),
    "minor",
  );
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

test("parseGitLog: splits records with multi-line bodies", () => {
  const raw = rec("feat: a", "line1\nline2") + "\n" + rec("fix: b") + "\n";
  assert.deepStrictEqual(parseGitLog(raw), [
    { subject: "feat: a", body: "line1\nline2" },
    { subject: "fix: b", body: "" },
  ]);
  assert.deepStrictEqual(parseGitLog(""), []);
});

test("bumpVersion", () => {
  assert.strictEqual(bumpVersion("0.84.3", "patch"), "0.84.4");
  assert.strictEqual(bumpVersion("0.84.3", "minor"), "0.85.0");
  assert.strictEqual(bumpVersion("0.84.3", "major"), "1.0.0");
  assert.throws(() => bumpVersion("1.0.0-beta.1", "patch"));
  assert.throws(() => bumpVersion("1.0.0", "huge"));
});

test("groupChangelog: groups by type, skips release/ci, strips prefixes", () => {
  const sections = groupChangelog([
    "feat(views): add tab",
    "fix: crash",
    "perf: faster scan",
    "docs: readme",
    "ci: pin actions",
    "chore(release): v1.0.0",
    { subject: "refactor!: rename", body: "" },
  ]);
  assert.deepStrictEqual(sections, [
    { title: "Features", items: ["Add tab"] },
    { title: "Bug Fixes", items: ["Crash"] },
    { title: "Performance", items: ["Faster scan"] },
    { title: "Other", items: ["Readme", "**BREAKING:** Rename"] },
  ]);
});

test("renderChangelogEntry / prependChangelog", () => {
  assert.strictEqual(renderChangelogEntry("1.0.0", ["ci: x", "chore(release): v0.9.0"]), null);
  const entry = renderChangelogEntry("1.0.1", ["fix: thing"]);
  assert.strictEqual(entry, "## 1.0.1\n\n### Bug Fixes\n- Thing");
  const existing =
    "# Changelog\n\nAll notable changes to Diffchestrator are documented here. Generated from conventional commits.\n\n## 1.0.0\n\n### Features\n- Old\n";
  const out = prependChangelog(existing, entry);
  assert.match(out, /^# Changelog\n\n.*conventional commits\.\n\n## 1\.0\.1\n\n### Bug Fixes\n- Thing\n\n## 1\.0\.0\n/);
});

test("extractReleaseNotes: returns only the requested version's section", () => {
  const cl = "# Changelog\n\nIntro.\n\n## 0.84.3\n\n### Performance\n- Fast\n\n## 0.84.2\n\n### Bug Fixes\n- Rows\n";
  assert.strictEqual(extractReleaseNotes(cl, "0.84.3"), "### Performance\n- Fast");
  assert.strictEqual(extractReleaseNotes(cl, "v0.84.2"), "### Bug Fixes\n- Rows");
  assert.strictEqual(extractReleaseNotes(cl, "0.84.1"), null);
  // "0.84.3" must not match "0.84.30" or "0x84x3"
  assert.strictEqual(extractReleaseNotes("## 0.84.30\n\n- x\n", "0.84.3"), null);
});
