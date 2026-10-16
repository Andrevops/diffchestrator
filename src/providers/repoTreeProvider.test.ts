import { test, describe } from "node:test";
import * as assert from "node:assert";
import type * as vscode from "vscode";
import { RepoTreeProvider } from "./repoTreeProvider.ts";
import { fakeRepoManager } from "./testFakes.ts";
import type { RepoSummary } from "../types.ts";
import type { RepoManager } from "../services/repoManager.ts";

describe("RepoTreeProvider tooltips", () => {
  const repo = (p: string): RepoSummary => ({
    path: p, name: p.split("/").pop()!, branch: "main", stagedCount: 0, unstagedCount: 0,
    untrackedCount: 0, totalChanges: 0, ahead: 0, behind: 0, headOid: "", stashCount: 0,
  });

  test("selection changes spawn no git; resolveTreeItem fetches only the hovered repo", async () => {
    const logCalls: string[] = [];
    const repos = [repo("/r/a"), repo("/r/b"), repo("/r/c")];
    const { rm, changeSelection } = fakeRepoManager({
      repos,
      allRepos: repos,
      git: {
        log: async (p: string) => {
          logCalls.push(p);
          return [{ hash: "h", shortHash: "h", author: "x", date: new Date().toISOString(), message: "feat: hi" }];
        },
      },
    });
    const provider = new RepoTreeProvider(rm as unknown as RepoManager);
    try {
      changeSelection.fire();
      changeSelection.fire();
      await new Promise((r) => setImmediate(r));
      assert.deepStrictEqual(logCalls, [], "selection change must not spawn git log");

      const node = { label: "b", fullPath: "/r/b", isRepo: true, repo: repos[1], children: new Map() };
      const item = await provider.resolveTreeItem({} as vscode.TreeItem, node as any);
      assert.deepStrictEqual(logCalls, ["/r/b"]);
      assert.match(String(item.tooltip), /Last commit: feat: hi/);
      // cached within TTL
      await provider.resolveTreeItem({} as vscode.TreeItem, node as any);
      assert.deepStrictEqual(logCalls, ["/r/b"]);
    } finally {
      provider.dispose();
    }
  });
});
