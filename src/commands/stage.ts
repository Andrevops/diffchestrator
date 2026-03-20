import * as vscode from "vscode";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerStageCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = new GitExecutor();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.stageFile,
      async (item?: { repoPath?: string; filePath?: string }) => {
        if (!item?.repoPath || !item?.filePath) {
          vscode.window.showWarningMessage("Diffchestrator: No file selected.");
          return;
        }
        try {
          await git.stage(item.repoPath, [item.filePath]);
          await repoManager.refreshRepo(item.repoPath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Failed to stage file: ${msg}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.unstageFile,
      async (item?: { repoPath?: string; filePath?: string }) => {
        if (!item?.repoPath || !item?.filePath) {
          vscode.window.showWarningMessage("Diffchestrator: No file selected.");
          return;
        }
        try {
          await git.unstage(item.repoPath, [item.filePath]);
          await repoManager.refreshRepo(item.repoPath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Diffchestrator: Failed to unstage file: ${msg}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.stageAll, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repository selected."
        );
        return;
      }
      try {
        const status = await git.status(repoPath);
        const files = [
          ...status.unstaged.map((f) => f.path),
          ...status.untracked.map((f) => f.path),
        ];
        if (files.length === 0) {
          vscode.window.showInformationMessage("Diffchestrator: Nothing to stage.");
          return;
        }
        await git.stage(repoPath, files);
        await repoManager.refreshRepo(repoPath);
        vscode.window.showInformationMessage(
          `Diffchestrator: Staged ${files.length} file${files.length === 1 ? "" : "s"}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Failed to stage all: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.unstageAll, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repository selected."
        );
        return;
      }
      try {
        const status = await git.status(repoPath);
        const files = status.staged.map((f) => f.path);
        if (files.length === 0) {
          vscode.window.showInformationMessage("Diffchestrator: Nothing to unstage.");
          return;
        }
        await git.unstage(repoPath, files);
        await repoManager.refreshRepo(repoPath);
        vscode.window.showInformationMessage(
          `Diffchestrator: Unstaged ${files.length} file${files.length === 1 ? "" : "s"}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Failed to unstage all: ${msg}`);
      }
    })
  );
}
