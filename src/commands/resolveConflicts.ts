import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { ChangeType } from "../types";
import { resolveRepoPath } from "../utils/fileItem";

/**
 * Open the next conflicted file in the given repo (or the selected repo if no
 * item is passed). Lists all conflicts in a QuickPick when there are many so
 * the user picks which to tackle; opens directly when there's only one.
 *
 * VS Code's built-in conflict markers + "Accept Current/Incoming/Both" code
 * lenses handle the actual resolution — we just surface and navigate.
 */
export function registerResolveConflictsCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.resolveConflicts, async (item?: unknown) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }

      let status;
      try {
        status = await repoManager.git.status(repoPath);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Diffchestrator: Failed to read repo status — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      const conflicts = status.unstaged.filter((f) => f.changeType === ChangeType.Unmerged);
      if (conflicts.length === 0) {
        const stateNote = status.mergeState ? ` (repo is ${status.mergeState} but no files are conflicted)` : "";
        vscode.window.showInformationMessage(`Diffchestrator: No conflicts in this repo${stateNote}.`);
        return;
      }

      const openFile = async (relPath: string) => {
        const uri = vscode.Uri.file(path.join(repoPath, relPath));
        await vscode.commands.executeCommand("vscode.open", uri);
      };

      if (conflicts.length === 1) {
        await openFile(conflicts[0].path);
        return;
      }

      const picked = await vscode.window.showQuickPick(
        conflicts.map((c) => ({
          label: `$(warning) ${c.path}`,
          description: path.dirname(c.path) === "." ? "" : path.dirname(c.path),
          _path: c.path,
        })),
        { placeHolder: `${conflicts.length} conflicted files — pick one to open` }
      );
      if (picked) await openFile(picked._path);
    })
  );
}
