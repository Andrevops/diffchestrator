import * as assert from "node:assert";
import { test, describe, beforeEach } from "node:test";
import {
  findRepoForTerminal,
  registerRepoTerminal,
  repoTerminals,
  matchTerminalName,
  repoNameFromTerminalName,
  trackedRepoForTerminal,
  legacyNamePatterns,
} from "./terminalLogic.ts";
import type { Terminal } from "vscode";

const term = (name: string) => ({ name }) as unknown as Terminal;

describe("findRepoForTerminal", () => {
  beforeEach(() => {
    repoTerminals.clear();
  });

  const mockInfer = () => undefined;

  test("should find repo via tracked map", () => {
    const mockTerminal = term("test-term-tracked");
    registerRepoTerminal("/path/to/myrepo", "shell", mockTerminal);

    const result = findRepoForTerminal(mockTerminal, ["/path/to/myrepo", "/other/repo"], [], mockInfer);
    assert.strictEqual(result, "/path/to/myrepo");
  });

  test("tracked map wins even for paths outside the given repo list", () => {
    const t = term("whatever");
    registerRepoTerminal("/old/root/repo", "claude", t);
    assert.strictEqual(findRepoForTerminal(t, ["/new/root/other"], [], mockInfer), "/old/root/repo");
  });

  test("should find repo by exact bare basename", () => {
    const result = findRepoForTerminal(term("my-project"), ["/var/www/my-project", "/var/www/other-project"], [], mockInfer);
    assert.strictEqual(result, "/var/www/my-project");
    assert.strictEqual(repoTerminals.get("/var/www/my-project::shell")?.name, "my-project");
  });

  test("substring names do NOT match (foreign terminals are never adopted)", () => {
    for (const name of ["my-project-yolo", "node my-project", "my-project 2", "bash"]) {
      const result = findRepoForTerminal(term(name), ["/var/www/my-project"], [], mockInfer);
      assert.strictEqual(result, undefined, name);
    }
    assert.strictEqual(repoTerminals.size, 0);
  });

  test("shorter repo name does not match a longer terminal name", () => {
    const result = findRepoForTerminal(term("diffchestrator-vscode"), ["/projects/diffchestrator"], [], mockInfer);
    assert.strictEqual(result, undefined);
  });

  test("legacy prefixed names match exactly and set the kind", () => {
    const result = findRepoForTerminal(term("YOLO: diffchestrator-vscode"), [
      "/projects/diffchestrator",
      "/projects/diffchestrator-vscode",
    ], [], mockInfer);
    assert.strictEqual(result, "/projects/diffchestrator-vscode");
    assert.ok(repoTerminals.has("/projects/diffchestrator-vscode::yolo"));
  });

  test("bare name uses the icon kind", () => {
    findRepoForTerminal(term("repo"), ["/projects/repo"], [], () => "yolonew");
    assert.ok(repoTerminals.has("/projects/repo::yolonew"));
  });

  test("should handle terminal kind fallback logic correctly", () => {
    const term1 = term("repo");
    const term2 = term("repo");

    // Register term1 as yolo
    registerRepoTerminal("/projects/repo", "yolo", term1);

    // Pass term2 (also a yolo icon), term1 is alive
    const result = findRepoForTerminal(term2, ["/projects/repo"], [term1], () => "yolo");

    assert.strictEqual(result, "/projects/repo");
    // term2 should be registered as 'claude' because 'yolo' is taken
    assert.strictEqual(repoTerminals.get("/projects/repo::claude"), term2);
  });

  test("should return undefined if no match found", () => {
    const result = findRepoForTerminal(term("random-terminal"), ["/projects/repo1", "/projects/repo2"], [], mockInfer);
    assert.strictEqual(result, undefined);
  });
});

describe("matchTerminalName", () => {
  test("bare exact name", () => {
    assert.strictEqual(matchTerminalName("api", "api"), "bare");
  });

  test("legacy prefixes", () => {
    assert.strictEqual(matchTerminalName("Claude: api", "api"), "claude");
    assert.strictEqual(matchTerminalName("claude:api", "api"), "claude");
    assert.strictEqual(matchTerminalName("Claude Code - api", "api"), "claude");
    assert.strictEqual(matchTerminalName("YOLO: api", "api"), "yolo");
    assert.strictEqual(matchTerminalName("YOLONEW: api", "api"), "yolonew");
    assert.strictEqual(matchTerminalName("DC: api", "api"), "shell");
  });

  test("rejects substrings and word tails", () => {
    assert.strictEqual(matchTerminalName("api-gateway", "api"), undefined);
    assert.strictEqual(matchTerminalName("my api", "api"), undefined);
    assert.strictEqual(matchTerminalName("Claude: foo-api", "api"), undefined);
    assert.strictEqual(matchTerminalName("Claude Code foo-api", "api"), undefined);
    assert.strictEqual(matchTerminalName("YOLO: api2", "api"), undefined);
    assert.strictEqual(matchTerminalName("anything", ""), undefined);
  });

  test("regex metacharacters in repo names are literal", () => {
    assert.strictEqual(matchTerminalName("Claude: a.b", "a.b"), "claude");
    assert.strictEqual(matchTerminalName("Claude: axb", "a.b"), undefined);
    assert.ok(legacyNamePatterns("c++(x)", "shell")[0].test("DC: c++(x)"));
  });
});

describe("repoNameFromTerminalName", () => {
  test("bare and prefixed names", () => {
    assert.strictEqual(repoNameFromTerminalName("api"), "api");
    assert.strictEqual(repoNameFromTerminalName("Claude: api"), "api");
    assert.strictEqual(repoNameFromTerminalName("YOLONEW:api"), "api");
    assert.strictEqual(repoNameFromTerminalName("DC: my repo"), "my repo");
  });

  test("ambiguous or empty names yield undefined", () => {
    assert.strictEqual(repoNameFromTerminalName(""), undefined);
    assert.strictEqual(repoNameFromTerminalName("   "), undefined);
    assert.strictEqual(repoNameFromTerminalName("Claude Code - api"), undefined);
    assert.strictEqual(repoNameFromTerminalName("Claude:  "), undefined);
  });
});

describe("trackedRepoForTerminal", () => {
  beforeEach(() => repoTerminals.clear());

  test("returns path for tracked terminal only", () => {
    const t = term("x");
    assert.strictEqual(trackedRepoForTerminal(t), undefined);
    registerRepoTerminal("/a/b::weird", "shell", t);
    assert.strictEqual(trackedRepoForTerminal(t), "/a/b::weird");
  });
});
