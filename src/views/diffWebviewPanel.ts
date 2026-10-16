import * as vscode from "vscode";
import * as path from "path";
import { RepoManager } from "../services/repoManager";
import { getNonce } from "./nonce";
import type { RepoStatus, DiffWebviewMessage } from "../types";
import { escapeForTerminal } from "../utils/shell";
import { terminalIcon } from "../commands/terminal";
import { buildAskClaudePrompt, MAX_ASK_CLAUDE_HUNK_INPUT } from "./askClaudePrompt";

// Message types that must carry a valid repoPath (rejected when it's missing).
const REPO_SCOPED = new Set<string>([
  "stageFile", "unstageFile", "stageAll", "unstageAll", "openTerminal", "askClaude",
  "getFileDiff",
]);

/** Debounce for change-event driven refreshes. */
const UPDATE_DEBOUNCE_MS = 300;
/** Per-file diffs above this many lines are only sent after an explicit "load anyway". */
const LARGE_DIFF_LINES = 5000;
/** Hard cap on a single file diff posted to the webview, even when forced. */
const MAX_FILE_DIFF_CHARS = 5_000_000;

export class DiffWebviewPanel {
  public static currentPanel: DiffWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _repoManager: RepoManager;
  private _git;
  private _disposed = false;
  /** Bumped on every _update; stale runs never post. */
  private _generation = 0;
  private _updateTimer: ReturnType<typeof setTimeout> | undefined;
  private _pendingWhileHidden = false;
  /** Fingerprint of the selection + selected repos' summaries last posted. */
  private _lastFingerprint: string | undefined;

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
      DiffWebviewPanel.currentPanel._scheduleUpdate(0);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "diffchestratorDiff",
      "Diffchestrator: Multi-Repo Diff",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        // No retainContextWhenHidden: the webview posts "ready" on mount and
        // the panel refetches, so only expand state is lost — not worth
        // holding the full diff DOM in memory while hidden.
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

    // Repo summaries changed (any repo) — only refresh when the selected
    // repos' summaries actually differ from what we last posted.
    this._repoManager.onDidChangeRepos(
      () => {
        if (this._fingerprint() !== this._lastFingerprint) this._scheduleUpdate();
      },
      null,
      this._disposables
    );

    // Selection changes fire a separate event — without this, deselected
    // repos lingered until some unrelated repo change.
    this._repoManager.onDidChangeSelection(
      () => {
        if (this._fingerprint() !== this._lastFingerprint) this._scheduleUpdate();
      },
      null,
      this._disposables
    );

    // Skip work while hidden; catch up once when shown again.
    this._panel.onDidChangeViewState(
      () => {
        if (this._disposed) return;
        if (this._panel.visible && this._pendingWhileHidden) {
          this._pendingWhileHidden = false;
          this._scheduleUpdate(0);
        }
      },
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

  /** Selection + the summary fields refreshRepo compares, for the selected repos. */
  private _fingerprint(): string {
    const parts: string[] = [];
    for (const p of [...this._repoManager.selectedRepoPaths].sort()) {
      const r = this._repoManager.getRepo(p);
      parts.push(
        r
          ? [p, r.branch, r.headOid, r.stagedCount, r.unstagedCount, r.untrackedCount].join("\0")
          : p
      );
    }
    return parts.join("\n");
  }

  private _scheduleUpdate(delay = UPDATE_DEBOUNCE_MS): void {
    if (this._disposed) return;
    if (!this._panel.visible) {
      this._pendingWhileHidden = true;
      return;
    }
    if (this._updateTimer) clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => {
      this._updateTimer = undefined;
      void this._update();
    }, delay);
  }

  private async _update(): Promise<void> {
    if (this._disposed) return;
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = undefined;
    }
    if (!this._panel.visible) {
      this._pendingWhileHidden = true;
      return;
    }
    const generation = ++this._generation;
    const fingerprint = this._fingerprint();
    const selectedPaths = [...this._repoManager.selectedRepoPaths];
    if (selectedPaths.length === 0) {
      this._lastFingerprint = fingerprint;
      this._panel.webview.postMessage({
        type: "setDiffData",
        repos: [],
        noSelection: true,
      });
      return;
    }

    this._panel.webview.postMessage({ type: "refreshing" });

    // Status only — file diffs are fetched lazily per file on expand
    // (getFileDiff), so a large working tree no longer posts and parses every
    // staged + unstaged diff up front.
    const results = await Promise.all(
      selectedPaths.map(async (repoPath) => {
        const repoSummary = this._repoManager.getRepo(repoPath);
        const name = repoSummary?.name ?? path.basename(repoPath);

        try {
          const status: RepoStatus = await this._git.status(repoPath);
          return {
            name,
            path: repoPath,
            branch: status.branch,
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
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!this._disposed && generation === this._generation) {
            vscode.window.showErrorMessage(
              `Diffchestrator: Error reading ${name}: ${msg}`
            );
          }
          return undefined;
        }
      })
    );
    const repos = results.filter((r) => r !== undefined);

