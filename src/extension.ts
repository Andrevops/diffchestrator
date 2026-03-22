import * as vscode from "vscode";
import { RepoManager } from "./services/repoManager";
import { RepoTreeProvider } from "./providers/repoTreeProvider";
import { FavoritesTreeProvider } from "./providers/favoritesTreeProvider";
import { ChangedFilesProvider } from "./providers/changedFilesProvider";
import { CMD, VIEW_ACTIVE_REPOS, VIEW_REPOS, VIEW_FAVORITES, VIEW_CHANGED_FILES } from "./constants";
import { registerScanCommands } from "./commands/scan";
import { registerStageCommands, openNextPendingFile } from "./commands/stage";
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
import { GitExecutor } from "./git/gitExecutor";
import { showTerminalIfExists } from "./commands/terminal";
import * as path from "path";

export function activate(context: vscode.ExtensionContext): void {
  const repoManager = new RepoManager();
  context.subscriptions.push(repoManager);

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
      const recent = repoManager.recentRepoPaths;
      if (recent.length < 2) {
        vscode.window.showInformationMessage("Diffchestrator: No other recent repos to cycle to.");
        return;
      }
      // Current is recent[0], next is recent[1]
      const nextPath = recent[1];
      await vscode.commands.executeCommand(CMD.viewDiff, { path: nextPath });
    })
  );

  // Stage/unstage the file currently open in the editor (editor title bar buttons)
  // Delegates to the same stageFile/unstageFile commands used by the sidebar tree,
  // resolving the file path from the active editor first.
  const gitForEditor = new GitExecutor();

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
        await gitForEditor.stage(repoPath, [rel]);
        await repoManager.refreshRepo(repoPath);
        await openNextPendingFile(gitForEditor, repoPath, rel);
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
        await gitForEditor.unstage(repoPath, [rel]);
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
        repoManager.selectRepo(repoPath);
        await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
        // Show the repo's terminal if one exists (preserves focus on editor)
        await showTerminalIfExists(repoPath);

        // Auto-open first changed file in diff editor
        try {
          const git = new GitExecutor();
          const status = await git.status(repoPath);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            const filePath = firstFile.path;
            if (firstFile.status === "untracked") {
              await vscode.commands.executeCommand(
                "vscode.open",
                vscode.Uri.file(path.join(repoPath, filePath))
              );
            } else {
              const staged = firstFile.status === "staged";
              const leftUri = vscode.Uri.parse(
                `git-show:${path.join(repoPath, filePath)}`
              ).with({
                query: JSON.stringify({ path: filePath, ref: "HEAD", repoPath }),
              });
              const rightUri = staged
                ? vscode.Uri.parse(
                    `git-show:${path.join(repoPath, filePath)}`
                  ).with({
                    query: JSON.stringify({ path: filePath, ref: ":0", repoPath }),
                  })
                : vscode.Uri.file(path.join(repoPath, filePath));
              await vscode.commands.executeCommand(
                "vscode.diff",
                leftUri,
                rightUri,
                `${path.basename(filePath)} (${staged ? "Staged" : "Working Tree"})`
              );
            }
          } else {
            // No changes — close stale diff from previous repo
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
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
