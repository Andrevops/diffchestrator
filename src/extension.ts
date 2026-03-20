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
import { GitExecutor } from "./git/gitExecutor";

export function activate(context: vscode.ExtensionContext): void {
  const repoManager = new RepoManager();
  context.subscriptions.push(repoManager);

  const git = new GitExecutor();

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

  // View multi-repo diff — opens output channel with combined diffs
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.viewMultiRepoDiff, async () => {
      const selectedPaths = repoManager.selectedRepoPaths;
      if (selectedPaths.size === 0) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repositories selected for multi-repo diff."
        );
        return;
      }

      const channel = vscode.window.createOutputChannel(
        "Diffchestrator Multi-Repo Diff"
      );
      channel.clear();
      channel.show();

      for (const repoPath of selectedPaths) {
        const name =
          repoManager.repos.find((r) => r.path === repoPath)?.name ?? repoPath;
        channel.appendLine(`${"=".repeat(60)}`);
        channel.appendLine(`Repository: ${name}`);
        channel.appendLine(`Path: ${repoPath}`);
        channel.appendLine(`${"=".repeat(60)}`);

        try {
          const stagedDiff = await git.diff(repoPath, true);
          const unstagedDiff = await git.diff(repoPath, false);

          if (stagedDiff) {
            channel.appendLine("\n--- Staged Changes ---");
            channel.appendLine(stagedDiff);
          }
          if (unstagedDiff) {
            channel.appendLine("\n--- Unstaged Changes ---");
            channel.appendLine(unstagedDiff);
          }
          if (!stagedDiff && !unstagedDiff) {
            channel.appendLine("\n(no changes)");
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`\n[ERROR] ${msg}`);
        }
        channel.appendLine("");
      }
    })
  );

  // Auto-scan on startup
  const config = vscode.workspace.getConfiguration("diffchestrator");
  if (config.get<boolean>("scanOnStartup", true)) {
    const roots = config.get<string[]>("scanRoots", []);
    if (roots.length > 0) {
      repoManager.scan(roots[0]);
    }
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
