import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { resolveRepoPath } from "../utils/fileItem";

export function registerPullCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  channel: vscode.OutputChannel
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.pull,
      async (item?: any) => {
        const repoPath =
          resolveRepoPath(item, repoManager.selectedRepo);
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const repoName = path.basename(repoPath);

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Diffchestrator: Pulling ${repoName}...`,
              cancellable: false,
            },
            async () => {
              const output = await git.pull(repoPath);
              channel.appendLine(`[pull] ${repoName}`);
              channel.appendLine(output);
            }
          );
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(
            `Diffchestrator: Pulled ${repoName}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Pull failed for ${repoName}: ${msg}`
          );
        }
      }
    )
  );

  // Single-repo fetch (#42)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchRepo, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      const repoName = path.basename(repoPath);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Diffchestrator: Fetching ${repoName}...` },
          async () => {
            await git.fetch(repoPath);
            await repoManager.refreshRepo(repoPath);
          }
        );
        const repo = repoManager.getRepo(repoPath);
        const behind = repo?.behind ?? 0;
        vscode.window.showInformationMessage(
          `Diffchestrator: Fetched ${repoName}${behind > 0 ? ` (${behind} behind)` : " (up to date)"}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Fetch failed for ${repoName}: ${msg}`);
      }
    })
  );
}
