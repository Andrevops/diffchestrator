import * as vscode from "vscode";
import { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { showTerminalIfExists } from "../commands/terminal";

interface SyncOverviewEntry {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  totalChanges: number;
  stashCount: number;
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

interface ActivityEntry {
  repoName: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

interface DashboardPayload {
  syncOverview: SyncOverviewEntry[];
  branchMap: BranchMapEntry[];
  changeHeatmap: HeatmapEntry[];
  sessionSummary: SessionSummaryEntry[];
  activityLog: ActivityEntry[];
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
      stashCount: r.stashCount,
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
        activityLog: [],
        sessionStartTime: sinceISO,
      } satisfies DashboardPayload,
    });

    // Phase 2: batched git calls
    const BATCH = 10;
    const heatmapEntries: HeatmapEntry[] = [];
    const sessionEntries: SessionSummaryEntry[] = [];
    const activityEntries: ActivityEntry[] = [];

    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (r) => {
          try {
            const [lastDate, sessionCommits, recentCommits] = await Promise.all([
              this._git.lastCommitDate(r.path),
              this._git.logSince(r.path, sinceISO, 50),
              this._git.log(r.path, 3),
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
            if (sessionCommits.length > 0) {
              sessionEntries.push({
                repoName: r.name,
                repoPath: r.path,
                commits: sessionCommits,
              });
            }
            for (const c of recentCommits) {
              activityEntries.push({
                repoName: r.name,
                shortHash: c.shortHash,
                author: c.author,
                date: c.date,
                message: c.message,
              });
            }
          } catch {
            // skip repos that fail
          }
        })
      );
    }

    // Sort activity by date descending
    activityEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Send complete data
    this._panel.webview.postMessage({
      type: "dashboardUpdate",
      data: {
        syncOverview,
        branchMap,
        changeHeatmap: heatmapEntries,
        sessionSummary: sessionEntries,
        activityLog: activityEntries,
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

      case "scan":
        await vscode.commands.executeCommand(CMD.rescan);
        await this._update();
        break;

      case "bulkPush":
        await vscode.commands.executeCommand(CMD.bulkPush);
        await this._update();
        break;

      case "branchCleanup":
        await vscode.commands.executeCommand(CMD.branchCleanup);
        break;

      case "openRepo": {
        const repoPath = msg.repoPath as string;
        this._repoManager.selectRepo(repoPath);
        await showTerminalIfExists(repoPath);
        break;
      }

      case "pullAll": {
        await vscode.commands.executeCommand(CMD.bulkPull);
        await this._update();
        break;
      }

      case "pullRepo": {
        const repoPath = msg.repoPath as string;
        try {
          await this._git.pull(repoPath);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Pull failed for ${require("path").basename(repoPath)}: ${errMsg}`);
        }
        break;
      }

      case "pushRepo": {
        const repoPath = msg.repoPath as string;
        try {
          await this._git.push(repoPath);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
          vscode.window.showInformationMessage(`Diffchestrator: Pushed ${require("path").basename(repoPath)}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Push failed for ${require("path").basename(repoPath)}: ${errMsg}`);
        }
        break;
      }

      case "fetchAll": {
        await vscode.commands.executeCommand(CMD.fetchAll);
        await this._update();
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

      case "openClaude": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.openClaudeCode, { path: repoPath });
        }
        break;
      }

      case "aiCommit": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.aiCommit, { path: repoPath });
        }
        break;
      }

      case "switchRoot":
        await vscode.commands.executeCommand(CMD.switchRoot);
        await this._update();
        break;

      case "switchBranch": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.switchBranch, { path: repoPath });
          await this._update();
        }
        break;
      }

      case "discardAll": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          await vscode.commands.executeCommand(CMD.discardAll, { path: repoPath });
          await this._update();
        }
        break;
      }

      case "commitHistory": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.commitHistory, { path: repoPath });
        }
        break;
      }

      case "openRemoteUrl": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          await vscode.commands.executeCommand(CMD.openRemoteUrl, { path: repoPath });
        }
        break;
      }

      case "copyRepoInfo": {
        const repoPath = msg.repoPath as string;
        if (repoPath) {
          await vscode.commands.executeCommand(CMD.copyRepoInfo, { path: repoPath });
        }
        break;
      }

      case "saveSnapshot":
        await vscode.commands.executeCommand(CMD.saveSnapshot);
        break;

      case "loadSnapshot":
        await vscode.commands.executeCommand(CMD.loadSnapshot);
        await this._update();
        break;

      case "claudeReviewAll":
        await vscode.commands.executeCommand(CMD.claudeReviewAll);
        break;

      case "filterByTag":
        await vscode.commands.executeCommand(CMD.filterByTag);
        await this._update();
        break;
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
