import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { FileStatus } from "../types";

function resolveFileItem(item: any): { repoPath: string; filePath: string; status?: FileStatus } | undefined {
  const repoPath = item?.repoPath;
  const filePath = item?.fileChange?.path ?? item?.filePath;
  const status = item?.fileChange?.status as FileStatus | undefined;
  if (repoPath && filePath) return { repoPath, filePath, status };
  return undefined;
}

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

        const fileName = path.basename(resolved.filePath);
        const isUntracked = resolved.status === FileStatus.Untracked;
        const confirmMsg = isUntracked
          ? `Delete untracked file "${fileName}"? This cannot be undone.`
          : `Discard changes to "${fileName}"? This cannot be undone.`;
        const confirm = await vscode.window.showWarningMessage(
          confirmMsg,
          { modal: true },
          "Yes"
        );

        if (confirm !== "Yes") return;

        try {
          if (isUntracked) {
            await git.cleanFile(resolved.repoPath, resolved.filePath);
          } else {
            await git.checkoutFile(resolved.repoPath, resolved.filePath);
          }
          await repoManager.refreshRepo(resolved.repoPath);
          vscode.window.showInformationMessage(
            `Diffchestrator: Discarded changes to ${fileName}`
          );
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
      async () => {
        const repoPath = repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const repoName = path.basename(repoPath);
        const confirm = await vscode.window.showWarningMessage(
          `Discard ALL changes in "${repoName}"? This will revert modified files and remove untracked files. This cannot be undone.`,
          { modal: true },
          "Yes"
        );

        if (confirm !== "Yes") return;

        try {
          await git.checkoutAll(repoPath);
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
      }
    )
  );
}
