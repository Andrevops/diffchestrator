import * as vscode from "vscode";
import * as path from "path";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { FileStatus, ChangeType } from "../types";
import type { FileChange } from "../types";
import { resolveFileItem } from "../utils/fileItem";

/**
 * Open the diff (or plain file) for a given FileChange — same logic as
 * ChangedFilesProvider so the review experience is consistent.
 */
export async function openFileDiff(repoPath: string, fc: FileChange): Promise<void> {
  const fileName = path.basename(fc.path);

  if (fc.status === FileStatus.Untracked) {
    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.file(path.join(repoPath, fc.path))
    );
    return;
  }

  const staged = fc.status === FileStatus.Staged;

  // Left side: always HEAD for the committed version
  const leftUri = vscode.Uri.parse(
    `git-show:${path.join(repoPath, fc.path)}`
  ).with({
    query: JSON.stringify({ path: fc.path, ref: "HEAD", repoPath }),
  });

  if (fc.changeType === ChangeType.Deleted) {
    await vscode.commands.executeCommand("vscode.open", leftUri);
    return;
  }

  // Right side: index (:0) for staged, working tree file for unstaged
  const rightUri = staged
    ? vscode.Uri.parse(
        `git-show:${path.join(repoPath, fc.path)}`
      ).with({
        query: JSON.stringify({ path: fc.path, ref: ":0", repoPath }),
      })
    : vscode.Uri.file(path.join(repoPath, fc.path));

  await vscode.commands.executeCommand(
    "vscode.diff",
    leftUri,
    rightUri,
    `${fileName} (${staged ? "Staged" : "Working Tree"})`
  );
}

/**
 * After staging/unstaging, open the next file pending review.
 * "Next" = first unstaged file, then first untracked file.
 * If nothing remains, do nothing (all reviewed).
 */
export async function openNextPendingFile(git: GitExecutor, repoPath: string, justStaged: string): Promise<void> {
  try {
    const status = await git.status(repoPath);
    const candidates = [
      ...status.unstaged.filter(f => f.path !== justStaged),
      ...status.untracked.filter(f => f.path !== justStaged),
    ];

    if (candidates.length > 0) {
      // Close the current diff editor so VS Code opens a fresh one
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openFileDiff(repoPath, candidates[0]);
    }
  } catch {
    // Non-critical — tree still refreshes
  }
}

export function registerStageCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.stageFile,
      async (item?: any) => {
        const resolved = resolveFileItem(item);
        if (!resolved) {
          vscode.window.showWarningMessage("Diffchestrator: No file selected.");
          return;
        }
        try {
          await git.stage(resolved.repoPath, [resolved.filePath]);
          await repoManager.refreshRepo(resolved.repoPath);
          await openNextPendingFile(git, resolved.repoPath, resolved.filePath);
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
      async (item?: any) => {
        const resolved = resolveFileItem(item);
        if (!resolved) {
          vscode.window.showWarningMessage("Diffchestrator: No file selected.");
          return;
        }
        try {
          await git.unstage(resolved.repoPath, [resolved.filePath]);
          await repoManager.refreshRepo(resolved.repoPath);
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
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
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
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
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
