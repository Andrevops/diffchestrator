import * as vscode from "vscode";
import * as path from "path";
import { RepoManager } from "../services/repoManager";
import type { RepoStatus, DiffWebviewMessage } from "../types";
import { escapeForTerminal } from "../utils/shell";

export class DiffWebviewPanel {
  public static currentPanel: DiffWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _repoManager: RepoManager;
  private _git;

  static createOrShow(
    extensionUri: vscode.Uri,
    repoManager: RepoManager
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (DiffWebviewPanel.currentPanel) {
      DiffWebviewPanel.currentPanel._panel.reveal(column);
      DiffWebviewPanel.currentPanel._update();
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "diffchestratorDiff",
      "Diffchestrator: Multi-Repo Diff",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "webview"),
        ],
      }
    );

    DiffWebviewPanel.currentPanel = new DiffWebviewPanel(
      panel,
      extensionUri,
      repoManager
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    repoManager: RepoManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._repoManager = repoManager;
    this._git = repoManager.git;

    // Set the webview content
    this._panel.webview.html = this._getWebviewContent();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    // Handle disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for repo changes
    this._repoManager.onDidChangeRepos(
      () => this._update(),
      null,
      this._disposables
    );
  }

  private _getWebviewContent(): string {
    const webview = this._panel.webview;
    const distPath = vscode.Uri.joinPath(
      this._extensionUri,
      "dist",
      "webview"
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distPath, "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distPath, "main.css")
    );

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
  <title>Multi-Repo Diff</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async _update(): Promise<void> {
    const selectedPaths = this._repoManager.selectedRepoPaths;
    if (selectedPaths.size === 0) {
      // If nothing is multi-selected, fall back to all repos
      this._panel.webview.postMessage({
        type: "setDiffData",
        repos: [],
      });
      return;
    }

    this._panel.webview.postMessage({ type: "refreshing" });

    const repos = [];

    for (const repoPath of selectedPaths) {
      const repoSummary = this._repoManager.getRepo(repoPath);
      const name = repoSummary?.name ?? path.basename(repoPath);

      try {
        const status: RepoStatus = await this._git.status(repoPath);
        const stagedDiff = await this._git.diff(repoPath, true);
        const unstagedDiff = await this._git.diff(repoPath, false);

        repos.push({
          name,
          path: repoPath,
          branch: status.branch,
          stagedDiff,
          unstagedDiff,
          stagedFiles: status.staged.map((f) => ({
            path: f.path,
            changeType: f.changeType,
            status: "staged" as const,
          })),
          unstagedFiles: status.unstaged.map((f) => ({
            path: f.path,
            changeType: f.changeType,
            status: "unstaged" as const,
          })),
          untrackedFiles: status.untracked.map((f) => ({
            path: f.path,
            changeType: f.changeType,
            status: "untracked" as const,
          })),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Diffchestrator: Error reading ${name}: ${msg}`
        );
      }
    }

    this._panel.webview.postMessage({
      type: "setDiffData",
      repos,
    });
  }

  private async _handleMessage(msg: DiffWebviewMessage): Promise<void> {
    // Validate repoPath against known repos
    const repoPath = "repoPath" in msg ? msg.repoPath : undefined;
    if (repoPath && !this._repoManager.getRepo(repoPath)) {
      return;
    }

    switch (msg.type) {
      case "ready":
        await this._update();
        break;

      case "refresh":
        await this._repoManager.refreshAll();
        await this._update();
        break;

      case "stageFile": {
        await this._git.stage(msg.repoPath, [msg.filePath]);
        await this._repoManager.refreshRepo(msg.repoPath);
        await this._update();
        break;
      }

      case "unstageFile": {
        await this._git.unstage(msg.repoPath, [msg.filePath]);
        await this._repoManager.refreshRepo(msg.repoPath);
        await this._update();
        break;
      }

      case "stageAll": {
        await this._git.stage(msg.repoPath, ["."]);
        await this._repoManager.refreshRepo(msg.repoPath);
        await this._update();
        break;
      }

      case "unstageAll": {
        await this._git.unstage(msg.repoPath, ["."]);
        await this._repoManager.refreshRepo(msg.repoPath);
        await this._update();
        break;
      }

      case "openTerminal": {
        const name = path.basename(msg.repoPath);
        const terminal = vscode.window.createTerminal({
          name: `Terminal - ${name}`,
          cwd: msg.repoPath,
        });
        terminal.show();
        break;
      }

      case "askClaude": {
        const { repoPath: rp, filePath, hunkContent } = msg;
        const repoName = path.basename(rp);

        const terminal = vscode.window.createTerminal({
          name: `Claude Code - ${repoName}`,
          cwd: rp,
        });
        terminal.show();

        // Send claude with context about the hunk
        const prompt = `Explain this change in ${filePath}:\n${hunkContent}`;
        const escaped = escapeForTerminal(prompt);
        terminal.sendText(`claude -p ${escaped}`);
        break;
      }
    }
  }

  dispose(): void {
    DiffWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }
}

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
