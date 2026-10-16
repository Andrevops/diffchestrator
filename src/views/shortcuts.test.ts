import * as assert from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildShortcuts, formatKeybinding } from "./shortcuts.ts";

test("formatKeybinding formats chords", () => {
  assert.strictEqual(formatKeybinding("alt+d shift+t"), "Alt+D, Shift+T");
  assert.strictEqual(formatKeybinding("alt+d down"), "Alt+D, ↓");
  assert.strictEqual(formatKeybinding("alt+d shift+/"), "Alt+D, Shift+/");
  assert.strictEqual(formatKeybinding("alt+d backspace"), "Alt+D, Backspace");
});

test("buildShortcuts resolves titles and prefers platform keys", () => {
  const pkg = {
    contributes: {
      commands: [{ command: "x.a", title: "Do A" }],
      keybindings: [
        { command: "x.a", key: "alt+d a", mac: "cmd+d a" },
        { command: "x.a", key: "alt+d a" }, // duplicate
        { command: "x.b", key: "alt+d b" }, // no title → command id
        { command: "-x.c", key: "alt+d c" }, // removal rule
      ],
    },
  };
  assert.deepStrictEqual(buildShortcuts(pkg, "linux"), [
    { key: "Alt+D, A", title: "Do A", command: "x.a" },
    { key: "Alt+D, B", title: "x.b", command: "x.b" },
  ]);
  assert.strictEqual(buildShortcuts(pkg, "darwin")[0].key, "Cmd+D, A");
});

test("buildShortcuts covers every keybinding in package.json", () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  const shortcuts = buildShortcuts(pkg, "linux");
  const listed = new Set(shortcuts.map((s) => s.command));
  for (const kb of pkg.contributes.keybindings) {
    assert.ok(listed.has(kb.command), `keybinding for ${kb.command} missing from cheat sheet`);
  }
  for (const s of shortcuts) assert.notStrictEqual(s.title, s.command, `missing title for ${s.command}`);
});

test("buildShortcuts tolerates malformed input", () => {
  assert.deepStrictEqual(buildShortcuts(undefined, "linux"), []);
  assert.deepStrictEqual(buildShortcuts({ contributes: { keybindings: "nope" } }, "linux"), []);
});
