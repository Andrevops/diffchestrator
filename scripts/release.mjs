#!/usr/bin/env node

/**
 * Auto-detect semver bump from conventional commits since last version tag,
 * bump package.json, build, and package the .vsix.
 *
 * Usage:
 *   node scripts/release.mjs          # auto-detect from commits
 *   node scripts/release.mjs patch    # force patch
 *   node scripts/release.mjs minor    # force minor
 *   node scripts/release.mjs major    # force major
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");

function run(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf-8" }).trim();
}

// ── Find last version tag ───────────────────────────────────────────
function lastTag() {
  try {
    return run("git describe --tags --abbrev=0 --match 'v*'");
  } catch {
    return null;
  }
}

// ── Detect bump type from conventional commits ──────────────────────
function detectBump(since) {
  const range = since ? `${since}..HEAD` : "HEAD";
  const log = run(`git log ${range} --pretty=format:"%s"`);
  const lines = log.split("\n").filter(Boolean);

  if (lines.length === 0) {
    console.error("No commits found since last tag. Nothing to release.");
    process.exit(1);
  }

  let bump = "patch"; // default

  for (const msg of lines) {
    if (/^feat(\(.+\))?!:|BREAKING[ -]CHANGE/i.test(msg)) {
      return "major";
    }
    if (/^feat(\(.+\))?:/.test(msg)) {
      bump = "minor";
    }
  }

  return bump;
}

// ── Bump version ────────────────────────────────────────────────────
function bumpVersion(bump) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const [major, minor, patch] = pkg.version.split(".").map(Number);

  switch (bump) {
    case "major":
      pkg.version = `${major + 1}.0.0`;
      break;
    case "minor":
      pkg.version = `${major}.${minor + 1}.0`;
      break;
    case "patch":
      pkg.version = `${major}.${minor}.${patch + 1}`;
      break;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return pkg.version;
}

// ── Main ────────────────────────────────────────────────────────────
const forced = process.argv[2];
if (forced && !["patch", "minor", "major"].includes(forced)) {
  console.error(`Invalid bump type: ${forced}. Use patch, minor, or major.`);
  process.exit(1);
}

const tag = lastTag();
const bump = forced || detectBump(tag);
const version = bumpVersion(bump);

console.log(`\n${tag ? `Last tag: ${tag}` : "No previous tag found"}`);
console.log(`Bump:     ${bump}`);
console.log(`Version:  ${version}\n`);

// Build + package
execSync("npm run package", { cwd: root, stdio: "inherit" });

console.log(`\nReady: diffchestrator-${version}.vsix`);
console.log(`Install: code --install-extension diffchestrator-${version}.vsix --force`);
