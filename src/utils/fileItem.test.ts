import * as assert from "node:assert";
import { test } from "node:test";
import { resolveFileItem } from "./fileItem.ts";

test("resolveFileItem", () => {
  // Test undefined/null item
  assert.strictEqual(resolveFileItem(undefined), undefined);
  assert.strictEqual(resolveFileItem(null), undefined);
  assert.strictEqual(resolveFileItem({}), undefined);

  // Test FileNode shape
  const fileNode = {
    type: "file",
    repoPath: "/path/to/repo",
    fileChange: {
      path: "src/file.ts"
    }
  };
  assert.deepStrictEqual(resolveFileItem(fileNode), {
    repoPath: "/path/to/repo",
    filePath: "src/file.ts"
  });

  // Test TreeItem shape
  const treeItem = {
    repoPath: "/path/to/repo",
    filePath: "src/file.ts"
  };
  assert.deepStrictEqual(resolveFileItem(treeItem), {
    repoPath: "/path/to/repo",
    filePath: "src/file.ts"
  });

  // Test missing repoPath
  const missingRepoPath = {
    filePath: "src/file.ts"
  };
  assert.strictEqual(resolveFileItem(missingRepoPath), undefined);

  // Test missing filePath and fileChange
  const missingFilePath = {
    repoPath: "/path/to/repo"
  };
  assert.strictEqual(resolveFileItem(missingFilePath), undefined);

  // Test fallback logic: fileChange.path vs filePath
  const bothPaths = {
    repoPath: "/path/to/repo",
    fileChange: {
      path: "src/fileChange.ts"
    },
    filePath: "src/filePath.ts"
  };
  assert.deepStrictEqual(resolveFileItem(bothPaths), {
    repoPath: "/path/to/repo",
    filePath: "src/fileChange.ts"
  });
});
