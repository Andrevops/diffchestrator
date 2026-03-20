import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerTerminalCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  // Suppress unused parameter warning — repoManager reserved for future use
  void repoManager;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.openTerminal,
      (item?: any) => {
        const targetPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!targetPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        const name = path.basename(targetPath);
        const terminal = vscode.window.createTerminal({
          name: `Terminal - ${name}`,
          cwd: targetPath,
        });
        terminal.show();
      }
    )
  );
}
