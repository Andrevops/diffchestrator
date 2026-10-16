import * as assert from "node:assert";
import { test, describe } from "node:test";
import { isWithin, findOwningRoot, uriBelongsToRepo } from "./paths.ts";

describe("uriBelongsToRepo", () => {
  const file = (p: string) => ({ scheme: "file", fsPath: p, query: "" });
  const show = (query: string) => ({ scheme: "git-show", fsPath: "/x", query });

  test("file URIs by containment, not prefix", () => {
    assert.ok(uriBelongsToRepo(file("/r/foo/a.ts"), "/r/foo", "/"));
    assert.ok(uriBelongsToRepo(file("/r/foo"), "/r/foo", "/"));
    assert.ok(!uriBelongsToRepo(file("/r/foo-bar/a.ts"), "/r/foo", "/"));
  });

  test("git-show URIs by repoPath in the query", () => {
    assert.ok(uriBelongsToRepo(show(JSON.stringify({ repoPath: "/r/foo", path: "a" })), "/r/foo", "/"));
    assert.ok(!uriBelongsToRepo(show(JSON.stringify({ repoPath: "/r/other" })), "/r/foo", "/"));
    assert.ok(!uriBelongsToRepo(show("not json"), "/r/foo", "/"));
  });

  test("other schemes never belong", () => {
    assert.ok(!uriBelongsToRepo({ scheme: "untitled", fsPath: "/r/foo/a", query: "" }, "/r/foo", "/"));
  });
});

describe("isWithin", () => {
  test("self and descendants", () => {
    assert.ok(isWithin("/x/foo", "/x/foo", "/"));
    assert.ok(isWithin("/x/foo/bar", "/x/foo", "/"));
    assert.ok(isWithin("/x/foo/bar", "/x/foo/", "/"));
  });

  test("sibling with shared prefix is not inside", () => {
    assert.ok(!isWithin("/x/foo-bar", "/x/foo", "/"));
    assert.ok(!isWithin("/x/fo", "/x/foo", "/"));
  });

  test("empty parent never matches", () => {
    assert.ok(!isWithin("/x", "", "/"));
  });

  test("windows separators", () => {
    assert.ok(isWithin("C:\\src\\repo", "C:\\src", "\\"));
    assert.ok(!isWithin("C:\\src2\\repo", "C:\\src", "\\"));
  });
});

describe("findOwningRoot", () => {
  test("deepest matching root wins", () => {
    assert.strictEqual(findOwningRoot("/a/b/c/repo", ["/a", "/a/b", "/z"], "/"), "/a/b");
  });

  test("no matching root", () => {
    assert.strictEqual(findOwningRoot("/q/repo", ["/a", "/a/b"], "/"), undefined);
    assert.strictEqual(findOwningRoot("/ab/repo", ["/a"], "/"), undefined);
  });
});