    // A newer update started while we awaited — its data wins.
    if (this._disposed || generation !== this._generation) return;
    this._lastFingerprint = fingerprint;
    this._panel.webview.postMessage({
      type: "setDiffData",
      repos,
      noSelection: false,
    });
  }

  private async _postFileDiff(
    msg: Extract<DiffWebviewMessage, { type: "getFileDiff" }>
  ): Promise<void> {
    const { requestId, repoPath, filePath } = msg;
    if (!Number.isInteger(requestId)) return;
    const reply = (payload: Record<string, unknown>) => {
      if (!this._disposed) {
        this._panel.webview.postMessage({ type: "fileDiff", requestId, ...payload });
      }
    };
    if (typeof filePath !== "string" || filePath === "" || filePath.length > 4096) {
      reply({ error: "Invalid file path" });
      return;
    }
    try {
      let diff = await this._git.diff(repoPath, msg.staged === true, filePath);
      let lineCount = 0;
      for (let i = diff.indexOf("\n"); i !== -1; i = diff.indexOf("\n", i + 1)) lineCount++;
      if (lineCount > LARGE_DIFF_LINES && msg.force !== true) {
        reply({ tooLarge: true, lineCount });
        return;
      }
      let truncated = false;
      if (diff.length > MAX_FILE_DIFF_CHARS) {
        // Cut at a line boundary so the parser sees whole lines.
        const cut = diff.lastIndexOf("\n", MAX_FILE_DIFF_CHARS);
        diff = diff.slice(0, cut > 0 ? cut + 1 : MAX_FILE_DIFF_CHARS);
        truncated = true;
      }
      reply({ diff, lineCount, truncated });
    } catch (err: unknown) {
      reply({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async _runRepoOp(repoPath: string, label: string, op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        `Diffchestrator: ${label} failed for ${path.basename(repoPath)}: ${errMsg}`
      );
    }
    await this._repoManager.refreshRepo(repoPath);
    await this._update();
  }

  private async _handleMessage(msg: DiffWebviewMessage): Promise<void> {
    if (this._disposed) return;
    if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") {
      return;
    }
    // Every repo-scoped message must carry a non-empty string repoPath that
    // names a known repo — never fall through with undefined/"" (e.g.
    // path.basename(undefined) throws).
    if ("repoPath" in msg || REPO_SCOPED.has(msg.type)) {
      const repoPath: unknown = (msg as { repoPath?: unknown }).repoPath;
      if (typeof repoPath !== "string" || repoPath === "" || !this._repoManager.getRepo(repoPath)) {
        return;
      }
    }

    switch (msg.type) {
      case "ready":
        await this._update();
        break;

      case "refresh":
        try {
          await this._repoManager.refreshAll();
        } finally {
          // Always answer so the webview's refresh indicator clears.
          await this._update();
        }
        break;

      case "getFileDiff":
        await this._postFileDiff(msg);
        break;

      case "stageFile": {
        if (typeof msg.filePath !== "string" || msg.filePath === "") break;
        const { repoPath, filePath } = msg;
        await this._runRepoOp(repoPath, "Stage", () => this._git.stage(repoPath, [filePath]));
        break;
      }

      case "unstageFile": {
        if (typeof msg.filePath !== "string" || msg.filePath === "") break;
        const { repoPath, filePath } = msg;
        await this._runRepoOp(repoPath, "Unstage", () => this._git.unstage(repoPath, [filePath]));
        break;
      }

      case "stageAll": {
        const { repoPath } = msg;
        await this._runRepoOp(repoPath, "Stage all", () => this._git.stage(repoPath, ["."]));
        break;
      }

      case "unstageAll": {
        const { repoPath } = msg;
        await this._runRepoOp(repoPath, "Unstage all", () => this._git.unstage(repoPath, ["."]));
        break;
      }

      case "openTerminal": {
        const name = path.basename(msg.repoPath);
        const terminal = vscode.window.createTerminal({
          name,
          cwd: msg.repoPath,
          iconPath: terminalIcon("shell"),
        });
        terminal.show();
        break;
      }

      case "askClaude": {
        const { repoPath: rp, filePath, hunkContent } = msg;
        if (
          typeof filePath !== "string" || filePath === "" || filePath.length > 4096 ||
          typeof hunkContent !== "string" || hunkContent.length > MAX_ASK_CLAUDE_HUNK_INPUT
        ) {
          break;
        }
        const repoName = path.basename(rp);

        const terminal = vscode.window.createTerminal({
          name: repoName,
          cwd: rp,
          iconPath: terminalIcon("claude"),
        });
        terminal.show();

        // Single-line, length-capped prompt: raw newlines in sendText would
        // submit the command early and run the remaining diff lines as shell
        // input.
        const prompt = buildAskClaudePrompt(filePath, hunkContent);
        const escaped = escapeForTerminal(prompt);
        terminal.sendText(`claude -p ${escaped}`);
        break;
      }
    }
  }

  dispose(): void {
    this._disposed = true;
    DiffWebviewPanel.currentPanel = undefined;
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = undefined;
    }
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }
}
