#!/usr/bin/env node

/**
 * Package the Open VSX .vsix (publisher "andrevops") from an already-built dist/.
 *
 * The Marketplace and Open VSX publishers differ, so package.json's publisher is
 * swapped temporarily and always restored byte-for-byte, even on failure.
 * Shared by scripts/release.mjs and the GitHub release workflow.
 *
 * Usage: node scripts/package-openvsx.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OPENVSX_PUBLISHER = "andrevops";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");

const original = readFileSync(pkgPath, "utf-8");
const pkg = JSON.parse(original);
const outFile = `${pkg.name}-${pkg.version}-openvsx.vsix`;

pkg.publisher = OPENVSX_PUBLISHER;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
try {
  const isWin = process.platform === "win32";
  const vsce = join(root, "node_modules", ".bin", isWin ? "vsce.cmd" : "vsce");
  // .cmd shims can only be spawned through a shell on Windows
  execFileSync(vsce, ["package", "--no-dependencies", "-o", outFile], { cwd: root, stdio: "inherit", shell: isWin });
} finally {
  writeFileSync(pkgPath, original);
}

console.log(`Packaged ${outFile}`);
