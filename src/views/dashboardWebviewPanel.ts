import * as vscode from "vscode";
import { RepoManager } from "../services/repoManager";
import { showTerminalIfExists } from "../commands/terminal";

interface SyncOverviewEntry {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  totalChanges: number;
}

interface BranchMapEntry {
  name: string;
  path: string;
  branch: string;
  isMainBranch: boolean;
}

interface HeatmapEntry {
  name: string;
  path: string;
  totalChanges: number;
  lastCommitDate: string | undefined;
  daysSinceLastCommit: number | undefined;
}

interface SessionSummaryEntry {
  repoName: string;
  repoPath: string;
  commits: { hash: string; shortHash: string; author: string; date: string; message: string }[];
}

interface DashboardPayload {
  syncOverview: SyncOverviewEntry[];
  branchMap: BranchMapEntry[];
  changeHeatmap: HeatmapEntry[];
  sessionSummary: SessionSummaryEntry[];
  sessionStartTime: string;
}

const MAIN_BRANCHES = new Set(["main", "master", "develop", "development"]);

export class DashboardWebviewPanel {
  public static currentPanel: DashboardWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _repoManager: RepoManager;
  private _git;
  private _sessionStartTime: number;
  private _updateThrottleTimer: ReturnType<typeof setTimeout> | undefined;

  static createOrShow(
    extensionUri: vscode.Uri,
    repoManager: RepoManager,
    sessionStartTime: number
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardWebviewPanel.currentPanel) {
      DashboardWebviewPanel.currentPanel._panel.reveal(column);
      DashboardWebviewPanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "diffchestratorDashboard",
      "Diffchestrator: Dashboard",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "webview-dashboard"),
        ],
      }
    );

    DashboardWebviewPanel.currentPanel = new DashboardWebviewPanel(
      panel,
      extensionUri,
      repoManager,
      sessionStartTime
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    repoManager: RepoManager,
    sessionStartTime: number
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._repoManager = repoManager;
    this._git = repoManager.git;
    this._sessionStartTime = sessionStartTime;

    this._panel.webview.html = this._getWebviewContent();

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Throttled auto-refresh on repo changes
    this._repoManager.onDidChangeRepos(
      () => this._scheduleUpdate(),
      null,
      this._disposables
    );
  }

  private _scheduleUpdate(): void {
    if (this._updateThrottleTimer) return;
    this._updateThrottleTimer = setTimeout(() => {
      this._updateThrottleTimer = undefined;
      this._update();
    }, 2000);
  }

  private _getWebviewContent(): string {
    const webview = this._panel.webview;
    const distPath = vscode.Uri.joinPath(
      this._extensionUri,
      "dist",
      "webview-dashboard"
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
  <title>Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async _update(): Promise<void> {
    const repos = this._repoManager.allRepos;
    const sinceISO = new Date(this._sessionStartTime).toISOString();

    // Phase 1: instant — no git calls
    const syncOverview: SyncOverviewEntry[] = repos.map((r) => ({
      name: r.name,
      path: r.path,
      branch: r.branch,
      ahead: r.ahead,
      behind: r.behind,
      totalChanges: r.totalChanges,
    }));

    const branchMap: BranchMapEntry[] = repos.map((r) => ({
      name: r.name,
      path: r.path,
      branch: r.branch,
      isMainBranch: MAIN_BRANCHES.has(r.branch),
    }));

    // Send phase 1 immediately
    this._panel.webview.postMessage({
      type: "dashboardData",
      data: {
        syncOverview,
        branchMap,
        changeHeatmap: [],
        sessionSummary: [],
        sessionStartTime: sinceISO,
      } satisfies DashboardPayload,
    });

    // Phase 2: batched git calls
    const BATCH = 10;
    const heatmapEntries: HeatmapEntry[] = [];
    const sessionEntries: SessionSummaryEntry[] = [];

    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (r) => {
          try {
            const [lastDate, commits] = await Promise.all([
              this._git.lastCommitDate(r.path),
              this._git.logSince(r.path, sinceISO, 50),
            ]);
            heatmapEntries.push({
              name: r.name,
              path: r.path,
              totalChanges: r.totalChanges,
              lastCommitDate: lastDate,
              daysSinceLastCommit: lastDate
                ? Math.floor(
                    (Date.now() - new Date(lastDate).getTime()) / 86400000
                  )
                : undefined,
            });
            if (commits.length > 0) {
              sessionEntries.push({
                repoName: r.name,
                repoPath: r.path,
                commits,
              });
            }
          } catch {
            // skip repos that fail
          }
        })
      );
    }

    // Send complete data
    this._panel.webview.postMessage({
      type: "dashboardUpdate",
      data: {
        syncOverview,
        branchMap,
        changeHeatmap: heatmapEntries,
        sessionSummary: sessionEntries,
        sessionStartTime: sinceISO,
      } satisfies DashboardPayload,
    });
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this._update();
        break;

      case "refresh":
        await this._repoManager.refreshAll();
        await this._update();
        break;

      case "openRepo": {
        const repoPath = msg.repoPath as string;
        this._repoManager.selectRepo(repoPath);
        await showTerminalIfExists(repoPath);
        break;
      }

      case "openTerminal": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          const name = require("path").basename(repoPath);
          const terminal = vscode.window.createTerminal({
            name: `DC: ${name}`,
            cwd: repoPath,
          });
          terminal.show();
        }
        break;
      }
    }
  }

  dispose(): void {
    DashboardWebviewPanel.currentPanel = undefined;
    if (this._updateThrottleTimer) {
      clearTimeout(this._updateThrottleTimer);
    }
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
