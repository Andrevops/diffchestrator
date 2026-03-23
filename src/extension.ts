import * as vscode from "vscode";
import { RepoManager } from "./services/repoManager";
import { RepoTreeProvider } from "./providers/repoTreeProvider";
import { FavoritesTreeProvider } from "./providers/favoritesTreeProvider";
import { ChangedFilesProvider } from "./providers/changedFilesProvider";
import { CMD, VIEW_ACTIVE_REPOS, VIEW_REPOS, VIEW_FAVORITES, VIEW_CHANGED_FILES } from "./constants";
import { registerScanCommands } from "./commands/scan";
import { registerStageCommands, openNextPendingFile, openFileDiff } from "./commands/stage";
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
import { ActiveReposProvider } from "./providers/activeReposProvider";
import { GitContentProvider } from "./providers/gitContentProvider";
import { DiffWebviewPanel } from "./views/diffWebviewPanel";
import { FileWatcher } from "./services/fileWatcher";
import { StatusBarManager } from "./services/statusBar";
import { InlineBlameService } from "./services/inlineBlame";
import { WorkspaceAutoScan } from "./services/workspaceAutoScan";
// GitExecutor accessed via repoManager.git (shared instance)
import { showTerminalIfExists, findRepoForTerminal } from "./commands/terminal";
import * as path from "path";

