import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { withRepo } from "./withRepo";

export function registerStashCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.stash,
      withRepo(repoManager, async (repoPath) => {
        const repoName = path.basename(repoPath);

        const action = await vscode.window.showQuickPick(
          [
            { label: "$(archive) Stash changes", description: "Save tracked changes (staged + unstaged) to stash", _action: "push" as const },
            { label: "$(archive) Stash changes (include untracked)", description: "Also stash untracked files (git stash -u)", _action: "pushUntracked" as const },
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
            case "push":
            case "pushUntracked": {
              const includeUntracked = action._action === "pushUntracked";
              const message = await vscode.window.showInputBox({
                prompt: "Stash message (optional)",
                placeHolder: "WIP: description",
              });
              if (message === undefined) return; // cancelled
              try {
                await git.stashPush(repoPath, message || undefined, includeUntracked);
              } catch (err: unknown) {
                // Nothing to stash isn't an error — git exits 0 for it
                if (err instanceof Error && /No local changes to save/.test(err.message)) {
                  vscode.window.showInformationMessage(
                    `Diffchestrator: No local changes to save in ${repoName}${includeUntracked ? "" : " (untracked files are only stashed with \"include untracked\")"}.`
                  );
                  return;
                }
                throw err;
              }
              await repoManager.refreshRepo(repoPath);
              vscode.window.showInformationMessage(
                `Diffchestrator: Stashed ${includeUntracked ? "changes and untracked files" : "changes"} in ${repoName}`
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
                description: s.date,
                _index: s.index,
                _sha: s.sha,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a stash to apply",
              });

              if (selected) {
                // SHA guard: fails if the stash stack shifted since listing
                await git.stashApply(repoPath, selected._index, selected._sha || undefined);
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
                _sha: s.sha,
              }));

              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a stash to drop",
              });

              if (selected) {
                const confirm = await vscode.window.showWarningMessage(
                  `Drop stash@{${selected._index}} ("${selected.label}") from ${repoName}?`,
                  { modal: true },
                  "Drop"
                );
                if (confirm === "Drop") {
                  // SHA guard: never drop a different stash if the stack shifted
                  await git.stashDrop(repoPath, selected._index, selected._sha || undefined);
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
      })
    )
  );
}
