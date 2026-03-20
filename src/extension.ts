import * as vscode from "vscode";
import { RepoManager } from "./services/repoManager";
import { RepoTreeProvider } from "./providers/repoTreeProvider";
import { FavoritesTreeProvider } from "./providers/favoritesTreeProvider";
import { ChangedFilesProvider } from "./providers/changedFilesProvider";
import { CMD, VIEW_REPOS, VIEW_FAVORITES, VIEW_CHANGED_FILES } from "./constants";
import { registerScanCommands } from "./commands/scan";
import { registerStageCommands } from "./commands/stage";
import { registerCommitCommands } from "./commands/commit";
import { registerPushCommands } from "./commands/push";
import { registerAiCommitCommands } from "./commands/aiCommit";
import { registerClaudeCommands } from "./commands/openClaude";
import { registerFavoriteCommands } from "./commands/favorites";
import { registerFileSearchCommand } from "./commands/fileSearch";
import { registerTerminalCommand } from "./commands/terminal";
import { DiffWebviewPanel } from "./views/diffWebviewPanel";
import { FileWatcher } from "./services/fileWatcher";
import { StatusBarManager } from "./services/statusBar";

export function activate(context: vscode.ExtensionContext): void {
  const repoManager = new RepoManager();
  context.subscriptions.push(repoManager);

  // Tree views
  const repoTree = new RepoTreeProvider(repoManager);
  const favTree = new FavoritesTreeProvider(repoManager);
  const changedFiles = new ChangedFilesProvider(repoManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_REPOS, repoTree),
    vscode.window.registerTreeDataProvider(VIEW_FAVORITES, favTree),
    vscode.window.registerTreeDataProvider(VIEW_CHANGED_FILES, changedFiles)
  );

  // Register command modules
  registerScanCommands(context, repoManager);
  registerStageCommands(context, repoManager);
  registerCommitCommands(context, repoManager);
  registerPushCommands(context, repoManager);
  registerAiCommitCommands(context, repoManager);
  registerClaudeCommands(context, repoManager);
  registerFavoriteCommands(context, repoManager);
  registerFileSearchCommand(context, repoManager);
  registerTerminalCommand(context, repoManager);

  // Toggle changed only
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleChangedOnly, () =>
      repoManager.toggleChangedOnly()
    )
  );

  // Select / deselect repo (multi-select toggle)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.selectRepo,
      (item?: { path?: string }) => {
        if (item?.path) {
          repoManager.toggleRepoSelection(item.path);
        }
      }
    )
  );

  // Clear multi-selection
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.clearSelection, () =>
      repoManager.clearMultiSelection()
    )
  );

  // View diff — selects repo and shows changed files panel
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.viewDiff,
      (item?: { path?: string }) => {
        const repoPath = item?.path ?? repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }
        repoManager.selectRepo(repoPath);
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
