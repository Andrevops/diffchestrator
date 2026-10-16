import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import type { FileWatcher } from "../services/fileWatcher";
import type { EditorSessions } from "../services/editorSessions";
import { CMD, CONFIG, VIEW_CHANGED_FILES } from "../constants";
import { openFileDiff } from "./stage";
import { getRepoTerminal, showTerminalIfExists } from "./terminal";
import type { TerminalKind } from "./terminal";
import { ALL_TERMINAL_KINDS } from "./terminalLogic";
import type { TerminalSwitchGuard } from "./terminalFocus";
import { resolveRepoPath } from "../utils/fileItem";
import { withRepo } from "./withRepo";

export interface NavigationDeps {
  repoManager: RepoManager;
  outputChannel: vscode.OutputChannel;
  sessions: EditorSessions;
  fileWatcher: FileWatcher;
  terminalGuard: TerminalSwitchGuard;
  /** Whether the Diffchestrator sidebar is actively shown (focus-steal guard) */
  isSidebarVisible: () => boolean;
  /** Refresh view titles/badges after a swap */
  refreshViewInfo: () => void;
}

/** Command that opens each auto-terminal kind for a repo. */
const AUTO_TERMINAL_COMMANDS: Record<TerminalKind, string> = {
  shell: CMD.openTerminal,
  claude: CMD.openClaudeCode,
  claudenew: CMD.openClaudeCodeNew,
  yolo: CMD.yolo,
  yolonew: CMD.yolonew,
};

const log = (channel: vscode.OutputChannel, tag: string, err: unknown) =>
  channel.appendLine(`[${tag}] ${err instanceof Error ? err.message : err}`);

/**
 * Repo navigation: viewDiff (the central "switch to repo" flow), MRU cycling
 * and swapping, closing active repos, changed-file stepping, multi-select.
 */
