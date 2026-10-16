#!/usr/bin/env node

/**
 * Cut a release: preflight → bump → verify (typecheck, test, build, package)
 * → commit + tag. Nothing is committed or tagged unless every check passes,
 * and package.json / package-lock.json / CHANGELOG.md are restored on failure.
 *
 * Usage:
 *   node scripts/release.mjs          # auto-detect bump from commits
 *   node scripts/release.mjs patch    # force patch
 *   node scripts/release.mjs minor    # force minor
 *   node scripts/release.mjs major    # force major
 *
 * Push afterwards with: git push --atomic origin main v<version>
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GIT_LOG_FORMAT,
  bumpVersion,
  classifyBump,
  parseGitLog,
  prependChangelog,
  renderChangelogEntry,
} from "./releaseLib.mjs";

const RELEASE_BRANCH = "main";
const REMOTE = "origin";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  pkg: join(root, "package.json"),
  lock: join(root, "package-lock.json"),
  changelog: join(root, "CHANGELOG.md"),
};

/** Run a command (no shell) and return trimmed stdout. */
function out(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Run a command (no shell) with inherited stdio. */
function step(label, cmd, args) {
  console.log(`\n▶ ${label}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ── Args ────────────────────────────────────────────────────────────
const forced = process.argv[2];
if (forced && !["patch", "minor", "major"].includes(forced)) {
  fail(`Invalid bump type: ${forced}. Use patch, minor, or major.`);
}

// ── Preflight (read-only) ───────────────────────────────────────────
if (out("git", ["status", "--porcelain"]) !== "") {
  fail("Working tree is not clean. Commit or stash your changes first.");
}

const branch = out("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== RELEASE_BRANCH) {
  fail(`Releases must be cut from '${RELEASE_BRANCH}' (currently on '${branch}').`);
}

console.log(`Fetching ${REMOTE}...`);
out("git", ["fetch", "--quiet", "--tags", REMOTE, RELEASE_BRANCH]);
const head = out("git", ["rev-parse", "HEAD"]);
const upstream = out("git", ["rev-parse", `${REMOTE}/${RELEASE_BRANCH}`]);
if (head !== upstream) {
  fail(`Local ${RELEASE_BRANCH} (${head.slice(0, 7)}) is not in sync with ${REMOTE}/${RELEASE_BRANCH} (${upstream.slice(0, 7)}). Pull/push first.`);
}

let lastTag = null;
try {
  lastTag = out("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]);
} catch {
  // no previous tag
}

const commits = parseGitLog(
  out("git", ["log", lastTag ? `${lastTag}..HEAD` : "HEAD", "--no-merges", `--format=${GIT_LOG_FORMAT}`]),
);
if (commits.length === 0) fail("No commits found since last tag. Nothing to release.");

const originals = {
  pkg: readFileSync(paths.pkg, "utf-8"),
  lock: readFileSync(paths.lock, "utf-8"),
  changelog: readFileSync(paths.changelog, "utf-8"),
};

const pkg = JSON.parse(originals.pkg);
const bump = forced || classifyBump(commits);
const version = bumpVersion(pkg.version, bump);
const tag = `v${version}`;

try {
  out("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`]);
  fail(`Tag ${tag} already exists locally.`);
} catch (err) {
  if (err?.status !== 1) throw err; // rev-parse --verify exits 1 when absent
}
if (out("git", ["ls-remote", "--tags", REMOTE, `refs/tags/${tag}`]) !== "") {
  fail(`Tag ${tag} already exists on ${REMOTE}.`);
}

console.log(`\n${lastTag ? `Last tag: ${lastTag}` : "No previous tag found"}`);
console.log(`Bump:     ${bump}`);
console.log(`Version:  ${tag}`);

// ── Bump + verify (restored on any failure) ─────────────────────────
function restore() {
  writeFileSync(paths.pkg, originals.pkg);
  writeFileSync(paths.lock, originals.lock);
  writeFileSync(paths.changelog, originals.changelog);
}

try {
  pkg.version = version;
  writeFileSync(paths.pkg, JSON.stringify(pkg, null, 2) + "\n");

  const lock = JSON.parse(originals.lock);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeFileSync(paths.lock, JSON.stringify(lock, null, 2) + "\n");

  const entry = renderChangelogEntry(version, commits);
  if (entry) writeFileSync(paths.changelog, prependChangelog(originals.changelog, entry));

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  step("Typecheck", npm, ["run", "typecheck"]);
  step("Test", npm, ["test"]);
  step("Build + package (Marketplace)", npm, ["run", "package"]);
  step("Package (Open VSX)", npm, ["run", "package:openvsx"]);
} catch (err) {
  restore();
  fail(`Release aborted, package.json / package-lock.json / CHANGELOG.md restored: ${err.message}`);
}

// ── Commit + tag (last) ─────────────────────────────────────────────
const files = ["package.json", "package-lock.json", "CHANGELOG.md"];
try {
  out("git", ["add", "--", ...files]);
  out("git", ["commit", "-m", `chore(release): ${tag}`]);
} catch (err) {
  try {
    out("git", ["reset", "-q", "--", ...files]);
  } catch {
    // best effort
  }
  restore();
  fail(`git commit failed, release files restored: ${err.stderr || err.message}`);
}

try {
  out("git", ["tag", tag]);
} catch (err) {
  fail(
    `Committed chore(release): ${tag} but tagging failed: ${err.stderr || err.message}\n` +
      `  Fix the problem and run 'git tag ${tag}', or undo the commit with 'git reset --hard HEAD~1'.`,
  );
}

console.log(`\n✔ Committed and tagged ${tag}`);
console.log(`  Marketplace: ${pkg.name}-${version}.vsix`);
console.log(`  Open VSX:    ${pkg.name}-${version}-openvsx.vsix`);
console.log(`\nNext: git push --atomic ${REMOTE} ${RELEASE_BRANCH} ${tag}`);
console.log(`Install locally: code --install-extension ${pkg.name}-${version}.vsix --force`);
