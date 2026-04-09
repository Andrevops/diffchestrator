import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { resolveRepoPath } from "../utils/fileItem";

export function registerPushCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  channel: vscode.OutputChannel
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.push,
      async (item?: any) => {
        const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
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
          // Detect diverged remote — offer pull first
          if (msg.includes("rejected") || msg.includes("non-fast-forward") || msg.includes("fetch first")) {
            const action = await vscode.window.showWarningMessage(
              `Diffchestrator: Push rejected for ${repoName} — remote has new commits. Pull first?`,
              "Pull",
              "Force Push"
            );
            if (action === "Pull") {
              await vscode.commands.executeCommand(CMD.pull, { path: repoPath });
            } else if (action === "Force Push") {
              await vscode.commands.executeCommand(CMD.forcePush, { path: repoPath });
            }
          } else {
            vscode.window.showErrorMessage(
              `Diffchestrator: Push failed for ${repoName}: ${msg}`
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.forcePush,
      async (item?: any) => {
        const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
        if (!repoPath) {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
          return;
        }

        const repoName = path.basename(repoPath);
        const confirm = await vscode.window.showWarningMessage(
          `Force push ${repoName}? This uses --force-with-lease (safe against overwriting others' work).`,
          { modal: true },
          "Force Push"
        );
        if (confirm !== "Force Push") return;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Diffchestrator: Force pushing ${repoName}...`,
              cancellable: false,
            },
            async () => {
              const output = await git.push(repoPath, true);
              channel.appendLine(`[force-push] ${repoName}`);
              channel.appendLine(output);
            }
          );
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(`Diffchestrator: Force pushed ${repoName}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Force push failed for ${repoName}: ${msg}`);
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
