import * as assert from "node:assert";
import { test } from "node:test";
import { resolveEntryAssets } from "./webviewHtml.ts";

const manifest = {
  "_vendor.js": { file: "vendor.js", css: ["vendor.css"] },
  "_util.js": { file: "util.js", imports: ["_vendor.js"] },
  "dashboard.html": {
    file: "dashboard.js",
    imports: ["_vendor.js", "_util.js"],
    css: ["dashboard.css"],
  },
};

test("resolveEntryAssets returns entry, transitive preloads and CSS in cascade order", () => {
  assert.deepStrictEqual(resolveEntryAssets(manifest, "dashboard.html"), {
    script: "dashboard.js",
    preloads: ["vendor.js", "util.js"],
    styles: ["vendor.css", "dashboard.css"],
  });
});

test("resolveEntryAssets throws for a missing entry", () => {
  assert.throws(() => resolveEntryAssets(manifest, "search.html"), /missing from manifest/);
});
