import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerSwitchBranchCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.switchBranch,
      async (item?: any) => {
        const repoPath =
          item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const repoName = path.basename(repoPath);

        try {
          const branches = await git.branches(repoPath);

          const items: (vscode.QuickPickItem & { _branch?: string; _create?: boolean })[] = [
            {
              label: "$(add) Create new branch...",
              description: "",
              _create: true,
            },
            { label: "", kind: vscode.QuickPickItemKind.Separator },
          ];

          for (const b of branches) {
            items.push({
              label: `${b.current ? "$(check) " : "    "}${b.name}`,
              description: b.current ? "current" : "",
              _branch: b.name,
            });
          }

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Switch branch in ${repoName}`,
            matchOnDescription: true,
          });

          if (!selected) return;

          if (selected._create) {
            const branchName = await vscode.window.showInputBox({
              prompt: "Enter new branch name",
              placeHolder: "feature/my-branch",
              validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                  return "Branch name cannot be empty";
                }
                if (/\s/.test(value)) {
                  return "Branch name cannot contain spaces";
                }
                return null;
              },
            });

            if (!branchName) return;

            try {
              await git.createBranch(repoPath, branchName.trim());
              await repoManager.refreshRepo(repoPath);
              vscode.window.showInformationMessage(
                `Diffchestrator: Created and switched to ${branchName.trim()}`
              );
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(
                `Diffchestrator: Failed to create branch: ${msg}`
              );
            }
          } else if (selected._branch) {
            try {
              await git.checkout(repoPath, selected._branch);
              await repoManager.refreshRepo(repoPath);
              vscode.window.showInformationMessage(
                `Diffchestrator: Switched to ${selected._branch}`
              );
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(
                `Diffchestrator: Failed to switch branch: ${msg}`
              );
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Diffchestrator: Failed to list branches: ${msg}`
          );
        }
      }
    )
  );
}
