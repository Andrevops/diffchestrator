import * as vscode from "vscode";
import { RepoManager } from "./services/repoManager";
import { RepoTreeProvider } from "./providers/repoTreeProvider";
import { ChangedFilesProvider } from "./providers/changedFilesProvider";
import { CMD, CONFIG, VIEW_ACTIVE_REPOS, VIEW_REPOS, VIEW_CHANGED_FILES } from "./constants";
import { registerScanCommands } from "./commands/scan";
import { registerStageCommands, openFileDiff } from "./commands/stage";
import { registerCommitCommands } from "./commands/commit";
import { registerPushCommands } from "./commands/push";
import { registerPullCommands } from "./commands/pull";
import { registerAiCommitCommands } from "./commands/aiCommit";
import { registerClaudeCommands } from "./commands/openClaude";
import { registerFavoriteCommands } from "./commands/favorites";
import { registerFileSearchCommand } from "./commands/fileSearch";
import { registerTerminalCommand } from "./commands/terminal";
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
import { ActiveReposProvider } from "./providers/activeReposProvider";
import { RepoFilesProvider } from "./providers/repoFilesProvider";
import { RepoFilesDecorationProvider } from "./providers/repoFilesDecorationProvider";
import { GitContentProvider } from "./providers/gitContentProvider";
import { DiffWebviewPanel } from "./views/diffWebviewPanel";
import { DashboardWebviewPanel } from "./views/dashboardWebviewPanel";
import { FileWatcher } from "./services/fileWatcher";
import { InlineBlameService } from "./services/inlineBlame";
import { WorkspaceAutoScan } from "./services/workspaceAutoScan";
// GitExecutor accessed via repoManager.git (shared instance)
import { showTerminalIfExists, findRepoForTerminal, cycleTerminal, closeRepoTerminal, navigateTerminal, adoptExistingTerminals, getRepoTerminal } from "./commands/terminal";
import type { TerminalKind } from "./commands/terminal";
import { extractTabUri } from "./types";
import { resolveRepoPath } from "./utils/fileItem";
import * as path from "path";

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

  // Track last open file per repo so switching back restores context (LRU, max 20)
  const MAX_LAST_OPEN = 20;
  const lastOpenFile = new Map<string, vscode.Uri>();
  const capLastOpenFile = () => {
    while (lastOpenFile.size > MAX_LAST_OPEN) {
      const oldest = lastOpenFile.keys().next().value!;
      lastOpenFile.delete(oldest);
    }
  };
  let switchingRepo = false; // flag to ignore editor changes during repo switch

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (switchingRepo) return; // ignore changes caused by repo switch
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;

      if (!editor) {
        // All editors closed while user is in this repo — clear memory
        lastOpenFile.delete(repoPath);
        return;
      }

      const uri = editor.document.uri;
      // Trailing separator so /x/foo doesn't match /x/foo-bar
      if (
        uri.scheme === "file" &&
        (uri.fsPath === repoPath || uri.fsPath.startsWith(repoPath + path.sep))
      ) {
        lastOpenFile.delete(repoPath); // re-insert at end for LRU
        lastOpenFile.set(repoPath, uri);
        capLastOpenFile();
      } else if (uri.scheme === "git-show") {
        lastOpenFile.delete(repoPath);
        lastOpenFile.set(repoPath, uri);
        capLastOpenFile();
      }
    })
  );

  // When user clicks a terminal tab, switch to that repo (full viewDiff flow).
  // If the terminal belongs to a repo in a different root, switch roots first.
  //
  // Rapid-click race: viewDiff/switchRoot are async; a naive handler either
  // drops clicks while one is in-flight (early return on a busy flag) or
  // interleaves N concurrent handlers so the winner is nondeterministic.
  // Instead, queue the latest clicked terminal and run a single worker that
  // re-reads the queue after each await, so the user's LAST click always wins.
  let suppressTerminalSwitch = false;
  let queuedTerminal: vscode.Terminal | undefined;
  let clickWorkerRunning = false;

  const runClickWorker = async () => {
    if (clickWorkerRunning) return;
    clickWorkerRunning = true;
    try {
      while (queuedTerminal) {
        const terminal = queuedTerminal;
        queuedTerminal = undefined;

        const allPaths = [...repoManager.repos.map((r) => r.path), ...repoManager.directoryPaths];
        const currentRootPaths = new Set(allPaths);
        const repoPath = findRepoForTerminal(terminal, allPaths);

        // Only trust the match if the path belongs to the current root —
        // the tracking map can return stale paths from a previous root.
        if (repoPath && currentRootPaths.has(repoPath)) {
          if (repoPath !== repoManager.selectedRepo) {
            suppressTerminalSwitch = true;
            try {
              await vscode.commands.executeCommand(CMD.viewDiff, { path: repoPath, preserveFocus: true });
            } finally {
              suppressTerminalSwitch = false;
            }
            // viewDiff closes the previous repo's editor tabs, and tab-close
            // shifts focus to the editor group even though we open files with
            // preserveFocus. Restore focus to the terminal the user clicked.
            terminal.show(false);
          }
          continue;
        }

        // No valid match in current root — search other configured roots
        const match = await repoManager.findRepoInOtherRoots(terminal.name);
        if (match) {
          suppressTerminalSwitch = true;
          try {
            await vscode.commands.executeCommand(CMD.switchRoot, match.root);
            await vscode.commands.executeCommand(CMD.viewDiff, { path: match.path, preserveFocus: true });
            // switchRoot can steal focus; restore it to the terminal the user clicked.
            terminal.show(false);
          } finally {
            suppressTerminalSwitch = false;
          }
        }
      }
    } finally {
      clickWorkerRunning = false;
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!terminal || suppressTerminalSwitch) return;
      queuedTerminal = terminal;
      void runClickWorker();
    })
  );

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
  changedFilesView.onDidChangeVisibility((e) => { sidebarVisible = e.visible; });
  activeReposView.onDidChangeVisibility((e) => { if (e.visible) sidebarVisible = true; });
  repoTreeView.onDidChangeVisibility((e) => { if (e.visible) sidebarVisible = true; });

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
  repoManager.onDidChangeRepos(async () => {
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
  });

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

  repoManager.onDidChangeRepos(updateViewInfo);
  repoManager.onDidChangeSelection(updateViewInfo);

  // Notifications when Claude/external tools commit or modify files
  // Queue notifications when unfocused, show grouped summary on refocus
  registerNotifications(context, repoManager, outputChannel);

  const sharedGit = repoManager.git;

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

  // Toggle changed only
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleChangedOnly, () =>
      repoManager.toggleChangedOnly()
    )
  );

  // Toggle favorites visibility in Active Repos (two commands for icon swap)
  const updateFavContext = () => {
    const show = vscode.workspace.getConfiguration("diffchestrator").get<boolean>("showFavorites", true);
    vscode.commands.executeCommand("setContext", "diffchestrator.showFavorites", show);
  };
  updateFavContext();

  const toggleFavHandler = async () => {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const current = config.get<boolean>("showFavorites", true);
    await config.update("showFavorites", !current, vscode.ConfigurationTarget.Global);
    updateFavContext();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleShowFavorites, toggleFavHandler),
    vscode.commands.registerCommand(CMD.toggleShowFavoritesOff, toggleFavHandler)
  );

  // Cycle through active/recent repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cycleActiveRepo, async () => {
      const nextPath = repoManager.cycleNextRepo();
      if (!nextPath) {
        vscode.window.showInformationMessage("Diffchestrator: No other recent repos to cycle to.");
        return;
      }
      // Use viewDiff to switch terminal + open diff, but the MRU list
      // is already rotated by cycleNextRepo so it won't re-sort.
      await vscode.commands.executeCommand(CMD.viewDiff, { path: nextPath });
    })
  );

  // Swap between current and previous repo (works across roots)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.swapRepo, async () => {
      const target = repoManager.swapTarget;
      if (!target) {
        vscode.window.showInformationMessage("Diffchestrator: No previous repo to swap to.");
        return;
      }
      // Save where we are now before swapping
      const current = repoManager.selectedRepo;
      const currentRoot = repoManager.currentRoot;

      repoManager.beginSwap();
      try {
        // Step 1: Switch root if needed (and wait for it to fully complete)
        if (target.root && target.root !== repoManager.currentRoot) {
          await repoManager.scan(target.root);
          fileWatcher.watchAll();
          // Wait for coalesced events to settle
          await new Promise((r) => setTimeout(r, 100));
        }

        // Step 2: Select the repo
        repoManager.selectRepo(target.path);

        // Step 3: Focus changed files view (only if diffchestrator sidebar is already active)
        if (sidebarVisible) {
          await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
        }

        // Step 4: Switch terminal
        await showTerminalIfExists(target.path);

        // Step 5: Open first changed file if any
        try {
          const status = await sharedGit.status(target.path);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            await openFileDiff(target.path, firstFile);
          }
        } catch { /* non-critical */ }
      } finally {
        repoManager.endSwap();
      }

      // Set swap target to where we just came from
      if (current) {
        repoManager.setSwapTarget({ path: current, root: currentRoot });
      }

      // Force UI refresh
      updateViewInfo();
    })
  );

  // Close active repo from recent list
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeActiveRepo, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      await closeEditorsForRepo(repoPath);
      // Close terminals if autoTerminals is configured
      const autoTerminals = vscode.workspace
        .getConfiguration("diffchestrator")
        .get<string[]>("autoTerminals", []);
      if (autoTerminals.length > 0 || repoManager.isDirectory(repoPath)) {
        const kinds: TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];
        for (const k of kinds) {
          const t = getRepoTerminal(repoPath, k);
          if (t) t.dispose();
        }
      }
      repoManager.closeRecentRepo(repoPath);
      // Switch to next repo if one exists
      const next = repoManager.selectedRepo;
      if (next) {
        await vscode.commands.executeCommand(CMD.viewDiff, { path: next });
      }
    })
  );

  // Pick which active repo to close
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closePickedRepo, async () => {
      const recent = repoManager.recentRepoPaths;
      if (recent.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: No active repos.");
        return;
      }
      const items = recent.map((p) => ({
        label: `$(repo) ${path.basename(p)}`,
        description: p === repoManager.selectedRepo ? "● active" : "",
        _repoPath: p,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Close which active repo?",
      });
      if (selected) {
        await closeEditorsForRepo(selected._repoPath);
        repoManager.closeRecentRepo(selected._repoPath);
        const next = repoManager.selectedRepo;
        if (next) {
          await vscode.commands.executeCommand(CMD.viewDiff, { path: next });
        }
      }
    })
  );

  // Close all active repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeAllActiveRepos, async () => {
      const recent = [...repoManager.recentRepoPaths];
      for (const p of recent) {
        await closeEditorsForRepo(p);
      }
      repoManager.clearAllRecentRepos();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    })
  );

  // Navigate changed files without staging
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.nextChangedFile, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      let status;
      try {
        status = await sharedGit.status(repoPath);
      } catch {
        return; // git status failed (repo deleted, index.lock, …) — no-op
      }
      const allFiles = [...status.unstaged, ...status.untracked, ...status.staged];
      if (allFiles.length === 0) return;

      // Find current file in the list
      const editor = vscode.window.activeTextEditor;
      const currentPath = editor?.document.uri.fsPath;
      const currentRel = currentPath ? path.relative(repoPath, currentPath) : "";
      const currentIdx = allFiles.findIndex((f) => f.path === currentRel);
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % allFiles.length : 0;
      const next = allFiles[nextIdx];

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openFileDiff(repoPath, next);
    }),
    vscode.commands.registerCommand(CMD.prevChangedFile, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      let status;
      try {
        status = await sharedGit.status(repoPath);
      } catch {
        return; // git status failed — no-op
      }
      const allFiles = [...status.unstaged, ...status.untracked, ...status.staged];
      if (allFiles.length === 0) return;

      const editor = vscode.window.activeTextEditor;
      const currentPath = editor?.document.uri.fsPath;
      const currentRel = currentPath ? path.relative(repoPath, currentPath) : "";
      const currentIdx = allFiles.findIndex((f) => f.path === currentRel);
      const prevIdx = currentIdx > 0 ? currentIdx - 1 : allFiles.length - 1;
      const prev = allFiles[prevIdx];

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openFileDiff(repoPath, prev);
    })
  );

  // Select / deselect repo (multi-select toggle)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.selectRepo,
      (item?: any) => {
        const p = resolveRepoPath(item, repoManager.selectedRepo);
        if (p) repoManager.toggleRepoSelection(p);
      }
    )
  );

  // Clear multi-selection
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.clearSelection, () =>
      repoManager.clearMultiSelection()
    )
  );

  // Select all active/recent repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.selectAllActive, () => {
      for (const p of repoManager.recentRepoPaths) {
        if (!repoManager.selectedRepoPaths.has(p)) {
          repoManager.toggleRepoSelection(p);
        }
      }
    }),
    vscode.commands.registerCommand(CMD.deselectAll, () =>
      repoManager.clearMultiSelection()
    )
  );

  // Check if a URI belongs to a repo (by file path or git-show query)
  function uriBelongsToRepo(uri: vscode.Uri, repoPath: string): boolean {
    // Compare with a trailing separator so /x/foo doesn't match /x/foo-bar
    if (
      uri.scheme === "file" &&
      (uri.fsPath === repoPath || uri.fsPath.startsWith(repoPath + path.sep))
    ) {
      return true;
    }
    if (uri.scheme === "git-show") {
      try {
        const params = JSON.parse(uri.query);
        if (params.repoPath === repoPath) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  // Tab sessions captured when a repo's editors are closed on switch-away,
  // restored in full when the user returns to that repo (LRU, max 20 repos).
  type SavedTab =
    | { kind: "text"; uri: vscode.Uri; viewColumn?: vscode.ViewColumn; active: boolean }
    | {
        kind: "diff";
        original: vscode.Uri;
        modified: vscode.Uri;
        label: string;
        viewColumn?: vscode.ViewColumn;
        active: boolean;
      };
  const savedTabsByRepo = new Map<string, SavedTab[]>();
  const capSavedTabs = () => {
    while (savedTabsByRepo.size > MAX_LAST_OPEN) {
      const oldest = savedTabsByRepo.keys().next().value!;
      savedTabsByRepo.delete(oldest);
    }
  };

  // Close editors that belong to a specific repo path, remembering the full
  // tab set so returning to the repo restores the session — not just one file.
  async function closeEditorsForRepo(repoPath: string): Promise<void> {
    const tabsToClose: vscode.Tab[] = [];
    const saved: SavedTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as Record<string, unknown> | undefined;
        if (input?.uri && uriBelongsToRepo(input.uri as vscode.Uri, repoPath)) {
          tabsToClose.push(tab);
          saved.push({
            kind: "text",
            uri: input.uri as vscode.Uri,
            viewColumn: group.viewColumn,
            active: tab.isActive && group.isActive,
          });
        } else if (
          input?.original &&
          input?.modified &&
          (uriBelongsToRepo(input.original as vscode.Uri, repoPath) ||
            uriBelongsToRepo(input.modified as vscode.Uri, repoPath))
        ) {
          tabsToClose.push(tab);
          saved.push({
            kind: "diff",
            original: input.original as vscode.Uri,
            modified: input.modified as vscode.Uri,
            label: tab.label,
            viewColumn: group.viewColumn,
            active: tab.isActive && group.isActive,
          });
        }
      }
    }
    if (tabsToClose.length > 0) {
      savedTabsByRepo.delete(repoPath); // re-insert at end for LRU
      savedTabsByRepo.set(repoPath, saved);
      capSavedTabs();
      await vscode.window.tabGroups.close(tabsToClose);
    }
  }

  /** Restore a previously captured tab session. Returns true if anything reopened. */
  async function restoreEditorsForRepo(repoPath: string, preserveFocus: boolean): Promise<boolean> {
    const saved = savedTabsByRepo.get(repoPath);
    if (!saved || saved.length === 0) return false;
    savedTabsByRepo.delete(repoPath); // the tabs are live again; re-captured on next switch
    // Open the previously-active tab last so it ends up focused.
    const ordered = [...saved.filter((t) => !t.active), ...saved.filter((t) => t.active)];
    let restored = false;
    for (const t of ordered) {
      const focusOpts = { preview: false, preserveFocus: preserveFocus || !t.active };
      try {
        if (t.kind === "text") {
          await vscode.window.showTextDocument(t.uri, { ...focusOpts, viewColumn: t.viewColumn });
        } else {
          await vscode.commands.executeCommand("vscode.diff", t.original, t.modified, t.label, {
            ...focusOpts,
            viewColumn: t.viewColumn,
          });
        }
        restored = true;
      } catch (err) {
        // File deleted / ref gone since capture — skip it
        outputChannel.appendLine(`[restore tabs] ${err instanceof Error ? err.message : err}`);
      }
    }
    return restored;
  }

  let previousRepoPath: string | undefined;

  // View diff — selects repo, shows changed files panel, auto-opens first changed file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.viewDiff,
      async (item?: any) => {
        const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
        const preserveFocus = !!item?.preserveFocus;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        // Close editors from the previous repo before switching
        switchingRepo = true;
        try {
          if (previousRepoPath && previousRepoPath !== repoPath) {
            await closeEditorsForRepo(previousRepoPath);
          }
          previousRepoPath = repoPath;

          repoManager.selectRepo(repoPath);
          // Only steal sidebar focus if diffchestrator panel is already visible
          // and caller isn't preserving focus (e.g. terminal-tab click).
          if (sidebarVisible && !preserveFocus) {
            await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
          }
          // Don't override user's terminal choice: skip when a programmatic terminal
          // switch is running (cycle/nav) or when the caller preserves focus (terminal click).
          if (!suppressTerminalSwitch && !preserveFocus) {
            await showTerminalIfExists(repoPath);
          }

          // Auto-open configured terminal types — only if not already running
          const autoTerminals = vscode.workspace
            .getConfiguration("diffchestrator")
            .get<string[]>("autoTerminals", []);
          // Skip entirely if repo already has ANY terminals (tracked or untracked)
          const repoBasename = path.basename(repoPath);
          const hasExistingTerminals = vscode.window.terminals.some(
            (t) => t.name === repoBasename
          );
          for (const kind of autoTerminals) {
            if (getRepoTerminal(repoPath, kind as TerminalKind)) continue;
            if (hasExistingTerminals) continue;
            if (kind === "shell") {
              await vscode.commands.executeCommand(CMD.openTerminal, { path: repoPath });
            } else if (kind === "yolo") {
              await vscode.commands.executeCommand(CMD.yolo, { path: repoPath });
            } else if (kind === "yolonew") {
              await vscode.commands.executeCommand(CMD.yolonew, { path: repoPath });
            } else if (kind === "claude") {
              await vscode.commands.executeCommand(CMD.openClaudeCode, { path: repoPath });
            } else if (kind === "claudenew") {
              await vscode.commands.executeCommand(CMD.openClaudeCodeNew, { path: repoPath });
            }
          }
        } finally {
          switchingRepo = false;
        }

        // Directory entries: terminal only, no file operations
        if (repoManager.isDirectory(repoPath)) return;

        // Returning to a repo whose tabs we closed on switch-away: restore the
        // whole session instead of opening the first changed file.
        try {
          if (await restoreEditorsForRepo(repoPath, preserveFocus)) return;
        } catch (err) {
          outputChannel.appendLine(`[restore tabs] ${err instanceof Error ? err.message : err}`);
        }

        // Priority: changed files first (review workflow), then remembered file
        try {
          const status = await sharedGit.status(repoPath);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            await openFileDiff(repoPath, firstFile, { preserveFocus });
          } else {
            // No changes — restore remembered file if we have one
            const remembered = lastOpenFile.get(repoPath);
            if (remembered) {
              try {
                if (remembered.scheme === "file") {
                  await vscode.window.showTextDocument(remembered, { preview: false, preserveFocus });
                } else {
                  const doc = await vscode.workspace.openTextDocument(remembered);
                  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
                }
              } catch (err) {
                outputChannel.appendLine(`[restore file] ${err instanceof Error ? err.message : err}`);
                lastOpenFile.delete(repoPath);
                if (!preserveFocus) {
                  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                }
              }
            } else if (!preserveFocus) {
              await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
          }
        } catch (err) {
          outputChannel.appendLine(`[viewDiff] ${err instanceof Error ? err.message : err}`);
        }
      }
    )
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

  // Cycle terminal — rotate through alive terminals for selected repo
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cycleTerminal, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      suppressTerminalSwitch = true;
      try { await cycleTerminal(repoPath); } finally { suppressTerminalSwitch = false; }
    })
  );

  // Close terminal — close active or pick which to close
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeTerminal, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      await closeRepoTerminal(repoPath);
    })
  );

  // Navigate terminals across repos — auto-select the target repo
  const registerNav = (cmd: string, direction: 1 | -1) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(cmd, async () => {
        suppressTerminalSwitch = true;
        try {
          const repoPath = await navigateTerminal(direction, [...repoManager.allRepos.map((r) => r.path), ...repoManager.directoryPaths]);
          if (repoPath && repoPath !== repoManager.selectedRepo) {
            // Check if repo is in current root
            const inCurrentRoot = repoManager.allRepos.some((r) => r.path === repoPath);
            if (inCurrentRoot) {
              repoManager.selectRepo(repoPath);
            } else {
              // Try to find in other roots and switch
              const terminal = vscode.window.activeTerminal;
              const match = terminal
                ? await repoManager.findRepoInOtherRoots(terminal.name)
                : undefined;
              if (match) {
                await vscode.commands.executeCommand(CMD.switchRoot, match.root);
                repoManager.selectRepo(match.path);
              }
            }
          }
        } finally {
          suppressTerminalSwitch = false;
        }
      })
    );
  };
  registerNav(CMD.nextTerminal, 1);
  registerNav(CMD.prevTerminal, -1);

  registerFileOpsCommands(context, repoManager);

  // Phase 5: File watcher already created above (before command registrations)

  // Phase 6: Inline blame — git blame on current line
  const inlineBlame = new InlineBlameService(repoManager);
  context.subscriptions.push(inlineBlame);

  // Phase 8: Auto-scan workspace folders
  const workspaceAutoScan = new WorkspaceAutoScan(repoManager, fileWatcher);
  context.subscriptions.push(workspaceAutoScan);

  // Auto-scan on startup — resume last root if available, otherwise use first configured root
  const config = vscode.workspace.getConfiguration("diffchestrator");
  if (config.get<boolean>("scanOnStartup", true)) {
    const roots = config.get<string[]>("scanRoots", []);
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
    const onboardConfig = vscode.workspace.getConfiguration("diffchestrator");
    const roots = onboardConfig.get<string[]>("scanRoots", []);
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
