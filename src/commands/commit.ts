import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  channel: vscode.OutputChannel
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.commit,
      async (item?: any) => {
        const repoPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const repoName = path.basename(repoPath);

        // Conventional commit prefix picker
        const prefixes = [
          { label: "feat", description: "A new feature" },
          { label: "fix", description: "A bug fix" },
          { label: "chore", description: "Maintenance / housekeeping" },
          { label: "refactor", description: "Code change that neither fixes nor adds" },
          { label: "docs", description: "Documentation only" },
          { label: "test", description: "Adding or updating tests" },
          { label: "ci", description: "CI/CD changes" },
          { label: "$(dash) No prefix", description: "Plain commit message", _plain: true },
        ];
        const picked = await vscode.window.showQuickPick(prefixes as (typeof prefixes[0] & { _plain?: boolean })[], {
          placeHolder: `Commit type for ${repoName}`,
        });
        if (!picked) return;

        const message = await vscode.window.showInputBox({
          prompt: `Commit message for ${repoName}`,
          placeHolder: (picked as any)._plain ? "Enter commit message..." : `${picked.label}: describe your change...`,
          value: (picked as any)._plain ? "" : `${picked.label}: `,
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
          channel.appendLine(`[commit] ${repoName}`);
          channel.appendLine(output);

          // Auto-push if enabled
          const config = vscode.workspace.getConfiguration("diffchestrator");
          if (config.get<boolean>("autoPushAfterCommit", false)) {
            try {
              await git.push(repoPath);
              await repoManager.refreshRepo(repoPath);
              vscode.window.showInformationMessage(`Diffchestrator: Committed and pushed ${repoName}`);
            } catch (pushErr: unknown) {
              const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
              vscode.window.showWarningMessage(`Diffchestrator: Committed ${repoName} but push failed: ${pushMsg}`);
            }
          } else {
            vscode.window.showInformationMessage(`Diffchestrator: Committed to ${repoName}`);
          }
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

      channel.show();

      let success = 0;
      let failed = 0;
      const paths = [...selectedPaths];
      const BATCH_SIZE = 5;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Diffchestrator: Bulk committing...",
          cancellable: false,
        },
        async (progress) => {
          for (let i = 0; i < paths.length; i += BATCH_SIZE) {
            const batch = paths.slice(i, i + BATCH_SIZE);
            progress.report({
              message: `${Math.min(i + BATCH_SIZE, paths.length)}/${paths.length} repos`,
              increment: (batch.length / paths.length) * 100,
            });

            await Promise.all(
              batch.map(async (repoPath) => {
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
              })
            );
          }
        }
      );

      vscode.window.showInformationMessage(
        `Diffchestrator: Bulk commit complete. ${success} succeeded, ${failed} failed.`
      );
    })
  );
}
