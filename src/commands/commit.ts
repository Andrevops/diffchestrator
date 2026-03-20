import * as vscode from "vscode";
import * as path from "path";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = new GitExecutor();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.commit,
      async (item?: { path?: string }) => {
        const repoPath = item?.path ?? repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const repoName = path.basename(repoPath);
        const message = await vscode.window.showInputBox({
          prompt: `Commit message for ${repoName}`,
          placeHolder: "Enter commit message...",
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return "Commit message cannot be empty";
            }
            return null;
          },
        });

        if (!message) return;

        try {
          const output = await git.commit(repoPath, message.trim());
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(
            `Diffchestrator: Committed to ${repoName}`
          );
          // Log output to output channel
          const channel = vscode.window.createOutputChannel("Diffchestrator");
          channel.appendLine(`[commit] ${repoName}`);
          channel.appendLine(output);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Commit failed for ${repoName}: ${msg}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.bulkCommit, async () => {
      const selectedPaths = repoManager.selectedRepoPaths;
      if (selectedPaths.size === 0) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repositories selected for bulk commit."
        );
        return;
      }

      const message = await vscode.window.showInputBox({
        prompt: `Commit message for ${selectedPaths.size} repositories`,
        placeHolder: "Enter commit message for all selected repos...",
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit message cannot be empty";
          }
          return null;
        },
      });

      if (!message) return;

      const channel = vscode.window.createOutputChannel("Diffchestrator");
      channel.show();

      let success = 0;
      let failed = 0;

      for (const repoPath of selectedPaths) {
        const name = path.basename(repoPath);
        try {
          const output = await git.commit(repoPath, message.trim());
          channel.appendLine(`[OK] ${name}: ${output.trim()}`);
          await repoManager.refreshRepo(repoPath);
          success++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`[FAIL] ${name}: ${msg}`);
          failed++;
        }
      }

      vscode.window.showInformationMessage(
        `Diffchestrator: Bulk commit complete. ${success} succeeded, ${failed} failed.`
      );
    })
  );
}
