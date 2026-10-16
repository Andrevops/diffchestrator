import * as vscode from "vscode";
import * as path from "path";
import { RepoManager } from "./services/repoManager";
import { RepoTreeProvider } from "./providers/repoTreeProvider";
import { ChangedFilesProvider } from "./providers/changedFilesProvider";
import { CMD, CONFIG, CTX, VIEW_ACTIVE_REPOS, VIEW_REPOS, VIEW_CHANGED_FILES } from "./constants";
import { registerScanCommands } from "./commands/scan";
import { registerStageCommands } from "./commands/stage";
import { registerCommitCommands } from "./commands/commit";
import { registerPushCommands } from "./commands/push";
import { registerPullCommands } from "./commands/pull";
import { registerAiCommitCommands } from "./commands/aiCommit";
import { registerClaudeCommands } from "./commands/openClaude";
import { registerFavoriteCommands } from "./commands/favorites";
import { registerFileSearchCommand } from "./commands/fileSearch";
import { registerTerminalCommand, adoptExistingTerminals } from "./commands/terminal";
import { registerTerminalFocus, TerminalSwitchGuard } from "./commands/terminalFocus";
import { registerNavigationCommands } from "./commands/navigation";
import { registerCommitHistoryCommands } from "./commands/commitHistory";
import { registerDiscardCommands } from "./commands/discard";
import { registerSwitchBranchCommands } from "./commands/switchBranch";
import { registerStashCommands } from "./commands/stash";
import { registerResolveConflictsCommand } from "./commands/resolveConflicts";
import { registerScanRootCommands } from "./commands/scanRoots";
import { registerBulkSyncCommands } from "./commands/bulkSync";
import { registerRepoInfoCommands } from "./commands/repoInfo";
import { registerTagCommands } from "./commands/tags";
import { registerSnapshotCommands } from "./commands/snapshots";
import { registerFileOpsCommands } from "./commands/fileOps";
import { registerNotifications } from "./services/notifications";
import { EditorSessions } from "./services/editorSessions";
import { ActiveReposProvider } from "./providers/activeReposProvider";
import { RepoFilesProvider } from "./providers/repoFilesProvider";
import { RepoFilesDecorationProvider } from "./providers/repoFilesDecorationProvider";
import { GitContentProvider } from "./providers/gitContentProvider";
import { DiffWebviewPanel } from "./views/diffWebviewPanel";
import { DashboardWebviewPanel } from "./views/dashboardWebviewPanel";
import { FileWatcher } from "./services/fileWatcher";
import { InlineBlameService } from "./services/inlineBlame";
import { WorkspaceAutoScan } from "./services/workspaceAutoScan";
import { extractTabUri } from "./types";

/** Public API for sibling extensions (e.g. Epic Lens) */
export interface DiffchestratorApi {
  /** Currently active scan root (e.g. /home/user/RealManage) */
  getCurrentRoot(): string | undefined;
  /** Currently selected repo path */
  getSelectedRepo(): string | undefined;
  /** Fires when the active root or selection changes */
  onDidChangeSelection: vscode.Event<void>;
}

