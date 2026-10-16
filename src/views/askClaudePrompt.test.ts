import * as assert from "node:assert";
import { test } from "node:test";
import { buildAskClaudePrompt, MAX_ASK_CLAUDE_PROMPT } from "./askClaudePrompt.ts";

test("buildAskClaudePrompt joins hunk lines into a single line", () => {
  const hunk = "@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n";
  const p = buildAskClaudePrompt("src/a.ts", hunk);
  assert.ok(!/[\r\n]/.test(p), "prompt must not contain raw newlines");
  assert.strictEqual(
    p,
    "Explain this change in src/a.ts: @@ -1,2 +1,2 @@\\n-old line\\n+new line\\n context"
  );
});

test("buildAskClaudePrompt strips control characters and CRs", () => {
  const p = buildAskClaudePrompt("we\nird\x1b.ts", "+a\r\n+b\x07\x1b[31m\u2028x");
  assert.ok(!/[\x00-\x1f\x7f\u2028]/.test(p), JSON.stringify(p));
  assert.ok(p.startsWith("Explain this change in we ird.ts: "));
});

test("buildAskClaudePrompt caps the total length", () => {
  const hunk = Array.from({ length: 5000 }, (_, i) => `+line ${i}`).join("\n");
  const p = buildAskClaudePrompt("f.ts", hunk);
  assert.ok(p.length <= MAX_ASK_CLAUDE_PROMPT);
  assert.ok(p.endsWith("(hunk truncated)"));
});
