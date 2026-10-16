import * as assert from "node:assert";
import { test, describe } from "node:test";
import * as vscode from "vscode";
import { withRepo, NO_REPO_MESSAGE } from "./withRepo.ts";

/** Capture warnings shown through the vscode stub. */
function captureWarnings(): { messages: string[]; restore: () => void } {
  const w = vscode.window as unknown as { showWarningMessage: (m: string) => Promise<unknown> };
  const original = w.showWarningMessage;
  const messages: string[] = [];
  w.showWarningMessage = (m: string) => { messages.push(m); return Promise.resolve(undefined); };
  return { messages, restore: () => { w.showWarningMessage = original; } };
}

describe("withRepo", () => {
  test("resolves the repo from the item, passing the item through", async () => {
    const calls: [string, unknown][] = [];
    const handler = withRepo({ selectedRepo: "/sel" }, (p, item) => { calls.push([p, item]); return 42; });
    const item = { path: "/from/item", preserveFocus: true };
    assert.strictEqual(await handler(item), 42);
    assert.deepStrictEqual(calls, [["/from/item", item]]);
  });

  test("falls back to the selected repo", async () => {
    const seen: string[] = [];
    await withRepo({ selectedRepo: "/sel" }, (p) => { seen.push(p); })();
    assert.deepStrictEqual(seen, ["/sel"]);
  });

  test("selectedOnly ignores the item", async () => {
    const seen: string[] = [];
    await withRepo({ selectedRepo: "/sel" }, (p) => { seen.push(p); }, { selectedOnly: true })({ path: "/other" });
    assert.deepStrictEqual(seen, ["/sel"]);
  });

  test("warns and skips the handler when nothing resolves", async () => {
    const cap = captureWarnings();
    try {
      let called = false;
      const r = await withRepo({ selectedRepo: undefined }, () => { called = true; })();
      assert.strictEqual(r, undefined);
      assert.strictEqual(called, false);
      assert.deepStrictEqual(cap.messages, [NO_REPO_MESSAGE]);

      await withRepo({ selectedRepo: undefined }, () => {}, { message: "custom" })();
      assert.deepStrictEqual(cap.messages, [NO_REPO_MESSAGE, "custom"]);
    } finally {
      cap.restore();
    }
  });
});