export function activate(context: vscode.ExtensionContext): DiffchestratorApi {
  // Verify git is on PATH in the background — don't block activation.
  // If git is genuinely missing, ops will fail with their own errors; this
  // banner is a courtesy so the user knows why.
  const { execFile } = require("child_process");
  execFile("git", ["--version"], { timeout: 5000 }, (err: Error | null) => {
    if (!err) return;
    vscode.window.showErrorMessage(
      "Diffchestrator: Git is not installed or not on PATH. The extension requires git to function.",
      "Install Git"
    ).then((action) => {
      if (action === "Install Git") {
        vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"));
      }
    });
  });

  const sessionStartTime = Date.now();
  const repoManager = new RepoManager(context.workspaceState);
  context.subscriptions.push(repoManager);

  // Shared output channel for logging
  const outputChannel = vscode.window.createOutputChannel("Diffchestrator");
  context.subscriptions.push(outputChannel);
  repoManager.setLogger((msg) => outputChannel.appendLine(msg));

  // Per-repo editor state (last open file + tab sessions) for repo switching
  const sessions = new EditorSessions(repoManager, (msg) => outputChannel.appendLine(msg));
  context.subscriptions.push(sessions);

  // Terminal tab click → repo switch, plus terminal cycle/close/navigation
  const terminalGuard = new TerminalSwitchGuard();
  registerTerminalFocus(context, repoManager, terminalGuard);

  // Tree views
  const activeRepos = new ActiveReposProvider(repoManager);
  context.subscriptions.push(activeRepos);
  const repoTree = new RepoTreeProvider(repoManager);
  context.subscriptions.push(repoTree);
  const changedFiles = new ChangedFilesProvider(repoManager);
  context.subscriptions.push(changedFiles);
  const repoFiles = new RepoFilesProvider(repoManager);
  context.subscriptions.push(repoFiles);

  // Git content provider for diff URIs
  const gitContentProvider = new GitContentProvider(repoManager.git);
  // Create tree views (not just providers) so we can set description + badge
  const activeReposView = vscode.window.createTreeView(VIEW_ACTIVE_REPOS, { treeDataProvider: activeRepos });
  const repoTreeView = vscode.window.createTreeView(VIEW_REPOS, { treeDataProvider: repoTree });
  const changedFilesView = vscode.window.createTreeView(VIEW_CHANGED_FILES, { treeDataProvider: changedFiles });
  const repoFilesView = vscode.window.createTreeView("diffchestrator.repoFiles", {
    treeDataProvider: repoFiles,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: repoFiles,
  });
  context.subscriptions.push(new RepoFilesDecorationProvider(repoFiles));

  // Keep the Repo Files view's title in sync with the selected repo so it's
  // always clear which tree you're looking at.
  const updateRepoFilesTitle = () => {
    const rp = repoManager.selectedRepo;
    repoFilesView.message = rp ? rp : undefined;
    repoFilesView.description = rp ? path.basename(rp) : undefined;
  };
  updateRepoFilesTitle();
  context.subscriptions.push(repoManager.onDidChangeSelection(updateRepoFilesTitle));

  // Follow the active editor in the Files tree (like Explorer's autoReveal),
  // but only while the view is already visible — reveal() would otherwise
  // force the Diffchestrator container open on every editor switch.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor || !repoFilesView.visible) return;
      if (!vscode.workspace.getConfiguration().get<boolean>(CONFIG.filesAutoReveal, true)) return;
      const root = repoManager.selectedRepo;
      const uri = editor.document.uri;
      if (!root || uri.scheme !== "file") return;
      if (!uri.fsPath.startsWith(root + path.sep)) return;
      const node = repoFiles.nodeForPath(uri.fsPath);
      if (!node) return;
      try {
        await repoFilesView.reveal(node, { select: true, focus: false, expand: true });
      } catch {
        /* best-effort — never break editor switching */
      }
    }),
  );

  // Track whether diffchestrator sidebar is actively visible (not just existing)
  let sidebarVisible = false;
  context.subscriptions.push(
    changedFilesView.onDidChangeVisibility((e) => { sidebarVisible = e.visible; }),
    activeReposView.onDidChangeVisibility((e) => { if (e.visible) sidebarVisible = true; }),
    repoTreeView.onDidChangeVisibility((e) => { if (e.visible) sidebarVisible = true; }),
  );

  // Adaptive auto-refresh: tell repoManager whether ANY Diffchestrator tree
  // view is visible (per-view booleans — `sidebarVisible` above is a latch
  // for a different purpose). When nothing is visible, the auto-refresh
  // timer slows down; the dashboard panel reports its own visibility.
  const treeViewVis = {
    activeRepos: activeReposView.visible,
    repoTree: repoTreeView.visible,
    changedFiles: changedFilesView.visible,
    repoFiles: repoFilesView.visible,
  };
  const updateTreeViewsVisible = () => {
    repoManager.setTreeViewsVisible(
      treeViewVis.activeRepos || treeViewVis.repoTree || treeViewVis.changedFiles || treeViewVis.repoFiles
    );
  };
  context.subscriptions.push(
    activeReposView.onDidChangeVisibility((e) => { treeViewVis.activeRepos = e.visible; updateTreeViewsVisible(); }),
    repoTreeView.onDidChangeVisibility((e) => { treeViewVis.repoTree = e.visible; updateTreeViewsVisible(); }),
    changedFilesView.onDidChangeVisibility((e) => { treeViewVis.changedFiles = e.visible; updateTreeViewsVisible(); }),
    repoFilesView.onDidChangeVisibility((e) => {
      treeViewVis.repoFiles = e.visible;
      updateTreeViewsVisible();
      // Files-view watcher is deferred until the view is first shown
      if (e.visible) repoFiles.ensureWatching();
    }),
  );
  updateTreeViewsVisible();
  if (repoFilesView.visible) repoFiles.ensureWatching();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("git-show", gitContentProvider),
    gitContentProvider,
    activeReposView,
    repoTreeView,
    changedFilesView,
    repoFilesView,
  );

  // Refresh git content provider when repos change (invalidates stale diffs)
  // Also close diff tabs for files that are no longer changed
  context.subscriptions.push(repoManager.onDidChangeRepos(async () => {
    try {
      gitContentProvider.refresh();

      // Close stale diff tabs for the selected repo
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const repo = repoManager.getRepo(repoPath);
      if (!repo || repo.totalChanges > 0) return; // still has changes, don't close

      // Repo is clean — close any open git-show tabs for it
      const tabsToClose: vscode.Tab[] = [];
      for (const tab of vscode.window.tabGroups.all.flatMap((g) => g.tabs)) {
        const uri = extractTabUri(tab.input);
        if (uri?.scheme === "git-show") {
          try {
            const params = JSON.parse(uri.query);
            if (params.repoPath === repoPath) {
              tabsToClose.push(tab);
            }
          } catch { /* ignore */ }
        }
      }
      if (tabsToClose.length > 0) {
        await vscode.window.tabGroups.close(tabsToClose);
      }
    } catch (err) {
      // Async event handler — never let a rejection float unhandled
      outputChannel.appendLine(`[stale tab close] ${err instanceof Error ? err.message : err}`);
    }
  }));

  // Update view descriptions + badge when state changes
  const updateViewInfo = () => {
    const repos = repoManager.repos;
    const totalChanges = repos.reduce((sum, r) => sum + r.totalChanges, 0);

    // Repos view: show root name + count
    const rootName = repoManager.currentRoot ? path.basename(repoManager.currentRoot) : "";
    const countLabel = repoManager.changedOnly
      ? `${repos.filter(r => r.totalChanges > 0).length} changed`
      : `${repos.length} repos`;
    const tagLabel = repoManager.activeTagFilter ? `#${repoManager.activeTagFilter}` : "";
    const descParts = [rootName, tagLabel, countLabel].filter(Boolean);
    repoTreeView.description = descParts.join(" — ");

    // Active Repos view: show root name + summary
    const activeDesc = [rootName, `${repos.length} repos`, totalChanges > 0 ? `${totalChanges} changes` : ""].filter(Boolean);
    activeReposView.description = activeDesc.join(" · ") || undefined;

    // Activity bar badge: total changes across all repos
    repoTreeView.badge = totalChanges > 0
      ? { value: totalChanges, tooltip: `${totalChanges} total changes` }
      : undefined;

    // Changed files view: show active repo name + branch
    const selected = repoManager.selectedRepo;
    if (selected) {
      const repo = repos.find(r => r.path === selected);
      const name = selected.split("/").pop() ?? "";
      const branch = repo?.branch ?? "";
      const changes = repo?.totalChanges ?? 0;
      changedFilesView.description = `${name} (${branch})${changes > 0 ? ` — ${changes} changes` : ""}`;
    } else {
      changedFilesView.description = undefined;
    }
  };

  context.subscriptions.push(
    repoManager.onDidChangeRepos(updateViewInfo),
    repoManager.onDidChangeSelection(updateViewInfo),
  );

  // Notifications when Claude/external tools commit or modify files
  // Queue notifications when unfocused, show grouped summary on refocus
  registerNotifications(context, repoManager, outputChannel);

  // Register command modules
  // File watcher — created before commands so switchRoot can reference it
  const fileWatcher = new FileWatcher(repoManager);
  repoManager.fileWatcher = fileWatcher;
  context.subscriptions.push(fileWatcher);

  registerScanCommands(context, repoManager);
  registerStageCommands(context, repoManager);
  registerCommitCommands(context, repoManager, outputChannel);
  registerPushCommands(context, repoManager, outputChannel);
  registerPullCommands(context, repoManager, outputChannel);
  registerAiCommitCommands(context, repoManager);
  registerClaudeCommands(context, repoManager);
  registerFavoriteCommands(context, repoManager);
  registerFileSearchCommand(context, repoManager);
  registerTerminalCommand(context, repoManager);
  registerCommitHistoryCommands(context, repoManager);
  registerDiscardCommands(context, repoManager);
  registerSwitchBranchCommands(context, repoManager);
  registerResolveConflictsCommand(context, repoManager);
  registerStashCommands(context, repoManager);

  registerScanRootCommands(context, repoManager, fileWatcher);
  registerBulkSyncCommands(context, repoManager, outputChannel);
  registerRepoInfoCommands(context, repoManager);
  registerTagCommands(context, repoManager);
  registerSnapshotCommands(context, repoManager, fileWatcher);

  // viewDiff, active-repo cycling/swap/close, changed-file stepping, multi-select
  registerNavigationCommands(context, {
    repoManager,
    outputChannel,
    sessions,
    fileWatcher,
    terminalGuard,
    isSidebarVisible: () => sidebarVisible,
    refreshViewInfo: updateViewInfo,
  });

  // Toggle changed only
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleChangedOnly, () =>
      repoManager.toggleChangedOnly()
    )
  );

  // Toggle favorites visibility in Active Repos (two commands for icon swap)
  const updateFavContext = () => {
    const show = vscode.workspace.getConfiguration().get<boolean>(CONFIG.showFavorites, true);
    vscode.commands.executeCommand("setContext", CTX.showFavorites, show);
  };
  updateFavContext();

  const toggleFavHandler = async () => {
    const config = vscode.workspace.getConfiguration();
    const current = config.get<boolean>(CONFIG.showFavorites, true);
    await config.update(CONFIG.showFavorites, !current, vscode.ConfigurationTarget.Global);
    updateFavContext();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleShowFavorites, toggleFavHandler),
    vscode.commands.registerCommand(CMD.toggleShowFavoritesOff, toggleFavHandler)
  );

  // View multi-repo diff — opens webview panel with aggregated diffs
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.viewMultiRepoDiff, () => {
      DiffWebviewPanel.createOrShow(context.extensionUri, repoManager);
    })
  );

  // Dashboard webview
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.dashboard, () => {
      DashboardWebviewPanel.createOrShow(context.extensionUri, repoManager, sessionStartTime);
    })
  );

  registerFileOpsCommands(context, repoManager);

  // Phase 5: File watcher already created above (before command registrations)

  // Phase 6: Inline blame — git blame on current line
  const inlineBlame = new InlineBlameService(repoManager);
  context.subscriptions.push(inlineBlame);

  // Phase 8: Auto-scan workspace folders
  const workspaceAutoScan = new WorkspaceAutoScan(repoManager, fileWatcher);
  context.subscriptions.push(workspaceAutoScan);

  // Auto-scan on startup — resume last root if available, otherwise use first configured root
  const config = vscode.workspace.getConfiguration();
  if (config.get<boolean>(CONFIG.scanOnStartup, true)) {
    const roots = config.get<string[]>(CONFIG.scanRoots, []);
    const lastRoot = repoManager.currentRoot;
    const startupRoot = lastRoot && roots.includes(lastRoot) ? lastRoot : roots[0];
    if (startupRoot) {
      repoManager.scan(startupRoot).then(() => {
        fileWatcher.watchAll();
        adoptExistingTerminals([...repoManager.allRepos.map((r) => r.path), ...repoManager.directoryPaths]);
      }).catch((err) => {
        outputChannel.appendLine(`[startup scan] ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  // Onboarding: show walkthrough on first run if no scan roots configured
  const wasOnboarded = context.globalState.get<boolean>("diffchestrator.onboarded", false);
  if (!wasOnboarded) {
    const roots = vscode.workspace.getConfiguration().get<string[]>(CONFIG.scanRoots, []);
    if (roots.length === 0) {
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "andrevops-com.diffchestrator#diffchestrator.welcome",
        false
      );
    }
    context.globalState.update("diffchestrator.onboarded", true);
  }

  // Public API for sibling extensions
  return {
    getCurrentRoot: () => repoManager.currentRoot,
    getSelectedRepo: () => repoManager.selectedRepo,
    onDidChangeSelection: repoManager.onDidChangeSelection,
  };
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
