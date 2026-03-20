import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

/** Map of repo path → terminal, so we can reuse them */
const repoTerminals = new Map<string, vscode.Terminal>();

// Clean up map when terminals close
vscode.window.onDidCloseTerminal((t) => {
  for (const [key, term] of repoTerminals) {
    if (term === t) {
      repoTerminals.delete(key);
      break;
    }
  }
});

/**
 * Get or create a terminal for a repo path.
 * If one exists and is still open, reuse it.
 */
export function getOrCreateTerminal(repoPath: string): vscode.Terminal {
  const existing = repoTerminals.get(repoPath);
  // Check if terminal is still alive (not disposed)
  if (existing && vscode.window.terminals.includes(existing)) {
    return existing;
  }

  const name = path.basename(repoPath);
  const terminal = vscode.window.createTerminal({
    name: `DC: ${name}`,
    cwd: repoPath,
  });
  repoTerminals.set(repoPath, terminal);
  return terminal;
}

export function registerTerminalCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  void repoManager;

  // Open terminal
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.openTerminal,
      (item?: any) => {
        const targetPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!targetPath) {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
          return;
        }
        const terminal = getOrCreateTerminal(targetPath);
        terminal.show();
      }
    )
  );

  // Yolo — open terminal with claude sandbox yolo alias
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.yolo,
      (item?: any) => {
        const targetPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!targetPath) {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
          return;
        }
        const name = path.basename(targetPath);
        // Always create a new terminal for yolo (sandbox session)
        const terminal = vscode.window.createTerminal({
          name: `YOLO: ${name}`,
          cwd: targetPath,
        });
        terminal.show();
        terminal.sendText("yolo");
      }
    )
  );
}
