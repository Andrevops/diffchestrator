import * as vscode from "vscode";
import * as path from "path";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerPushCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = new GitExecutor();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.push,
      async (item?: { path?: string }) => {
        const repoPath = item?.path ?? repoManager.selectedRepo;
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
              title: `Diffchestrator: Pushing ${repoName}...`,
              cancellable: false,
            },
            async () => {
              const output = await git.push(repoPath);
              const channel = vscode.window.createOutputChannel("Diffchestrator");
              channel.appendLine(`[push] ${repoName}`);
              channel.appendLine(output);
            }
          );
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(
            `Diffchestrator: Pushed ${repoName}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Push failed for ${repoName}: ${msg}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.bulkPush, async () => {
      const selectedPaths = repoManager.selectedRepoPaths;
      if (selectedPaths.size === 0) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repositories selected for bulk push."
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Push ${selectedPaths.size} repositories?`,
        { modal: true },
        "Push"
      );

      if (confirm !== "Push") return;

      const channel = vscode.window.createOutputChannel("Diffchestrator");
      channel.show();

      let success = 0;
      let failed = 0;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Diffchestrator: Bulk pushing...",
          cancellable: false,
        },
        async (progress) => {
          const total = selectedPaths.size;
          let current = 0;

          for (const repoPath of selectedPaths) {
            const name = path.basename(repoPath);
            current++;
            progress.report({
              message: `${current}/${total} - ${name}`,
              increment: (1 / total) * 100,
            });

            try {
              const output = await git.push(repoPath);
              channel.appendLine(`[OK] ${name}: ${output.trim()}`);
              await repoManager.refreshRepo(repoPath);
              success++;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              channel.appendLine(`[FAIL] ${name}: ${msg}`);
              failed++;
            }
          }
        }
      );

      vscode.window.showInformationMessage(
        `Diffchestrator: Bulk push complete. ${success} succeeded, ${failed} failed.`
      );
    })
  );
}
