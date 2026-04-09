import * as vscode from "vscode";
import * as path from "path";
import { RepoManager } from "../services/repoManager";
import type { CommitEntry, DashboardMessage } from "../types";
import { CMD } from "../constants";
import { showTerminalIfExists, terminalIcon } from "../commands/terminal";

interface DiffStatSummary {
  files: string[];
  additions: number;
  deletions: number;
}

interface StashOverviewEntry {
  repoName: string;
  repoPath: string;
  stashes: { index: number; message: string }[];
}

interface SyncOverviewEntry {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  totalChanges: number;
  stashCount: number;
  isPinned: boolean;
  healthScore: number;
  diffStat?: DiffStatSummary;
}

function computeHealthScore(r: { totalChanges: number; ahead: number; behind: number; stashCount: number }): number {
  const changesPenalty = Math.min(r.totalChanges * 4, 40);
  const syncPenalty = Math.min((r.ahead + r.behind) * 5, 40);
  const stashPenalty = Math.min(r.stashCount * 5, 20);
  return 100 - changesPenalty - syncPenalty - stashPenalty;
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
  stashOverview: StashOverviewEntry[];
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
  private _updateInProgress = false;

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
    if (this._updateThrottleTimer || this._updateInProgress) return;
    this._updateThrottleTimer = setTimeout(async () => {
      this._updateThrottleTimer = undefined;
      if (this._updateInProgress) return;
      this._updateInProgress = true;
      try {
        await this._update();
      } finally {
        this._updateInProgress = false;
      }
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
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const pinnedPaths = new Set(config.get<string[]>("pinnedRepos", []));

    const syncOverview: SyncOverviewEntry[] = repos.map((r) => ({
      name: r.name,
      path: r.path,
      branch: r.branch,
      ahead: r.ahead,
      behind: r.behind,
      totalChanges: r.totalChanges,
      stashCount: r.stashCount,
      isPinned: pinnedPaths.has(r.path),
      healthScore: computeHealthScore(r),
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
        stashOverview: [],
        sessionStartTime: sinceISO,
      } satisfies DashboardPayload,
    });

    // Phase 2: batched git calls
    const BATCH = 10;
    const heatmapEntries: HeatmapEntry[] = [];
    const sessionEntries: SessionSummaryEntry[] = [];
    const activityEntries: ActivityEntry[] = [];
    const stashEntries: StashOverviewEntry[] = [];
    const diffStats = new Map<string, DiffStatSummary>();

    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (r) => {
          try {
            // Single git log call replaces logSinceWithDate + log(3)
            const calls: Promise<unknown>[] = [
              this._git.log(r.path, 50),
            ];
            if (r.totalChanges > 0) {
              calls.push(this._git.diffStatSummary(r.path));
            }
            if (r.stashCount > 0) {
              calls.push(this._git.stashList(r.path));
            }
            const results = await Promise.all(calls);
            const allCommits = results[0] as CommitEntry[];
            let resultIdx = 1;
            if (r.totalChanges > 0) {
              diffStats.set(r.path, results[resultIdx++] as DiffStatSummary);
            }
            if (r.stashCount > 0) {
              const stashes = results[resultIdx] as { index: number; message: string }[];
              if (stashes.length > 0) {
                stashEntries.push({ repoName: r.name, repoPath: r.path, stashes });
              }
            }

            // Derive all dashboard data from single log result
            const lastDate = allCommits.length > 0 ? allCommits[0].date : undefined;
            const sessionCommits = allCommits.filter(
              (c) => new Date(c.date).getTime() >= new Date(sinceISO).getTime()
            );
            const recentCommits = allCommits.slice(0, 3);

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
          } catch (err) {
            console.warn(`[Diffchestrator] Dashboard: failed to fetch data for ${r.name}:`, err);
          }
        })
      );
    }

    // Sort activity by date descending
    activityEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Enrich sync entries with diff stats
    const enrichedSync = syncOverview.map((e) => ({
      ...e,
      diffStat: diffStats.get(e.path),
    }));

    // Send complete data
    this._panel.webview.postMessage({
      type: "dashboardUpdate",
      data: {
        syncOverview: enrichedSync,
        branchMap,
        changeHeatmap: heatmapEntries,
        sessionSummary: sessionEntries,
        activityLog: activityEntries,
        stashOverview: stashEntries,
        sessionStartTime: sinceISO,
      } satisfies DashboardPayload,
    });
  }

  private _isKnownRepo(repoPath: string): boolean {
    return !!this._repoManager.getRepo(repoPath);
  }

  private async _handleMessage(msg: DashboardMessage): Promise<void> {
    // Validate repoPath against known repos for any message that includes one
    const repoPath = "repoPath" in msg ? msg.repoPath : undefined;
    if (repoPath && !this._isKnownRepo(repoPath)) {
      // Allow pin/unpin (path may be in config but not currently scanned)
      if (msg.type !== "pinRepo" && msg.type !== "unpinRepo") {
        return;
      }
    }

    switch (msg.type) {
      case "ready":
        await this._update();
        break;

      case "refresh":
        if (this._updateThrottleTimer) break; // prevent double-refresh
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
        const repoPath = msg.repoPath;
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
        const repoPath = msg.repoPath;
        try {
          await this._git.pull(repoPath);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Pull failed for ${path.basename(repoPath)}: ${errMsg}`);
        }
        break;
      }

      case "pushRepo": {
        const repoPath = msg.repoPath;
        try {
          await this._git.push(repoPath);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
          vscode.window.showInformationMessage(`Diffchestrator: Pushed ${path.basename(repoPath)}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Push failed for ${path.basename(repoPath)}: ${errMsg}`);
        }
        break;
      }

      case "fetchAll": {
        await vscode.commands.executeCommand(CMD.fetchAll);
        await this._update();
        break;
      }

      case "syncAll": {
        await vscode.commands.executeCommand(CMD.syncAll);
        await this._update();
        break;
      }

      case "openTerminal": {
        const repoPath = msg.repoPath;
        if (repoPath) {
          const name = path.basename(repoPath);
          const terminal = vscode.window.createTerminal({
            name,
            cwd: repoPath,
            iconPath: terminalIcon("shell"),
          });
          terminal.show();
        }
        break;
      }

      case "openClaude": {
        const repoPath = msg.repoPath;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.openClaudeCode, { path: repoPath });
        }
        break;
      }

      case "aiCommit": {
        const repoPath = msg.repoPath;
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
        const repoPath = msg.repoPath;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.switchBranch, { path: repoPath });
          await this._update();
        }
        break;
      }

      case "discardAll": {
        const repoPath = msg.repoPath;
        if (repoPath) {
          await vscode.commands.executeCommand(CMD.discardAll, { path: repoPath });
          await this._update();
        }
        break;
      }

      case "commitHistory": {
        const repoPath = msg.repoPath;
        if (repoPath) {
          this._repoManager.selectRepo(repoPath);
          await vscode.commands.executeCommand(CMD.commitHistory, { path: repoPath });
        }
        break;
      }

      case "openRemoteUrl": {
        const repoPath = msg.repoPath;
        if (repoPath) {
          await vscode.commands.executeCommand(CMD.openRemoteUrl, { path: repoPath });
        }
        break;
      }

      case "copyRepoInfo": {
        const repoPath = msg.repoPath;
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

      case "stashPop": {
        const repoPath = msg.repoPath;
        try {
          await this._git.stashPop(repoPath);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Stash pop failed: ${errMsg}`);
        }
        break;
      }

      case "stashApply": {
        const repoPath = msg.repoPath;
        const index = msg.index;
        try {
          await this._git.stashApply(repoPath, index);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Stash apply failed: ${errMsg}`);
        }
        break;
      }

      case "stashDrop": {
        const repoPath = msg.repoPath;
        const index = msg.index;
        try {
          await this._git.stashDrop(repoPath, index);
          await this._repoManager.refreshRepo(repoPath);
          await this._update();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Stash drop failed: ${errMsg}`);
        }
        break;
      }

      case "pinRepo": {
        const repoPath = msg.repoPath;
        const cfg = vscode.workspace.getConfiguration("diffchestrator");
        const pinned = cfg.get<string[]>("pinnedRepos", []);
        if (!pinned.includes(repoPath)) {
          pinned.push(repoPath);
          await cfg.update("pinnedRepos", pinned, vscode.ConfigurationTarget.Global);
        }
        await this._update();
        break;
      }

      case "unpinRepo": {
        const repoPath = msg.repoPath;
        const cfg = vscode.workspace.getConfiguration("diffchestrator");
        const pinned = cfg.get<string[]>("pinnedRepos", []).filter((p) => p !== repoPath);
        await cfg.update("pinnedRepos", pinned, vscode.ConfigurationTarget.Global);
        await this._update();
        break;
      }

      case "exportActivity": {
        const format = msg.format;
        const entries = msg.entries;
        const lines: string[] = ["# Diffchestrator Activity Log", ""];
        const grouped = new Map<string, ActivityEntry[]>();
        for (const e of entries) {
          const day = new Date(e.date).toLocaleDateString(undefined, {
            weekday: "short", month: "short", day: "numeric",
          });
          if (!grouped.has(day)) grouped.set(day, []);
          grouped.get(day)!.push(e);
        }
        for (const [day, commits] of grouped) {
          lines.push(`## ${day}`, "");
          for (const c of commits) {
            lines.push(`- \`${c.shortHash}\` **${c.repoName}** ${c.message} — _${c.author}_`);
          }
          lines.push("");
        }
        const md = lines.join("\n");
        if (format === "clipboard") {
          await vscode.env.clipboard.writeText(md);
          vscode.window.showInformationMessage(`Diffchestrator: ${entries.length} commits copied as Markdown`);
        } else {
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file("activity-log.md"),
            filters: { Markdown: ["md"] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(md, "utf-8"));
            vscode.window.showInformationMessage(`Diffchestrator: Saved to ${uri.fsPath}`);
          }
        }
        break;
      }

      case "getSettings": {
        const cfg = vscode.workspace.getConfiguration("diffchestrator");
        this._panel.webview.postMessage({
          type: "settingsData",
          settings: {
            scanRoots: cfg.get<string[]>("scanRoots", []),
            scanMaxDepth: cfg.get<number>("scanMaxDepth", 6),
            scanExtraSkipDirs: cfg.get<string[]>("scanExtraSkipDirs", []),
            scanOnStartup: cfg.get<boolean>("scanOnStartup", true),
            fetchOnScan: cfg.get<boolean>("fetchOnScan", false),
            autoRefreshInterval: cfg.get<number>("autoRefreshInterval", 10),
            changedOnlyDefault: cfg.get<boolean>("changedOnlyDefault", false),
            showFavorites: cfg.get<boolean>("showFavorites", true),
            showInlineBlame: cfg.get<boolean>("showInlineBlame", true),
            claudePermissionMode: cfg.get<string>("claudePermissionMode", "acceptEdits"),
            autoPushAfterCommit: cfg.get<boolean>("autoPushAfterCommit", false),
            pinnedRepos: cfg.get<string[]>("pinnedRepos", []),
            autoTerminals: cfg.get<string[]>("autoTerminals", []),
          },
        });
        break;
      }

      case "updateSetting": {
        const key = msg.key;
        const value = msg.value;
        const cfg = vscode.workspace.getConfiguration("diffchestrator");
        await cfg.update(key, value, vscode.ConfigurationTarget.Global);
        break;
      }

      case "addScanRootFromSettings": {
        const folders = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: "Select Scan Root",
        });
        if (folders && folders.length > 0) {
          const cfg = vscode.workspace.getConfiguration("diffchestrator");
          const roots = cfg.get<string[]>("scanRoots", []);
          const newRoot = folders[0].fsPath;
          if (!roots.includes(newRoot)) {
            roots.push(newRoot);
            await cfg.update("scanRoots", roots, vscode.ConfigurationTarget.Global);
          }
          // Send updated settings back
          this._panel.webview.postMessage({
            type: "settingsData",
            settings: { ...cfg, scanRoots: roots },
          });
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
