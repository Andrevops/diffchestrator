import * as assert from "node:assert";
import { test, describe, beforeEach } from "node:test";
import { findRepoForTerminal, registerRepoTerminal, repoTerminals } from "./terminalLogic.ts";
import type { Terminal } from "vscode";

describe("findRepoForTerminal", () => {
  beforeEach(() => {
    repoTerminals.clear();
  });

  const mockInfer = () => undefined;

  test("should find repo via tracked map", () => {
    const mockTerminal = { name: "test-term-tracked" } as unknown as Terminal;
    registerRepoTerminal("/path/to/myrepo", "shell", mockTerminal);

    const result = findRepoForTerminal(mockTerminal, ["/path/to/myrepo", "/other/repo"], [], mockInfer);
    assert.strictEqual(result, "/path/to/myrepo");
  });

  test("should find repo by exact basename match", () => {
    const mockTerminal = { name: "my-project-yolo" } as unknown as Terminal;

    const result = findRepoForTerminal(mockTerminal, ["/var/www/my-project", "/var/www/other-project"], [], mockInfer);
    assert.strictEqual(result, "/var/www/my-project");
  });

  test("should sort and match longest basename first", () => {
    const mockTerminal = { name: "diffchestrator-vscode-shell" } as unknown as Terminal;

    const result = findRepoForTerminal(mockTerminal, [
      "/projects/diffchestrator",
      "/projects/diffchestrator-vscode"
    ], [], mockInfer);
    assert.strictEqual(result, "/projects/diffchestrator-vscode");
  });

  test("should handle terminal kind fallback logic correctly", () => {
    const term1 = { name: "yolo-repo" } as unknown as Terminal;
    const term2 = { name: "yolo-repo-2" } as unknown as Terminal;

    // Register term1 as yolo
    registerRepoTerminal("/projects/repo", "yolo", term1);

    // Pass term2, term1 is active
    const result = findRepoForTerminal(term2, ["/projects/repo"], [term1], () => "yolo");

    assert.strictEqual(result, "/projects/repo");
    // term2 should be registered as 'claude' because 'yolo' is taken
    assert.strictEqual(repoTerminals.get("/projects/repo::claude"), term2);
  });

  test("should return undefined if no match found", () => {
    const mockTerminal = { name: "random-terminal" } as unknown as Terminal;

    const result = findRepoForTerminal(mockTerminal, ["/projects/repo1", "/projects/repo2"], [], mockInfer);
    assert.strictEqual(result, undefined);
  });
});
