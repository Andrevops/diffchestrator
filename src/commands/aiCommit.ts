import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { getOrCreateTerminal, validateCli } from "./terminal";

const AI_COMMIT_PROMPT =
  "Review the current git changes and create an appropriate commit. " +
  "Stage all relevant files and write a clear conventional commit message. " +
  "Do NOT push.";

export function registerAiCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.aiCommit,
      async (item?: any) => {
        const repoPath =
          item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected for AI commit."
          );
          return;
        }

        if (!(await validateCli("claude"))) return;

        const config = vscode.workspace.getConfiguration("diffchestrator");
        const permissionMode = config.get<string>(
          "claudePermissionMode",
          "acceptEdits"
        );

        const terminal = getOrCreateTerminal(repoPath);
        terminal.show();

        // Check if there's already a Claude session running by looking at
        // the terminal name — if we previously sent claude to this terminal,
        // just send the prompt text directly
        const cmd = `claude --permission-mode ${permissionMode} "${AI_COMMIT_PROMPT}"`;
        terminal.sendText(cmd);

        // Refresh after a delay to pick up the commit
        setTimeout(() => repoManager.refreshRepo(repoPath), 15000);
        setTimeout(() => repoManager.refreshRepo(repoPath), 30000);
        setTimeout(() => repoManager.refreshRepo(repoPath), 60000);
      }
    )
  );
}
