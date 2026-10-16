import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import type * as vscode from "vscode";
import { GitContentProvider } from "./gitContentProvider.ts";
import { GitExecutor } from "../git/gitExecutor.ts";
import { makeTestRepo, type TestRepo } from "../git/testRepo.ts";

const isWin = process.platform === "win32";

describe("GitContentProvider", { skip: isWin }, () => {
  let repo: TestRepo;
  before(() => {
    repo = makeTestRepo({ commit: true });
    repo.write("app/(auth)/page.tsx", "export default 1;\n");
    repo.write("odd/$x&y;{z}|w.ts", "odd\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "next");
  });
  after(() => repo.cleanup());

  const uri = (q: object) => ({ query: JSON.stringify(q) }) as unknown as vscode.Uri;

  test("serves paths containing ( ) $ & ; { } |", async () => {
    const p = new GitContentProvider(new GitExecutor());
    assert.strictEqual(
      await p.provideTextDocumentContent(uri({ path: "app/(auth)/page.tsx", ref: "HEAD", repoPath: repo.dir })),
      "export default 1;\n"
    );
    assert.strictEqual(
      await p.provideTextDocumentContent(uri({ path: "odd/$x&y;{z}|w.ts", ref: "HEAD", repoPath: repo.dir })),
      "odd\n"
    );
    assert.strictEqual(
      await p.provideTextDocumentContent(uri({ path: "app/(auth)/page.tsx", ref: ":0", repoPath: repo.dir })),
      "export default 1;\n"
    );
  });

  test("still rejects an invalid ref", async () => {
    const p = new GitContentProvider(new GitExecutor());
    assert.strictEqual(
      await p.provideTextDocumentContent(uri({ path: "README.md", ref: "--output=/tmp/x", repoPath: repo.dir })),
      ""
    );
    assert.strictEqual(
      await p.provideTextDocumentContent(uri({ path: "README.md", ref: "HEAD;rm", repoPath: repo.dir })),
      ""
    );
  });
});
