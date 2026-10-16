import * as assert from "node:assert";
import { test, describe } from "node:test";
import { isWithin, findOwningRoot } from "./paths.ts";

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
