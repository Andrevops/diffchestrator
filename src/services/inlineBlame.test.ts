import { test, describe } from "node:test";
import * as assert from "node:assert";
import { BlameCache } from "./inlineBlame.ts";
import { GitExecutor } from "../git/gitExecutor.ts";
import { makeTestRepo } from "../git/testRepo.ts";

const isWin = process.platform === "win32";
const b = (hash: string) => ({ hash, author: "a", date: "", summary: "s" });

describe("BlameCache", () => {
  test("invalidateFile drops only that file's lines", () => {
    const c = new BlameCache();
    c.set("/r/a.ts", 1, b("1"));
    c.set("/r/a.ts", 2, b("2"));
    c.set("/r/a.tsx", 1, b("3")); // shares a prefix — must survive
    c.set("/r/b.ts", 1, null);
    c.invalidateFile("/r/a.ts");
    assert.strictEqual(c.get("/r/a.ts", 1), undefined);
    assert.strictEqual(c.get("/r/a.ts", 2), undefined);
    assert.strictEqual(c.get("/r/a.tsx", 1)?.blame?.hash, "3");
    assert.strictEqual(c.get("/r/b.ts", 1)?.blame, null);
  });

  test("clear empties; TTL expires; size is bounded", () => {
    const c = new BlameCache();
    c.set("/r/a.ts", 1, b("1"), 0);
    assert.strictEqual(c.get("/r/a.ts", 1, BlameCache.TTL + 1), undefined, "expired");
    for (let i = 0; i < BlameCache.MAX + 50; i++) c.set("/r/x.ts", i, null);
    assert.strictEqual(c.size, BlameCache.MAX);
    c.clear();
    assert.strictEqual(c.size, 0);
  });
});

describe("GitExecutor.blame with buffer contents (real git)", { skip: isWin }, () => {
  test("blames the dirty buffer, not the on-disk file", async () => {
    const repo = makeTestRepo();
    try {
      repo.write("f.txt", "one\ntwo\n");
      repo.git("add", "f.txt");
      repo.git("commit", "-q", "-m", "first");
      const first = repo.git("rev-parse", "HEAD").trim();
      const ex = new GitExecutor();

      // Buffer has a new line inserted at the top: "one" is now on line 2
      const buffer = "inserted\none\ntwo\n";
      const l1 = await ex.blame(repo.dir, "f.txt", 1, buffer);
      const l2 = await ex.blame(repo.dir, "f.txt", 2, buffer);
      assert.ok(l1?.hash.startsWith("0000000"), "inserted line is uncommitted");
      assert.strictEqual(l2?.hash, first, "line 2 of the buffer is the committed 'one'");

      // Without contents, line 1 is the on-disk 'one'
      assert.strictEqual((await ex.blame(repo.dir, "f.txt", 1))?.hash, first);
    } finally {
      repo.cleanup();
    }
  });
});
