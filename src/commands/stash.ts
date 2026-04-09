import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { resolveRepoPath } from "../utils/fileItem";

export function registerStashCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.stash,
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

        const action = await vscode.window.showQuickPick(
          [
            { label: "$(archive) Stash changes", description: "Save working directory to stash", _action: "push" as const },
            { label: "$(list-unordered) List stashes", description: "View all stashes", _action: "list" as const },
            { label: "$(debug-step-out) Pop latest stash", description: "Apply and remove most recent stash", _action: "pop" as const },
            { label: "$(history) Apply stash...", description: "Apply a specific stash (keep in list)", _action: "apply" as const },
            { label: "$(trash) Drop stash...", description: "Delete a specific stash", _action: "drop" as const },
          ],
          { placeHolder: `Stash management for ${repoName}` }
        );

        if (!action) return;

        try {
          switch (action._action) {
            case "push": {
              const message = await vscode.window.showInputBox({
                prompt: "Stash message (optional)",
                placeHolder: "WIP: description",
              });
              if (message === undefined) return; // cancelled
              await git.stashPush(repoPath, message || undefined);
              await repoManager.refreshRepo(repoPath);
              vscode.window.showInformationMessage(
                `Diffchestrator: Stashed changes in ${repoName}`
              );
              break;
            }

            case "list": {
              const stashes = await git.stashList(repoPath);
              if (stashes.length === 0) {
                vscode.window.showInformationMessage(
                  `Diffchestrator: No stashes in ${repoName}`
                );
                return;
              }

              const items = stashes.map((s) => ({
                label: s.message,
                _index: s.index,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a stash to view its diff",
              });

              if (selected) {
                const diff = await git.stashShow(repoPath, selected._index);
                if (diff) {
                  const uri = vscode.Uri.parse(
                    `git-show:${repoName}/stash@{${selected._index}}`
                  ).with({
                    query: JSON.stringify({
                      path: "",
                      ref: `stash@{${selected._index}}`,
                      repoPath,
                      fullShow: true,
                    }),
                  });
                  const doc = await vscode.workspace.openTextDocument(uri);
                  await vscode.window.showTextDocument(doc, { preview: true });
                }
              }
              break;
            }

            case "pop": {
              await git.stashPop(repoPath);
              await repoManager.refreshRepo(repoPath);
              vscode.window.showInformationMessage(
                `Diffchestrator: Popped latest stash in ${repoName}`
              );
              break;
            }

            case "apply": {
              const stashes = await git.stashList(repoPath);
              if (stashes.length === 0) {
                vscode.window.showInformationMessage(
                  `Diffchestrator: No stashes in ${repoName}`
                );
                return;
              }

              const items = stashes.map((s) => ({
                label: s.message,
                _index: s.index,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a stash to apply",
              });

              if (selected) {
                await git.stashApply(repoPath, selected._index);
                await repoManager.refreshRepo(repoPath);
                vscode.window.showInformationMessage(
                  `Diffchestrator: Applied stash in ${repoName}`
                );
              }
              break;
            }

            case "drop": {
              const stashes = await git.stashList(repoPath);
              if (stashes.length === 0) {
                vscode.window.showInformationMessage(
                  `Diffchestrator: No stashes in ${repoName}`
                );
                return;
              }

              const items = stashes.map((s) => ({
                label: s.message,
                description: s.date,
                _index: s.index,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a stash to drop",
              });

              if (selected) {
                const confirm = await vscode.window.showWarningMessage(
                  `Drop stash@{${selected._index}} from ${repoName}?`,
                  { modal: true },
                  "Drop"
                );
                if (confirm === "Drop") {
                  await git.stashDrop(repoPath, selected._index);
                  await repoManager.refreshRepo(repoPath);
                  vscode.window.showInformationMessage(
                    `Diffchestrator: Dropped stash in ${repoName}`
                  );
                }
              }
              break;
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Stash operation failed: ${msg}`
          );
        }
      }
    )
  );
}
