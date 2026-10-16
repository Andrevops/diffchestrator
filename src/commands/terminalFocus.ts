import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD, CONFIG } from "../constants";
import {
  cycleTerminal,
  closeRepoTerminal,
  findRepoForTerminal,
  navigateTerminal,
  trackedRepoForTerminal,
} from "./terminal";
import { repoNameFromTerminalName } from "./terminalLogic";
import { findOwningRoot } from "../utils/paths";
import { withRepo } from "./withRepo";

/**
 * Suppresses the terminal-click → repo-switch reaction while the extension
 * itself is moving focus between terminals (cycle/nav, viewDiff from a click).
 */
export class TerminalSwitchGuard {
  private _depth = 0;

  get suppressed(): boolean {
    return this._depth > 0;
  }

  async run<T>(fn: () => Thenable<T> | Promise<T>): Promise<T> {
    this._depth++;
    try {
      return await fn();
    } finally {
      this._depth--;
    }
  }
}

/**
 * Terminal ↔ repo focus wiring:
 * - clicking a terminal tab selects its repo (switching roots if needed);
 * - Alt+D terminal cycle / close / next / previous commands.
 */
export function registerTerminalFocus(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  guard: TerminalSwitchGuard
): void {
  /**
   * Locate the repo (in a configured root other than the current one) that a
   * terminal belongs to. Trusts only the tracking map (exact repo path) or an
   * exact terminal name (bare repo name / legacy prefix) whose lookup result
   * has that exact basename.
   */
  const findTerminalInOtherRoots = async (
    terminal: vscode.Terminal
  ): Promise<{ root: string; path: string } | undefined> => {
    const tracked = trackedRepoForTerminal(terminal);
    if (tracked) {
      const roots = vscode.workspace.getConfiguration().get<string[]>(CONFIG.scanRoots, []);
      const root = findOwningRoot(tracked, roots);
      return root && root !== repoManager.currentRoot ? { root, path: tracked } : undefined;
    }
    const candidate = repoNameFromTerminalName(terminal.name);
    if (!candidate) return undefined;
    const match = await repoManager.findRepoInOtherRoots(candidate);
    return match && path.basename(match.path) === candidate ? match : undefined;
  };

  // When user clicks a terminal tab, switch to that repo (full viewDiff flow).
  // If the terminal belongs to a repo in a different root, switch roots first.
  //
  // Rapid-click race: viewDiff/switchRoot are async; a naive handler either
  // drops clicks while one is in-flight (early return on a busy flag) or
  // interleaves N concurrent handlers so the winner is nondeterministic.
  // Instead, queue the latest clicked terminal and run a single worker that
  // re-reads the queue after each await, so the user's LAST click always wins.
  let queuedTerminal: vscode.Terminal | undefined;
  let clickWorkerRunning = false;

  const runClickWorker = async () => {
    if (clickWorkerRunning) return;
    clickWorkerRunning = true;
    try {
      while (queuedTerminal) {
        const terminal = queuedTerminal;
        queuedTerminal = undefined;

        const allPaths = [...repoManager.repos.map((r) => r.path), ...repoManager.directoryPaths];
        const currentRootPaths = new Set(allPaths);
        const repoPath = findRepoForTerminal(terminal, allPaths);

        // Only trust the match if the path belongs to the current root —
        // the tracking map can return stale paths from a previous root.
        if (repoPath && currentRootPaths.has(repoPath)) {
          if (repoPath !== repoManager.selectedRepo) {
            await guard.run(() =>
              vscode.commands.executeCommand(CMD.viewDiff, { path: repoPath, preserveFocus: true })
            );
            // viewDiff closes the previous repo's editor tabs, and tab-close
            // shifts focus to the editor group even though we open files with
            // preserveFocus. Restore focus to the terminal the user clicked.
            terminal.show(false);
          }
          continue;
        }

        // No valid match in current root — search other configured roots,
        // but only for terminals we track or that are named exactly after a
        // repo. A substring match on an arbitrary terminal would trigger a
        // full root rescan and close the user's editors.
        const match = await findTerminalInOtherRoots(terminal);
        if (match) {
          await guard.run(async () => {
            await vscode.commands.executeCommand(CMD.switchRoot, match.root);
            await vscode.commands.executeCommand(CMD.viewDiff, { path: match.path, preserveFocus: true });
            // switchRoot can steal focus; restore it to the terminal the user clicked.
            terminal.show(false);
          });
        }
      }
    } finally {
      clickWorkerRunning = false;
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!terminal || guard.suppressed) return;
      queuedTerminal = terminal;
      void runClickWorker();
    })
  );

  // Cycle terminal — rotate through alive terminals for selected repo
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.cycleTerminal,
      withRepo(repoManager, (repoPath) => guard.run(() => cycleTerminal(repoPath)), { selectedOnly: true })
    )
  );

  // Close terminal — close active or pick which to close
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.closeTerminal,
      withRepo(repoManager, (repoPath) => closeRepoTerminal(repoPath), { selectedOnly: true })
    )
  );

  // Navigate terminals across repos — auto-select the target repo
  const registerNav = (cmd: string, direction: 1 | -1) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(cmd, () =>
        guard.run(async () => {
          const repoPath = await navigateTerminal(direction, [...repoManager.allRepos.map((r) => r.path), ...repoManager.directoryPaths]);
          if (repoPath && repoPath !== repoManager.selectedRepo) {
            // Check if repo is in current root
            const inCurrentRoot = repoManager.allRepos.some((r) => r.path === repoPath);
            if (inCurrentRoot) {
              repoManager.selectRepo(repoPath);
            } else {
              // Try to find in other roots and switch
              const terminal = vscode.window.activeTerminal;
              const match = terminal ? await findTerminalInOtherRoots(terminal) : undefined;
              if (match) {
                await vscode.commands.executeCommand(CMD.switchRoot, match.root);
                repoManager.selectRepo(match.path);
              }
            }
          }
        })
      )
    );
  };
  registerNav(CMD.nextTerminal, 1);
  registerNav(CMD.prevTerminal, -1);
}
