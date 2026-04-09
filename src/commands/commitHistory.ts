import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { timeAgo } from "../utils/time";
import { resolveRepoPath } from "../utils/fileItem";

export function registerCommitHistoryCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.commitHistory,
      async (item?: any) => {
        const repoPath =
          resolveRepoPath(item, repoManager.selectedRepo);
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const repoName = path.basename(repoPath);

        try {
          const commits = await git.log(repoPath, 15);
          if (commits.length === 0) {
            vscode.window.showInformationMessage(
              `Diffchestrator: No commits found in ${repoName}.`
            );
            return;
          }

          const items = commits.map((c) => ({
            label: `$(git-commit) ${c.shortHash}  ${c.message}`,
            description: `${c.author}, ${timeAgo(c.date)}`,
            detail: c.hash,
            _hash: c.hash,
            _repoPath: repoPath,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Commit history for ${repoName}`,
            matchOnDescription: true,
            matchOnDetail: true,
          });

          if (selected) {
            const uri = vscode.Uri.parse(
              `git-show:${repoName}/${selected._hash.slice(0, 8)}`
            ).with({
              query: JSON.stringify({
                path: "",
                ref: selected._hash,
                repoPath: selected._repoPath,
                fullShow: true,
              }),
            });

            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Failed to get commit history: ${msg}`
          );
        }
      }
    )
  );
}
