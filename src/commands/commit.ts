import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { formatRepoList, pluralRepos } from "../utils/repoList";
import { withRepo } from "./withRepo";

export function registerCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  channel: vscode.OutputChannel
): void {
  const git = repoManager.git;

  /**
   * Upstream name if HEAD is already reachable from it (upstream set and
   * nothing ahead) — rewriting HEAD would then rewrite published history.
   */
  const pushedUpstream = async (repoPath: string): Promise<string | undefined> => {
    try {
      git.invalidateStatus(repoPath);
      const s = await git.status(repoPath);
      return s.upstream && s.ahead === 0 ? s.upstream : undefined;
    } catch {
      return undefined; // can't tell — fall back to the normal confirm
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.commit,
      withRepo(repoManager, async (repoPath) => {
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
        ] as const;
        type PrefixItem = (typeof prefixes)[number];
        const picked: PrefixItem | undefined = await vscode.window.showQuickPick(
          prefixes as unknown as vscode.QuickPickItem[],
          { placeHolder: `Commit type for ${repoName}` }
        ) as PrefixItem | undefined;
        if (!picked) return;

        const isPlain = "_plain" in picked && picked._plain;
        const message = await vscode.window.showInputBox({
          prompt: `Commit message for ${repoName}`,
          placeHolder: isPlain ? "Enter commit message..." : `${picked.label}: describe your change...`,
          value: isPlain ? "" : `${picked.label}: `,
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
      })
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

      const confirm = await vscode.window.showWarningMessage(
        `Commit staged changes in ${pluralRepos(selectedPaths.size)}?`,
        {
          modal: true,
          detail: `Message: ${message.trim()}\n\n${formatRepoList([...selectedPaths].map((p) => path.basename(p)))}`,
        },
        "Commit"
      );
      if (confirm !== "Commit") return;

      channel.show();

      let success = 0;
      let failed = 0;
      const paths = [...selectedPaths];
      const BATCH_SIZE = 10;

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

      const summary = `Diffchestrator: Bulk commit complete. ${success} succeeded, ${failed} failed.`;
      if (failed > 0) vscode.window.showWarningMessage(summary);
      else vscode.window.showInformationMessage(summary);
    })
  );

  // Amend last commit
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.amendCommit,
      withRepo(repoManager, async (repoPath) => {
        const repoName = path.basename(repoPath);

        try {
          const upstream = await pushedUpstream(repoPath);
          if (upstream) {
            const proceed = await vscode.window.showWarningMessage(
              `The last commit in ${repoName} is already pushed to ${upstream}.`,
              {
                modal: true,
                detail:
                  "Amending rewrites published history: you will have to force-push, and anyone who pulled the original commit will diverge.",
              },
              "Amend Anyway"
            );
            if (proceed !== "Amend Anyway") return;
          }
          const lastMessage = await git.lastCommitMessage(repoPath);
          const message = await vscode.window.showInputBox({
            prompt: `Amend last commit in ${repoName}`,
            value: lastMessage,
            placeHolder: "New commit message",
          });
          if (message === undefined) return;

          await git.commitAmend(repoPath, message);
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(`Diffchestrator: Amended commit in ${repoName}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Amend failed for ${repoName}: ${msg}`);
        }
      })
    )
  );

  // Undo last commit (#41)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.undoCommit, withRepo(repoManager, async (repoPath) => {
      const repoName = path.basename(repoPath);
      try {
        const commits = await git.log(repoPath, 1);
        const lastMsg = commits.length > 0 ? commits[0].message : "last commit";
        const upstream = await pushedUpstream(repoPath);
        const confirmLabel = upstream ? "Undo Anyway" : "Undo";
        const confirm = await vscode.window.showWarningMessage(
          upstream
            ? `"${lastMsg}" in ${repoName} is already pushed to ${upstream}. Undo it anyway?`
            : `Undo "${lastMsg}" in ${repoName}? Changes will be kept as staged.`,
          upstream
            ? {
                modal: true,
                detail:
                  "Undoing a pushed commit rewrites published history: the next push will need a force-push, and anyone who pulled it will diverge. Changes will be kept as staged.",
              }
            : { modal: true },
          confirmLabel
        );
        if (confirm !== confirmLabel) return;
        await git.resetSoft(repoPath);
        await repoManager.refreshRepo(repoPath);
        vscode.window.showInformationMessage(`Diffchestrator: Undid last commit in ${repoName}. Changes are staged.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Undo failed: ${msg}`);
      }
    }))
  );
}
