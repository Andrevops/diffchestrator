import * as assert from "node:assert";
import { test, describe } from "node:test";
import { extractTabUri, getMessageRepoPath } from "./types.ts";

describe("extractTabUri", () => {
  test("should return undefined for falsy inputs", () => {
    assert.strictEqual(extractTabUri(undefined), undefined);
    assert.strictEqual(extractTabUri(null), undefined);
    assert.strictEqual(extractTabUri(false), undefined);
    assert.strictEqual(extractTabUri(0), undefined);
    assert.strictEqual(extractTabUri(""), undefined);
  });

  test("should return undefined for objects without uri properties", () => {
    assert.strictEqual(extractTabUri({}), undefined);
    assert.strictEqual(extractTabUri({ someOtherProp: "value" }), undefined);
  });

  test("should extract uri from TabInputText-like object", () => {
    const mockUri = { scheme: "file", path: "/test/file.txt" };
    const input = { uri: mockUri };
    assert.strictEqual(extractTabUri(input), mockUri);
  });

  test("should extract original uri from TabInputDiff-like object", () => {
    const mockOriginalUri = { scheme: "file", path: "/test/original.txt" };
    const mockModifiedUri = { scheme: "file", path: "/test/modified.txt" };
    const input = { original: mockOriginalUri, modified: mockModifiedUri };
    assert.strictEqual(extractTabUri(input), mockOriginalUri);
  });

  test("should extract modified uri from TabInputDiff-like object when original is missing", () => {
    const mockModifiedUri = { scheme: "file", path: "/test/modified.txt" };
    const input = { modified: mockModifiedUri };
    assert.strictEqual(extractTabUri(input), mockModifiedUri);
  });

  test("should prioritize uri over original and modified", () => {
    const mockUri = { scheme: "file", path: "/test/uri.txt" };
    const mockOriginalUri = { scheme: "file", path: "/test/original.txt" };
    const mockModifiedUri = { scheme: "file", path: "/test/modified.txt" };
    const input = { uri: mockUri, original: mockOriginalUri, modified: mockModifiedUri };
    assert.strictEqual(extractTabUri(input), mockUri);
  });
});

describe("getMessageRepoPath", () => {
  test("should extract repoPath from DashboardMessage", () => {
    const msg = { type: "openRepo", repoPath: "/test/repo" } as const;
    assert.strictEqual(getMessageRepoPath(msg), "/test/repo");
  });

  test("should extract repoPath from DiffWebviewMessage", () => {
    const msg = { type: "stageFile", repoPath: "/test/repo", filePath: "file.txt" } as const;
    assert.strictEqual(getMessageRepoPath(msg), "/test/repo");
  });

  test("should return undefined if repoPath is not present", () => {
    const msg = { type: "ready" } as const;
    assert.strictEqual(getMessageRepoPath(msg as any), undefined);
  });
});
