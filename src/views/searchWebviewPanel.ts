import * as vscode from "vscode";
import * as path from "path";
import { RepoManager } from "../services/repoManager";
import type { SearchWebviewMessage } from "../types";

const MAX_QUERY_LENGTH = 1000;
const MAX_RESULTS = 2000;

/** Full-text search panel for a single repo (works for out-of-workspace repos). */
export class SearchWebviewPanel {
  public static currentPanel: SearchWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _repoManager: RepoManager;
  private _repoPath: string;
  private _disposed = false;

  static createOrShow(
    extensionUri: vscode.Uri,
    repoManager: RepoManager,
    repoPath: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SearchWebviewPanel.currentPanel) {
      SearchWebviewPanel.currentPanel._panel.reveal(column);
      SearchWebviewPanel.currentPanel.setRepo(repoPath);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "diffchestratorSearch",
      `Search: ${path.basename(repoPath)}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "webview-search"),
        ],
      }
    );

    SearchWebviewPanel.currentPanel = new SearchWebviewPanel(
      panel,
      extensionUri,
      repoManager,
      repoPath
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    repoManager: RepoManager,
    repoPath: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._repoManager = repoManager;
    this._repoPath = repoPath;

    this._panel.webview.html = this._getWebviewContent();

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  /** Retarget the panel to another repo (re-invoked command, context menu). */
  setRepo(repoPath: string): void {
    if (this._disposed) return;
    if (repoPath === this._repoPath) return;
    this._repoPath = repoPath;
    this._panel.title = `Search: ${path.basename(repoPath)}`;
    this._postRepo();
  }

  private _postRepo(): void {
    this._panel.webview.postMessage({
      type: "repo",
      repoName: path.basename(this._repoPath),
      repoPath: this._repoPath,
    });
  }

  private async _handleMessage(msg: SearchWebviewMessage): Promise<void> {
    if (this._disposed) return;
    switch (msg.type) {
      case "ready":
        this._postRepo();
        break;

      case "search": {
        const { requestId } = msg;
        const query = typeof msg.query === "string" ? msg.query : "";
        if (!query || query.length > MAX_QUERY_LENGTH) {
          this._panel.webview.postMessage({
            type: "results", requestId, matches: [], truncated: false, durationMs: 0,
          });
          break;
        }
        const parseGlobs = (s: unknown): string[] =>
          typeof s === "string"
            ? s.split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith(":"))
            : [];
        const started = Date.now();
        try {
          const { matches, truncated } = await this._repoManager.git.grepSearch(
            this._repoPath,
            query,
            {
              caseSensitive: !!msg.caseSensitive,
              regex: !!msg.regex,
              wholeWord: !!msg.wholeWord,
              include: parseGlobs(msg.include),
              exclude: parseGlobs(msg.exclude),
              maxResults: MAX_RESULTS,
            }
          );
          if (this._disposed) break;
          this._panel.webview.postMessage({
            type: "results",
            requestId,
            matches,
            truncated,
            durationMs: Date.now() - started,
          });
        } catch (err: unknown) {
          if (this._disposed) break;
          const message = err instanceof Error ? err.message : String(err);
          this._panel.webview.postMessage({ type: "error", requestId, message });
        }
        break;
      }

      case "openMatch": {
        if (typeof msg.file !== "string") break;
        // Confine to the repo — the webview must not open arbitrary paths
        const full = path.resolve(this._repoPath, msg.file);
        if (full !== this._repoPath && !full.startsWith(this._repoPath + path.sep)) break;
        const line = Math.max(0, (typeof msg.line === "number" ? msg.line : 1) - 1);
        const col = Math.max(0, (typeof msg.column === "number" ? msg.column : 1) - 1);
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(full), {
            selection: new vscode.Range(line, col, line, col),
            preview: true,
            viewColumn: vscode.ViewColumn.Beside,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Failed to open ${msg.file}: ${message}`);
        }
        break;
      }
    }
  }

  private _getWebviewContent(): string {
    const webview = this._panel.webview;
    const distPath = vscode.Uri.joinPath(this._extensionUri, "dist", "webview-search");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "main.css"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';
             font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Search</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this._disposed = true;
    SearchWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
