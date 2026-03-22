import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { registerRepoTerminal, getRepoTerminal } from "./terminal";

export function registerClaudeCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.openClaudeCode,
      (item?: any) => {
        const selectedPaths = repoManager.selectedRepoPaths;
        const singlePath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;

        if (selectedPaths.size > 1) {
          // Multi-repo mode: open claude with --add-dir for each selected repo
          const addDirArgs = [...selectedPaths]
            .map((p) => `--add-dir "${p}"`)
            .join(" ");

          const terminal = vscode.window.createTerminal({
            name: "Claude Code (multi-repo)",
            cwd: repoManager.currentRoot,
          });
          terminal.show();
          terminal.sendText(`claude ${addDirArgs}`);
        } else if (singlePath) {
          // Single repo mode — reuse existing terminal if alive
          const existing = getRepoTerminal(singlePath);
          if (existing) {
            existing.show();
            return;
          }

          const repoName = path.basename(singlePath);
          const terminal = vscode.window.createTerminal({
            name: `Claude: ${repoName}`,
            cwd: singlePath,
          });
          registerRepoTerminal(singlePath, terminal);
          terminal.show();
          terminal.sendText("claude");
        } else {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected. Select a repo first."
          );
        }
      }
    )
  );
}
