import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { getOrCreateTerminal, validateCli } from "./terminal";
import { escapeForTerminal } from "../utils/shell";
import { resolveRepoPath } from "../utils/fileItem";

const AI_COMMIT_PROMPT =
  "Review the current git changes and create an appropriate commit. " +
  "Stage all relevant files and write a clear conventional commit message. " +
  "Do NOT push.";

// Allowlist of claude CLI permission modes we support. The value is
// interpolated into terminal.sendText, so it MUST be one of these literals.
const VALID_PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions"];

function resolvePermissionMode(configured: string): string {
  // Legacy value from older releases — map to the real CLI mode
  if (configured === "full") return "bypassPermissions";
  return VALID_PERMISSION_MODES.includes(configured) ? configured : "default";
}

export function registerAiCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.aiCommit,
      async (item?: any) => {
        const repoPath =
          resolveRepoPath(item, repoManager.selectedRepo);
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected for AI commit."
          );
          return;
        }

        if (!(await validateCli("claude"))) return;

        const config = vscode.workspace.getConfiguration("diffchestrator");
        const permissionMode = resolvePermissionMode(
          config.get<string>("claudePermissionMode", "acceptEdits")
        );

        const terminal = getOrCreateTerminal(repoPath);
        terminal.show();

        const cmd = `claude --permission-mode ${permissionMode} ${escapeForTerminal(AI_COMMIT_PROMPT)}`;
        terminal.sendText(cmd);

        // Watch .git directory for changes (commits, staging) instead of blind timers
        const gitDir = path.join(repoPath, ".git");
        let debounce: ReturnType<typeof setTimeout> | undefined;
        let watcher: fs.FSWatcher | undefined;
        try {
          watcher = fs.watch(gitDir, { persistent: false }, (_event, filename) => {
            // Trigger on HEAD, index, or refs changes (covers commits and staging)
            if (filename && /^(HEAD|index|COMMIT_EDITMSG|refs)/.test(filename)) {
              if (debounce) clearTimeout(debounce);
              debounce = setTimeout(() => repoManager.refreshRepo(repoPath), 1000);
            }
          });
        } catch {
          // .git may be missing or a file (worktrees/submodules) — skip the watch;
          // the safety timeout and terminal-close listener still handle cleanup/refresh.
        }

        // Clean up watcher after 5 minutes (safety net)
        const cleanup = setTimeout(() => {
          watcher?.close();
          closeListener.dispose();
        }, 5 * 60 * 1000);

        // Also clean up if terminal closes
        const closeListener = vscode.window.onDidCloseTerminal((t) => {
          if (t === terminal) {
            watcher?.close();
            clearTimeout(cleanup);
            closeListener.dispose();
            repoManager.refreshRepo(repoPath);
          }
        });
      }
    )
  );
}