export function registerNavigationCommands(context: vscode.ExtensionContext, deps: NavigationDeps): void {
  const { repoManager, outputChannel, sessions, fileWatcher, terminalGuard } = deps;
  const git = repoManager.git;
  let previousRepoPath: string | undefined;

  // View diff — selects repo, shows changed files panel, auto-opens first changed file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.viewDiff,
      withRepo(repoManager, async (repoPath, item) => {
        const preserveFocus = !!item?.preserveFocus;

        // Close editors from the previous repo before switching
        await sessions.duringSwitch(async () => {
          if (previousRepoPath && previousRepoPath !== repoPath) {
            await sessions.closeEditorsForRepo(previousRepoPath);
          }
          previousRepoPath = repoPath;

          repoManager.selectRepo(repoPath);
          // Only steal sidebar focus if diffchestrator panel is already visible
          // and caller isn't preserving focus (e.g. terminal-tab click).
          if (deps.isSidebarVisible() && !preserveFocus) {
            await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
          }
          // Don't override user's terminal choice: skip when a programmatic terminal
          // switch is running (cycle/nav) or when the caller preserves focus (terminal click).
          if (!terminalGuard.suppressed && !preserveFocus) {
            await showTerminalIfExists(repoPath);
          }

          // Auto-open configured terminal types — only if not already running
          const autoTerminals = vscode.workspace.getConfiguration().get<string[]>(CONFIG.autoTerminals, []);
          // Skip entirely if repo already has ANY terminals (tracked or untracked)
          const repoBasename = path.basename(repoPath);
          const hasExistingTerminals = vscode.window.terminals.some((t) => t.name === repoBasename);
          for (const kind of autoTerminals) {
            const command = AUTO_TERMINAL_COMMANDS[kind as TerminalKind];
            if (!command) continue;
            if (getRepoTerminal(repoPath, kind as TerminalKind)) continue;
            if (hasExistingTerminals) continue;
            // Explicit { path } — never the multi-repo launcher
            await vscode.commands.executeCommand(command, { path: repoPath });
          }
        });

        // Directory entries: terminal only, no file operations
        if (repoManager.isDirectory(repoPath)) return;

        // Returning to a repo whose tabs we closed on switch-away: restore the
        // whole session instead of opening the first changed file.
        try {
          if (await sessions.restoreEditorsForRepo(repoPath, preserveFocus)) return;
        } catch (err) {
          log(outputChannel, "restore tabs", err);
        }

        // Priority: changed files first (review workflow), then remembered file
        try {
          const status = await git.status(repoPath);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            await openFileDiff(repoPath, firstFile, { preserveFocus });
          } else {
            // No changes — restore remembered file if we have one
            const remembered = sessions.rememberedFile(repoPath);
            if (remembered) {
              try {
                if (remembered.scheme === "file") {
                  await vscode.window.showTextDocument(remembered, { preview: false, preserveFocus });
                } else {
                  const doc = await vscode.workspace.openTextDocument(remembered);
                  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
                }
              } catch (err) {
                log(outputChannel, "restore file", err);
                sessions.forgetRememberedFile(repoPath);
                if (!preserveFocus) {
                  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                }
              }
            } else if (!preserveFocus) {
              await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
          }
        } catch (err) {
          log(outputChannel, "viewDiff", err);
        }
      })
    )
  );

  // Cycle through active/recent repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cycleActiveRepo, async () => {
      const nextPath = repoManager.cycleNextRepo();
      if (!nextPath) {
        vscode.window.showInformationMessage("Diffchestrator: No other recent repos to cycle to.");
        return;
      }
      // Use viewDiff to switch terminal + open diff, but the MRU list
      // is already rotated by cycleNextRepo so it won't re-sort.
      await vscode.commands.executeCommand(CMD.viewDiff, { path: nextPath });
    })
  );

  // Swap between current and previous repo (works across roots)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.swapRepo, async () => {
      const target = repoManager.swapTarget;
      if (!target) {
        vscode.window.showInformationMessage("Diffchestrator: No previous repo to swap to.");
        return;
      }
      // Save where we are now before swapping
      const current = repoManager.selectedRepo;
      const currentRoot = repoManager.currentRoot;

      repoManager.beginSwap();
      try {
        // Step 1: Switch root if needed (and wait for it to fully complete)
        if (target.root && target.root !== repoManager.currentRoot) {
          await repoManager.scan(target.root);
          fileWatcher.watchAll();
          // Wait for coalesced events to settle
          await new Promise((r) => setTimeout(r, 100));
        }

        // Step 2: Select the repo
        repoManager.selectRepo(target.path);

        // Step 3: Focus changed files view (only if diffchestrator sidebar is already active)
        if (deps.isSidebarVisible()) {
          await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
        }

        // Step 4: Switch terminal
        await showTerminalIfExists(target.path);

        // Step 5: Open first changed file if any
        try {
          const status = await git.status(target.path);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            await openFileDiff(target.path, firstFile);
          }
        } catch { /* non-critical */ }
      } finally {
        repoManager.endSwap();
      }

      // Set swap target to where we just came from
      if (current) {
        repoManager.setSwapTarget({ path: current, root: currentRoot });
      }

      // Force UI refresh
      deps.refreshViewInfo();
    })
  );

  // Close active repo from recent list
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeActiveRepo, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      // Close terminals if autoTerminals is configured
      const autoTerminals = vscode.workspace.getConfiguration().get<string[]>(CONFIG.autoTerminals, []);
      const toDispose =
        autoTerminals.length > 0 || repoManager.isDirectory(repoPath)
          ? ALL_TERMINAL_KINDS.flatMap((k) => {
              const t = getRepoTerminal(repoPath, k);
              return t ? [{ kind: k, terminal: t }] : [];
            })
          : [];
      // Agent sessions may hold unsaved conversation state / running work —
      // never kill them without asking.
      const agents = toDispose.filter((t) => t.kind !== "shell");
      if (agents.length > 0) {
        const choice = await vscode.window.showWarningMessage(
          `Close ${path.basename(repoPath)}? This also closes its running ${agents.map((a) => a.kind).join(", ")} terminal${agents.length > 1 ? "s" : ""}.`,
          { modal: true },
          "Close Repo and Terminals",
          "Close Repo Only"
        );
        if (!choice) return;
        if (choice === "Close Repo Only") toDispose.length = 0;
      }
      await sessions.closeEditorsForRepo(repoPath);
      for (const { terminal } of toDispose) terminal.dispose();
      repoManager.closeRecentRepo(repoPath);
      // Switch to next repo if one exists
      const next = repoManager.selectedRepo;
      if (next) {
        await vscode.commands.executeCommand(CMD.viewDiff, { path: next });
      }
    })
  );

  // Pick which active repo to close
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closePickedRepo, async () => {
      const recent = repoManager.recentRepoPaths;
      if (recent.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: No active repos.");
        return;
      }
      const items = recent.map((p) => ({
        label: `$(repo) ${path.basename(p)}`,
        description: p === repoManager.selectedRepo ? "● active" : "",
        _repoPath: p,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Close which active repo?",
      });
      if (selected) {
        await sessions.closeEditorsForRepo(selected._repoPath);
        repoManager.closeRecentRepo(selected._repoPath);
        const next = repoManager.selectedRepo;
        if (next) {
          await vscode.commands.executeCommand(CMD.viewDiff, { path: next });
        }
      }
    })
  );

  // Close all active repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeAllActiveRepos, async () => {
      const recent = [...repoManager.recentRepoPaths];
      for (const p of recent) {
        await sessions.closeEditorsForRepo(p);
      }
      repoManager.clearAllRecentRepos();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    })
  );

  // Navigate changed files without staging
  const stepChangedFile = async (direction: 1 | -1) => {
    const repoPath = repoManager.selectedRepo;
    if (!repoPath) return;
    let status;
    try {
      status = await git.status(repoPath);
    } catch {
      return; // git status failed (repo deleted, index.lock, …) — no-op
    }
    const allFiles = [...status.unstaged, ...status.untracked, ...status.staged];
    if (allFiles.length === 0) return;

    // Find current file in the list
    const currentPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const currentRel = currentPath ? path.relative(repoPath, currentPath) : "";
    const currentIdx = allFiles.findIndex((f) => f.path === currentRel);
    const targetIdx =
      direction === 1
        ? (currentIdx >= 0 ? (currentIdx + 1) % allFiles.length : 0)
        : (currentIdx > 0 ? currentIdx - 1 : allFiles.length - 1);

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await openFileDiff(repoPath, allFiles[targetIdx]);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.nextChangedFile, () => stepChangedFile(1)),
    vscode.commands.registerCommand(CMD.prevChangedFile, () => stepChangedFile(-1))
  );

  // Select / deselect repo (multi-select toggle)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.selectRepo, (item?: any) => {
      const p = resolveRepoPath(item, repoManager.selectedRepo);
      if (p) repoManager.toggleRepoSelection(p);
    }),
    // Clear multi-selection
    vscode.commands.registerCommand(CMD.clearSelection, () => repoManager.clearMultiSelection()),
    // Select all active/recent repos
    vscode.commands.registerCommand(CMD.selectAllActive, () => {
      for (const p of repoManager.recentRepoPaths) {
        if (!repoManager.selectedRepoPaths.has(p)) {
          repoManager.toggleRepoSelection(p);
        }
      }
    }),
    vscode.commands.registerCommand(CMD.deselectAll, () => repoManager.clearMultiSelection())
  );
}