export function activate(context: vscode.ExtensionContext): void {
  const repoManager = new RepoManager(context.workspaceState);
  context.subscriptions.push(repoManager);

  // Track last open file per repo so switching back restores context
  const lastOpenFile = new Map<string, vscode.Uri>();
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
      if (uri.scheme === "file" && uri.fsPath.startsWith(repoPath)) {
        lastOpenFile.set(repoPath, uri);
      } else if (uri.scheme === "git-show") {
        lastOpenFile.set(repoPath, uri);
      }
    })
  );

  // When user clicks a terminal tab, switch to that repo (full viewDiff flow)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!terminal || switchingRepo) return;
      const allPaths = repoManager.repos.map((r) => r.path);
      const repoPath = findRepoForTerminal(terminal, allPaths);
      if (repoPath && repoPath !== repoManager.selectedRepo) {
        vscode.commands.executeCommand(CMD.viewDiff, { path: repoPath });
      }
    })
  );

  // Tree views
  const activeRepos = new ActiveReposProvider(repoManager);
  const repoTree = new RepoTreeProvider(repoManager);
  const favTree = new FavoritesTreeProvider(repoManager);
  const changedFiles = new ChangedFilesProvider(repoManager);

  // Git content provider for diff URIs
  const gitContentProvider = new GitContentProvider();
  // Create tree views (not just providers) so we can set description + badge
  const activeReposView = vscode.window.createTreeView(VIEW_ACTIVE_REPOS, { treeDataProvider: activeRepos });
  const repoTreeView = vscode.window.createTreeView(VIEW_REPOS, { treeDataProvider: repoTree });
  const favTreeView = vscode.window.createTreeView(VIEW_FAVORITES, { treeDataProvider: favTree });
  const changedFilesView = vscode.window.createTreeView(VIEW_CHANGED_FILES, { treeDataProvider: changedFiles });

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("git-show", gitContentProvider),
    activeReposView,
    repoTreeView,
    favTreeView,
    changedFilesView,
  );

  // Update view descriptions + badge when state changes
  const updateViewInfo = () => {
    const repos = repoManager.repos;
    const totalChanges = repos.reduce((sum, r) => sum + r.totalChanges, 0);

    // Repos view: show count
    repoTreeView.description = repoManager.changedOnly
      ? `${repos.filter(r => r.totalChanges > 0).length} changed`
      : `${repos.length} repos`;

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
  const sharedGit = repoManager.git;

  repoManager.onDidDetectCommit(async ({ repoPath, repoName }) => {
    try {
      const commits = await sharedGit.log(repoPath, 1);
      const msg = commits.length > 0 ? commits[0].message : "new commit";
      const action = await vscode.window.showInformationMessage(
        `Diffchestrator: Committed in ${repoName} — ${msg}`,
        "Show Terminal",
        "View Changes"
      );
      if (action === "Show Terminal") {
        repoManager.selectRepo(repoPath);
        await showTerminalIfExists(repoPath);
      } else if (action === "View Changes") {
        await vscode.commands.executeCommand(CMD.viewDiff, { path: repoPath });
      }
    } catch { /* ignore */ }
  });

  repoManager.onDidDetectChanges(async ({ repoPath, repoName, count }) => {
    const action = await vscode.window.showInformationMessage(
      `Diffchestrator: ${count} new change${count !== 1 ? "s" : ""} in ${repoName}`,
      "Show Terminal",
      "View Changes"
    );
    if (action === "Show Terminal") {
      repoManager.selectRepo(repoPath);
      await showTerminalIfExists(repoPath);
    } else if (action === "View Changes") {
      await vscode.commands.executeCommand(CMD.viewDiff, { path: repoPath });
    }
  });

  // Register command modules
  registerScanCommands(context, repoManager);
  registerStageCommands(context, repoManager);
  registerCommitCommands(context, repoManager);
  registerPushCommands(context, repoManager);
  registerPullCommands(context, repoManager);
  registerAiCommitCommands(context, repoManager);
  registerClaudeCommands(context, repoManager);
  registerFavoriteCommands(context, repoManager);
  registerFileSearchCommand(context, repoManager);
  registerTerminalCommand(context, repoManager);
  registerCommitHistoryCommands(context, repoManager);
  registerDiscardCommands(context, repoManager);
  registerSwitchBranchCommands(context, repoManager);
  registerStashCommands(context, repoManager);

  // Toggle changed only
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleChangedOnly, () =>
      repoManager.toggleChangedOnly()
    )
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

  // Close active repo from recent list
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeActiveRepo, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      await closeEditorsForRepo(repoPath);
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
      const status = await sharedGit.status(repoPath);
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
      const status = await sharedGit.status(repoPath);
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

  // Stage/unstage the file currently open in the editor (editor title bar buttons)
  // Delegates to the same stageFile/unstageFile commands used by the sidebar tree,
  // resolving the file path from the active editor first.
  // Reuse shared git instance for editor commands

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.stageCurrentFile, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const absFile = editor.document.uri.fsPath;
      const rel = path.relative(repoPath, absFile);
      if (rel.startsWith("..")) return;
      try {
        await sharedGit.stage(repoPath, [rel]);
        await repoManager.refreshRepo(repoPath);
        await openNextPendingFile(sharedGit, repoPath, rel);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Failed to stage: ${err instanceof Error ? err.message : err}`);
      }
    }),
    vscode.commands.registerCommand(CMD.unstageCurrentFile, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const absFile = editor.document.uri.fsPath;
      const rel = path.relative(repoPath, absFile);
      if (rel.startsWith("..")) return;
      try {
        await sharedGit.unstage(repoPath, [rel]);
        await repoManager.refreshRepo(repoPath);
        vscode.window.showInformationMessage(`Unstaged: ${rel}`);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Failed to unstage: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // Select / deselect repo (multi-select toggle)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.selectRepo,
      (item?: any) => {
        const p = resolveRepoPath(item);
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

  // Helper to extract repo path from various argument shapes
  // Tree click: { path: "..." }, Context menu: TreeNode { fullPath: "...", repo: { path: "..." } }
  function resolveRepoPath(item?: any): string | undefined {
    if (!item) return repoManager.selectedRepo;
    if (item.repo?.path) return item.repo.path;
    if (item.fullPath) return item.fullPath;
    if (item.path) return item.path;
    if (item.repoPath) return item.repoPath;
    return repoManager.selectedRepo;
  }

  // Check if a URI belongs to a repo (by file path or git-show query)
  function uriBelongsToRepo(uri: vscode.Uri, repoPath: string): boolean {
    if (uri.scheme === "file" && uri.fsPath.startsWith(repoPath)) return true;
    if (uri.scheme === "git-show") {
      try {
        const params = JSON.parse(uri.query);
        if (params.repoPath === repoPath) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  // Close editors that belong to a specific repo path
  async function closeEditorsForRepo(repoPath: string): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        let belongsToRepo = false;
        const input = tab.input as any;
        if (input?.uri) {
          // TabInputText or TabInputNotebook — has a single uri
          belongsToRepo = uriBelongsToRepo(input.uri, repoPath);
        } else if (input?.original && input?.modified) {
          // TabInputDiff — has original + modified URIs
          belongsToRepo =
            uriBelongsToRepo(input.original, repoPath) ||
            uriBelongsToRepo(input.modified, repoPath);
        }
        if (belongsToRepo) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }

  let previousRepoPath: string | undefined;

  // View diff — selects repo, shows changed files panel, auto-opens first changed file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.viewDiff,
      async (item?: any) => {
        const repoPath = resolveRepoPath(item);
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
          await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
          await showTerminalIfExists(repoPath);
        } finally {
          switchingRepo = false;
        }

        // Priority: changed files first (review workflow), then remembered file
        try {
          const status = await sharedGit.status(repoPath);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            await openFileDiff(repoPath, firstFile);
          } else {
            // No changes — restore remembered file if we have one
            const remembered = lastOpenFile.get(repoPath);
            if (remembered) {
              try {
                if (remembered.scheme === "file") {
                  await vscode.window.showTextDocument(remembered, { preview: false });
                } else {
                  const doc = await vscode.workspace.openTextDocument(remembered);
                  await vscode.window.showTextDocument(doc, { preview: false });
                }
              } catch {
                lastOpenFile.delete(repoPath);
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
              }
            } else {
              await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
          }
        } catch {
          // Non-critical — file list still works
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

  // Phase 5: File watcher — auto-refresh repos on filesystem changes
  const fileWatcher = new FileWatcher(repoManager);
  context.subscriptions.push(fileWatcher);

  // Phase 6: Status bar — shows repo/change counts
  const statusBar = new StatusBarManager(repoManager);
  context.subscriptions.push(statusBar);

  // Phase 7: Inline blame — git blame on current line
  const inlineBlame = new InlineBlameService(repoManager);
  context.subscriptions.push(inlineBlame);

  // Phase 8: Auto-scan workspace folders
  const workspaceAutoScan = new WorkspaceAutoScan(repoManager, fileWatcher);
  context.subscriptions.push(workspaceAutoScan);

  // Auto-scan on startup
  const config = vscode.workspace.getConfiguration("diffchestrator");
  if (config.get<boolean>("scanOnStartup", true)) {
    const roots = config.get<string[]>("scanRoots", []);
    if (roots.length > 0) {
      repoManager.scan(roots[0]).then(() => {
        fileWatcher.watchAll();
      });
    }
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
