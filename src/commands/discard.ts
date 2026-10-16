import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { withRepo } from "./withRepo";
import { CMD } from "../constants";
import { ChangeType } from "../types";
import { resolveFileItem, resolveFileStatus } from "../utils/fileItem";
import { planDiscard } from "./discardLogic";

export function registerDiscardCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  // Discard single file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.discardFile,
      async (item?: any) => {
        const resolved = resolveFileItem(item);
        if (!resolved) {
          vscode.window.showWarningMessage("Diffchestrator: No file selected.");
          return;
        }
        const { repoPath, filePath } = resolved;
        const fileName = path.basename(filePath);

        try {
          // Ask git for the file's current state: the tree item only knows
          // which group it was in, but a file can be staged AND modified, and
          // `checkout --` restores from the index (staged changes survive).
          git.invalidateStatus(repoPath);
          const status = await git.status(repoPath);
          const stagedChange = status.staged.find((f) => f.path === filePath);
          const prompt = planDiscard(fileName, {
            itemStatus: resolveFileStatus(item),
            staged: !!stagedChange,
            unstaged: status.unstaged.some((f) => f.path === filePath),
            untracked: status.untracked.some((f) => f.path === filePath),
            addedInIndex: stagedChange?.changeType === ChangeType.Added,
          });
          if (!prompt) {
            vscode.window.showInformationMessage(`Diffchestrator: No changes to discard in ${fileName}.`);
            await repoManager.refreshRepo(repoPath);
            return;
          }

          const picked = await vscode.window.showWarningMessage(
            prompt.message,
            { modal: true },
            ...prompt.choices.map((c) => c.label)
          );
          const choice = prompt.choices.find((c) => c.label === picked);
          if (!choice) return;

          switch (choice.action) {
            case "clean":
              await git.cleanFile(repoPath, filePath);
              break;
            case "checkout":
              await git.checkoutFile(repoPath, filePath);
              break;
            case "restoreHead":
              await git.restoreFileFromHead(repoPath, filePath);
              break;
          }
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(`Diffchestrator: ${choice.done}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Failed to discard: ${msg}`
          );
        }
      }
    )
  );

  // Discard all changes
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.discardAll,
      withRepo(repoManager, async (repoPath) => {
        const repoName = path.basename(repoPath);
        const confirm = await vscode.window.showWarningMessage(
          `Discard ALL changes in "${repoName}"? This will revert modified files and remove untracked files. This cannot be undone.`,
          { modal: true },
          "Yes"
        );

        if (confirm !== "Yes") return;

        try {
          // reset --hard discards BOTH staged and unstaged changes
          // (checkout -- . restores from the index, so staged changes survive)
          await git.resetHard(repoPath);
          await git.clean(repoPath);
          await repoManager.refreshRepo(repoPath);
          vscode.window.showInformationMessage(
            `Diffchestrator: Discarded all changes in ${repoName}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Failed to discard all: ${msg}`
          );
        }
      }, { selectedOnly: true })
    )
  );
}
