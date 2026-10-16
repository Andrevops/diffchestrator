import * as vscode from "vscode";
import { readFileSync } from "fs";
import { getNonce } from "./nonce";

/**
 * All webviews are built by one multi-entry Vite build into dist/webview
 * (see webview-ui/vite.config.ts): one entry script per panel plus a shared
 * vendor chunk (React), with Vite's manifest.json describing which chunks and
 * stylesheets each entry needs.
 */
export const WEBVIEW_DIST = ["dist", "webview"] as const;

/** Manifest keys of the three entries (the HTML inputs of the Vite build). */
export type WebviewEntry = "index.html" | "dashboard.html" | "search.html";

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
}

type Manifest = Record<string, ManifestChunk>;

let cachedManifest: { path: string; manifest: Manifest } | undefined;

function loadManifest(distUri: vscode.Uri): Manifest {
  const manifestPath = vscode.Uri.joinPath(distUri, "manifest.json").fsPath;
  if (cachedManifest?.path === manifestPath) return cachedManifest.manifest;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  cachedManifest = { path: manifestPath, manifest };
  return manifest;
}

/** Entry file, its (transitive) imported chunks and all CSS, in load order. */
export function resolveEntryAssets(
  manifest: Manifest,
  entry: string
): { script: string; preloads: string[]; styles: string[] } {
  const root = manifest[entry];
  if (!root) throw new Error(`Webview entry ${entry} missing from manifest`);
  const preloads: string[] = [];
  const styles: string[] = [];
  const seen = new Set<string>();
  const visit = (key: string, isRoot: boolean) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    // Imported chunks' CSS first so the entry's own rules win the cascade.
    for (const imp of chunk.imports ?? []) visit(imp, false);
    for (const css of chunk.css ?? []) if (!styles.includes(css)) styles.push(css);
    if (!isRoot) preloads.push(chunk.file);
  };
  visit(entry, true);
  return { script: root.file, preloads, styles };
}

/** localResourceRoots for every webview panel. */
export function webviewResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST)];
}

/**
 * Full HTML document for a webview panel. CSP: no inline styles or scripts
 * ('unsafe-inline' is not needed: all CSS is extracted to files, and React's
 * style props go through CSSOM, which CSP does not restrict); scripts must
 * carry the per-load nonce (module chunks are also allowed from the
 * extension's own resource origin so the shared vendor chunk can be
 * imported).
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entry: WebviewEntry,
  title: string
): string {
  const distUri = vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST);
  const nonce = getNonce();
  const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(distUri, file)).toString();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  let head: string;
  let body: string;
  try {
    const { script, preloads, styles } = resolveEntryAssets(loadManifest(distUri), entry);
    head = [
      ...styles.map((f) => `<link rel="stylesheet" href="${asset(f)}">`),
      ...preloads.map((f) => `<link rel="modulepreload" nonce="${nonce}" href="${asset(f)}">`),
    ].join("\n  ");
    body = `<div id="root"></div>\n  <script type="module" nonce="${nonce}" src="${asset(script)}"></script>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Diffchestrator] Failed to load webview bundle for ${entry}: ${msg}`);
    head = "";
    body = `<p>Diffchestrator: webview bundle not found — run <code>npm run build:webview</code>.</p>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  ${head}
  <title>${title}</title>
</head>
<body>
  ${body}
</body>
</html>`;
}
