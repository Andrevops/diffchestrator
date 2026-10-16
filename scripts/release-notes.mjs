#!/usr/bin/env node

/**
 * Print the CHANGELOG.md section for one version (used by the release
 * workflow so GitHub Release notes match the committed changelog exactly).
 *
 * Usage: node scripts/release-notes.mjs <version|vX.Y.Z>
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractReleaseNotes } from "./releaseLib.mjs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notes = extractReleaseNotes(readFileSync(join(root, "CHANGELOG.md"), "utf-8"), version);
if (notes === null) {
  console.error(`No CHANGELOG.md entry found for ${version}`);
  process.exit(1);
}
process.stdout.write(notes + "\n");
