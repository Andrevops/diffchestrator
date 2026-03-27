import * as assert from "node:assert";
import { test } from "node:test";
import { basename, dirname } from "./paths.ts";

test("basename", () => {
  // Standard paths
  assert.strictEqual(basename("foo/bar.txt"), "bar.txt");
  assert.strictEqual(basename("bar.txt"), "bar.txt");

  // Absolute paths
  assert.strictEqual(basename("/abs/path/to/file"), "file");

  // Paths with trailing slashes
  assert.strictEqual(basename("foo/bar/"), "bar");

  // Empty strings
  assert.strictEqual(basename(""), "");

  // Current/Parent directory
  assert.strictEqual(basename("."), ".");
  assert.strictEqual(basename(".."), "..");

  // Hidden files
  assert.strictEqual(basename(".hidden"), ".hidden");
  assert.strictEqual(basename("foo/.hidden"), ".hidden");

  // Multi-extension files
  assert.strictEqual(basename("archive.tar.gz"), "archive.tar.gz");
  assert.strictEqual(basename("foo/archive.tar.gz"), "archive.tar.gz");
});

test("dirname", () => {
  // Standard paths
  assert.strictEqual(dirname("foo/bar.txt"), "foo");
  assert.strictEqual(dirname("bar.txt"), ".");

  // Absolute paths
  assert.strictEqual(dirname("/abs/path/to/file"), "/abs/path/to");

  // Paths with trailing slashes
  assert.strictEqual(dirname("foo/bar/"), "foo");

  // Empty strings
  assert.strictEqual(dirname(""), ".");

  // Current/Parent directory
  assert.strictEqual(dirname("."), ".");
  assert.strictEqual(dirname(".."), ".");

  // Root paths
  assert.strictEqual(dirname("/"), "/");
  assert.strictEqual(dirname("///"), "/");

  // Multi-slashes
  // Note: path.dirname preserves trailing slash from intermediate components in Node.js
  assert.strictEqual(dirname("foo//bar"), "foo/");

  // Hidden files and directories
  assert.strictEqual(dirname(".hidden"), ".");
  assert.strictEqual(dirname("foo/.hidden"), "foo");
  assert.strictEqual(dirname(".hidden/bar"), ".hidden");
});
