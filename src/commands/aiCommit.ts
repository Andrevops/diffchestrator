import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { RepoManager } from "../services/repoManager";
import { CMD, CONFIG } from "../constants";
import { terminalIcon, validateCli } from "./terminal";
import { markDedicatedTerminal } from "./terminalLogic";
import { escapeForTerminal } from "../utils/shell";
import { withRepo } from "./withRepo";

const AI_COMMIT_PROMPT =
  "Review the current git changes and create an appropriate commit. " +
  "Stage all relevant files and write a clear conventional commit message. " +
  "Do NOT push.";

// Allowlist of claude CLI permission modes we support. The value is
// interpolated into the terminal command, so it MUST be one of these literals.
const VALID_PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions"];

export function resolvePermissionMode(configured: string | undefined): string {
  // Legacy value from older releases — map to the real CLI mode
  if (configured === "full") return "bypassPermissions";
  return configured && VALID_PERMISSION_MODES.includes(configured) ? configured : "default";
}

/** How long to wait for shell integration before falling back to sendText. */
const SHELL_INTEGRATION_TIMEOUT_MS = 3000;

/**
 * AI-commit terminals the extension created, per repo. A terminal is only
 * reused when shell integration confirmed its previous run finished —
 * otherwise (claude still running, or unknown) a fresh terminal is created,
 * so text is never typed into an interactive session.
 */
const sessions = new Map<string, { terminal: vscode.Terminal; idle: boolean }>();

function isAlive(t: vscode.Terminal): boolean {
  return vscode.window.terminals.includes(t);
}

function waitForShellIntegration(
  terminal: vscode.Terminal
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listener.dispose();
      resolve(terminal.shellIntegration);
    }, SHELL_INTEGRATION_TIMEOUT_MS);
    const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal !== terminal) return;
      clearTimeout(timer);
      listener.dispose();
      resolve(e.shellIntegration);
    });
  });
}

export function registerAiCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      for (const [repo, s] of sessions) {
        if (s.terminal === t) sessions.delete(repo);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.aiCommit,
      withRepo(repoManager, async (repoPath) => {
        if (!(await validateCli("claude"))) return;

        const permissionMode = resolvePermissionMode(
          vscode.workspace.getConfiguration().get<string>(CONFIG.claudePermissionMode, "acceptEdits")
        );

        // Dedicated terminal: never the repo's shell (which may be running an
        // interactive claude, or be a foreign terminal).
        const prev = sessions.get(repoPath);
        let terminal: vscode.Terminal;
        if (prev && prev.idle && isAlive(prev.terminal)) {
          terminal = prev.terminal;
        } else {
          terminal = vscode.window.createTerminal({
            name: path.basename(repoPath),
            cwd: repoPath,
            iconPath: terminalIcon("aiCommit"),
          });
          markDedicatedTerminal(terminal, repoPath);
        }
        const session = { terminal, idle: false };
        sessions.set(repoPath, session);
        terminal.show();

        const cmd = `claude --permission-mode ${permissionMode} ${escapeForTerminal(AI_COMMIT_PROMPT)}`;

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

        const disposables: vscode.Disposable[] = [];
        let finished = false;
        const finish = (refresh: boolean) => {
          if (finished) return;
          finished = true;
          watcher?.close();
          if (debounce) clearTimeout(debounce);
          clearTimeout(cleanup);
          for (const d of disposables) d.dispose();
          if (refresh) void repoManager.refreshRepo(repoPath);
        };

        // Clean up watcher after 5 minutes (safety net)
        const cleanup = setTimeout(() => finish(false), 5 * 60 * 1000);

        // Also clean up if terminal closes
        disposables.push(
          vscode.window.onDidCloseTerminal((t) => {
            if (t === terminal) finish(true);
          })
        );

        // Prefer shell integration: runs the command as a tracked execution
        // (no keystroke injection) and tells us when it finished.
        const integration = await waitForShellIntegration(terminal);
        if (integration) {
          const execution = integration.executeCommand(cmd);
          disposables.push(
            vscode.window.onDidEndTerminalShellExecution((e) => {
              if (e.execution !== execution) return;
              session.idle = true; // safe to reuse for the next AI commit
              finish(true);
            })
          );
        } else {
          terminal.sendText(cmd);
        }
      }, { message: "Diffchestrator: No repository selected for AI commit." })
    )
  );
}
