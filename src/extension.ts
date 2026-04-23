import * as vscode from "vscode";
import { RepoManager } from "./services/repoManager";
import { RepoTreeProvider } from "./providers/repoTreeProvider";
import { ChangedFilesProvider } from "./providers/changedFilesProvider";
import { escapeForTerminal } from "./utils/shell";
import { CMD, VIEW_ACTIVE_REPOS, VIEW_REPOS, VIEW_CHANGED_FILES, BATCH_SMALL } from "./constants";
import { registerScanCommands } from "./commands/scan";
import { registerStageCommands, openNextPendingFile, openFileDiff } from "./commands/stage";
import { registerCommitCommands } from "./commands/commit";
import { registerPushCommands } from "./commands/push";
import { registerPullCommands } from "./commands/pull";
import { registerAiCommitCommands } from "./commands/aiCommit";
import { registerClaudeCommands } from "./commands/openClaude";
import { registerFavoriteCommands } from "./commands/favorites";
import { registerFileSearchCommand } from "./commands/fileSearch";
import { registerTerminalCommand } from "./commands/terminal";
import { registerCommitHistoryCommands } from "./commands/commitHistory";
import { registerDiscardCommands } from "./commands/discard";
import { registerSwitchBranchCommands } from "./commands/switchBranch";
import { registerStashCommands } from "./commands/stash";
import { ActiveReposProvider } from "./providers/activeReposProvider";
import { GitContentProvider } from "./providers/gitContentProvider";
import { DiffWebviewPanel } from "./views/diffWebviewPanel";
import { DashboardWebviewPanel } from "./views/dashboardWebviewPanel";
import { FileWatcher } from "./services/fileWatcher";
import { InlineBlameService } from "./services/inlineBlame";
import { WorkspaceAutoScan } from "./services/workspaceAutoScan";
// GitExecutor accessed via repoManager.git (shared instance)
import { showTerminalIfExists, findRepoForTerminal, cycleTerminal, closeRepoTerminal, navigateTerminal, terminalIcon, adoptExistingTerminals, getRepoTerminal, registerRepoTerminal } from "./commands/terminal";
import type { TerminalKind } from "./commands/terminal";
import { extractTabUri } from "./types";
import { resolveRepoPath } from "./utils/fileItem";
import * as path from "path";

/** Public API for sibling extensions (e.g. Epic Lens) */
export interface DiffchestratorApi {
  /** Currently active scan root (e.g. /home/user/RealManage) */
  getCurrentRoot(): string | undefined;
  /** Currently selected repo path */
  getSelectedRepo(): string | undefined;
  /** Fires when the active root or selection changes */
  onDidChangeSelection: vscode.Event<void>;
}

export function activate(context: vscode.ExtensionContext): DiffchestratorApi {
  // Check git is installed (sync with timeout — faster than async for a single quick check)
  const { execFileSync } = require("child_process");
  let gitInstalled = false;
  try {
    execFileSync("git", ["--version"], { timeout: 5000 });
    gitInstalled = true;
  } catch { /* git missing or timed out */ }
  if (!gitInstalled) {
    vscode.window.showErrorMessage(
      "Diffchestrator: Git is not installed or not on PATH. The extension requires git to function.",
      "Install Git"
    ).then((action) => {
      if (action === "Install Git") {
        vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"));
      }
    });
    // Return stub API so consumers don't crash
    const noop = new vscode.EventEmitter<void>();
    context.subscriptions.push(noop);
    return {
      getCurrentRoot: () => undefined,
      getSelectedRepo: () => undefined,
      onDidChangeSelection: noop.event,
    };
  }

  const sessionStartTime = Date.now();
  const repoManager = new RepoManager(context.workspaceState);
  context.subscriptions.push(repoManager);

  // Shared output channel for logging
  const outputChannel = vscode.window.createOutputChannel("Diffchestrator");
  context.subscriptions.push(outputChannel);
  repoManager.setLogger((msg) => outputChannel.appendLine(msg));

  // Track last open file per repo so switching back restores context (LRU, max 20)
  const MAX_LAST_OPEN = 20;
  const lastOpenFile = new Map<string, vscode.Uri>();
  const capLastOpenFile = () => {
    while (lastOpenFile.size > MAX_LAST_OPEN) {
      const oldest = lastOpenFile.keys().next().value!;
      lastOpenFile.delete(oldest);
    }
  };
  let switchingRepo = false; // flag to ignore editor changes during repo switch

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (switchingRepo) return; // ignore changes caused by repo switch
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;

      if (!editor) {
        // All editors closed while user is in this repo — clear memory
        lastOpenFile.delete(repoPath);
        return;
      }

      const uri = editor.document.uri;
      if (uri.scheme === "file" && uri.fsPath.startsWith(repoPath)) {
        lastOpenFile.delete(repoPath); // re-insert at end for LRU
        lastOpenFile.set(repoPath, uri);
        capLastOpenFile();
      } else if (uri.scheme === "git-show") {
        lastOpenFile.delete(repoPath);
        lastOpenFile.set(repoPath, uri);
        capLastOpenFile();
      }
    })
  );

  // When user clicks a terminal tab, switch to that repo (full viewDiff flow).
  // If the terminal belongs to a repo in a different root, switch roots first.
  //
  // Rapid-click race: viewDiff/switchRoot are async; a naive handler either
  // drops clicks while one is in-flight (early return on a busy flag) or
  // interleaves N concurrent handlers so the winner is nondeterministic.
  // Instead, queue the latest clicked terminal and run a single worker that
  // re-reads the queue after each await, so the user's LAST click always wins.
  let suppressTerminalSwitch = false;
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
            await vscode.commands.executeCommand(CMD.viewDiff, { path: repoPath, preserveFocus: true });
          }
          continue;
        }

        // No valid match in current root — search other configured roots
        const match = repoManager.findRepoInOtherRoots(terminal.name);
        if (match) {
          await vscode.commands.executeCommand(CMD.switchRoot, match.root);
          if (queuedTerminal) continue; // newer click queued while switching roots
          await vscode.commands.executeCommand(CMD.viewDiff, { path: match.path, preserveFocus: true });
          if (queuedTerminal) continue; // newer click queued while viewing diff
          // switchRoot can steal focus; restore it to the terminal the user clicked.
          terminal.show(false);
        }
      }
    } finally {
      clickWorkerRunning = false;
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!terminal || suppressTerminalSwitch) return;
      queuedTerminal = terminal;
      void runClickWorker();
    })
  );

  // Tree views
  const activeRepos = new ActiveReposProvider(repoManager);
  const repoTree = new RepoTreeProvider(repoManager);
  context.subscriptions.push(repoTree);
  const changedFiles = new ChangedFilesProvider(repoManager);

  // Git content provider for diff URIs
  const gitContentProvider = new GitContentProvider(repoManager.git);
  // Create tree views (not just providers) so we can set description + badge
  const activeReposView = vscode.window.createTreeView(VIEW_ACTIVE_REPOS, { treeDataProvider: activeRepos });
  const repoTreeView = vscode.window.createTreeView(VIEW_REPOS, { treeDataProvider: repoTree });
  const changedFilesView = vscode.window.createTreeView(VIEW_CHANGED_FILES, { treeDataProvider: changedFiles });

  // Track whether diffchestrator sidebar is actively visible (not just existing)
  let sidebarVisible = false;
  changedFilesView.onDidChangeVisibility((e) => { sidebarVisible = e.visible; });
  activeReposView.onDidChangeVisibility((e) => { if (e.visible) sidebarVisible = true; });
  repoTreeView.onDidChangeVisibility((e) => { if (e.visible) sidebarVisible = true; });

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("git-show", gitContentProvider),
    gitContentProvider,
    activeReposView,
    repoTreeView,
    changedFilesView,
  );

  // Refresh git content provider when repos change (invalidates stale diffs)
  // Also close diff tabs for files that are no longer changed
  repoManager.onDidChangeRepos(async () => {
    gitContentProvider.refresh();

    // Close stale diff tabs for the selected repo
    const repoPath = repoManager.selectedRepo;
    if (!repoPath) return;
    const repo = repoManager.getRepo(repoPath);
    if (!repo || repo.totalChanges > 0) return; // still has changes, don't close

    // Repo is clean — close any open git-show tabs for it
    const tabsToClose: vscode.Tab[] = [];
    for (const tab of vscode.window.tabGroups.all.flatMap((g) => g.tabs)) {
      const uri = extractTabUri(tab.input);
      if (uri?.scheme === "git-show") {
        try {
          const params = JSON.parse(uri.query);
          if (params.repoPath === repoPath) {
            tabsToClose.push(tab);
          }
        } catch { /* ignore */ }
      }
    }
    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose);
    }
  });

  // Update view descriptions + badge when state changes
  const updateViewInfo = () => {
    const repos = repoManager.repos;
    const totalChanges = repos.reduce((sum, r) => sum + r.totalChanges, 0);

    // Repos view: show root name + count
    const rootName = repoManager.currentRoot ? path.basename(repoManager.currentRoot) : "";
    const countLabel = repoManager.changedOnly
      ? `${repos.filter(r => r.totalChanges > 0).length} changed`
      : `${repos.length} repos`;
    const tagLabel = repoManager.activeTagFilter ? `#${repoManager.activeTagFilter}` : "";
    const descParts = [rootName, tagLabel, countLabel].filter(Boolean);
    repoTreeView.description = descParts.join(" — ");

    // Active Repos view: show root name + summary
    const activeDesc = [rootName, `${repos.length} repos`, totalChanges > 0 ? `${totalChanges} changes` : ""].filter(Boolean);
    activeReposView.description = activeDesc.join(" · ") || undefined;

    // Activity bar badge: total changes across all repos
    repoTreeView.badge = totalChanges > 0
      ? { value: totalChanges, tooltip: `${totalChanges} total changes` }
      : undefined;

    // Changed files view: show active repo name + branch
    const selected = repoManager.selectedRepo;
    if (selected) {
      const repo = repos.find(r => r.path === selected);
      const name = selected.split("/").pop() ?? "";
      const branch = repo?.branch ?? "";
      const changes = repo?.totalChanges ?? 0;
      changedFilesView.description = `${name} (${branch})${changes > 0 ? ` — ${changes} changes` : ""}`;
    } else {
      changedFilesView.description = undefined;
    }
  };

  repoManager.onDidChangeRepos(updateViewInfo);
  repoManager.onDidChangeSelection(updateViewInfo);

  // Notifications when Claude/external tools commit or modify files
  // Queue notifications when unfocused, show grouped summary on refocus
  const sharedGit = repoManager.git;
  const pendingNotifications: { type: "commit" | "changes"; repoPath: string; repoName: string; message?: string; count?: number }[] = [];

  async function showNotification(n: typeof pendingNotifications[0]) {
    const text = n.type === "commit"
      ? `Committed in ${n.repoName} — ${n.message ?? "new commit"}`
      : `${n.count} new change${n.count !== 1 ? "s" : ""} in ${n.repoName}`;
    // Only show Push for commits where the repo is ahead (local commits, not pulled ones)
    const repo = repoManager.getRepo(n.repoPath);
    const showPush = n.type === "commit" && repo && repo.ahead > 0;
    const actions = n.type === "commit"
      ? (showPush ? ["Push", "Show Terminal"] : ["Show Terminal"])
      : ["Show Terminal", "View Changes"];
    const action = await vscode.window.showInformationMessage(
      `Diffchestrator: ${text}`,
      ...actions
    );
    if (action === "Push") {
      try {
        await sharedGit.push(n.repoPath);
        await repoManager.refreshRepo(n.repoPath);
        vscode.window.showInformationMessage(`Diffchestrator: Pushed ${n.repoName}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Push failed: ${msg}`);
      }
    } else if (action === "Show Terminal") {
      repoManager.selectRepo(n.repoPath);
      await showTerminalIfExists(n.repoPath);
    } else if (action === "View Changes") {
      await vscode.commands.executeCommand(CMD.viewDiff, { path: n.repoPath });
    }
  }

  function flushPendingNotifications() {
    if (pendingNotifications.length === 0) return;

    if (pendingNotifications.length === 1) {
      const n = pendingNotifications.shift()!;
      showNotification(n);
      return;
    }

    // Group: show summary
    const commits = pendingNotifications.filter((n) => n.type === "commit");
    const changes = pendingNotifications.filter((n) => n.type === "changes");
    const parts: string[] = [];
    if (commits.length > 0) parts.push(`${commits.length} commit${commits.length > 1 ? "s" : ""}`);
    if (changes.length > 0) parts.push(`${changes.length} repo${changes.length > 1 ? "s" : ""} with new changes`);
    const repoNames = [...new Set(pendingNotifications.map((n) => n.repoName))];
    const repos = repoNames.length <= 3 ? repoNames.join(", ") : `${repoNames.slice(0, 3).join(", ")} +${repoNames.length - 3} more`;

    pendingNotifications.length = 0;
    vscode.window.showInformationMessage(
      `Diffchestrator: While away — ${parts.join(", ")} (${repos})`
    );
  }

  // Flush queued notifications on window focus
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) flushPendingNotifications();
    })
  );

  repoManager.onDidDetectCommit(async ({ repoPath, repoName }) => {
    try {
      const commits = await sharedGit.log(repoPath, 1);
      const msg = commits.length > 0 ? commits[0].message : "new commit";
      if (repoManager.windowFocused) {
        showNotification({ type: "commit", repoPath, repoName, message: msg });
      } else {
        pendingNotifications.push({ type: "commit", repoPath, repoName, message: msg });
      }
    } catch (err) {
      outputChannel.appendLine(`[commit notification] ${repoName}: ${err instanceof Error ? err.message : err}`);
    }
  });

  repoManager.onDidDetectChanges(async ({ repoPath, repoName, count }) => {
    if (repoManager.windowFocused) {
      showNotification({ type: "changes", repoPath, repoName, count });
    } else {
      pendingNotifications.push({ type: "changes", repoPath, repoName, count });
    }
  });

  // Register command modules
  // File watcher — created before commands so switchRoot can reference it
  const fileWatcher = new FileWatcher(repoManager);
  repoManager.fileWatcher = fileWatcher;
  context.subscriptions.push(fileWatcher);

  registerScanCommands(context, repoManager);
  registerStageCommands(context, repoManager);
  registerCommitCommands(context, repoManager, outputChannel);
  registerPushCommands(context, repoManager, outputChannel);
  registerPullCommands(context, repoManager, outputChannel);
  registerAiCommitCommands(context, repoManager);
  registerClaudeCommands(context, repoManager);
  registerFavoriteCommands(context, repoManager);
  registerFileSearchCommand(context, repoManager);
  registerTerminalCommand(context, repoManager);
  registerCommitHistoryCommands(context, repoManager);
  registerDiscardCommands(context, repoManager);
  registerSwitchBranchCommands(context, repoManager);
  registerStashCommands(context, repoManager);

  // Scan Roots commands
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.switchRoot, async (rootPath?: string | object) => {
      if (!rootPath || typeof rootPath !== "string") {
        // Show quick pick of configured roots
        const config = vscode.workspace.getConfiguration("diffchestrator");
        const roots = config.get<string[]>("scanRoots", []);
        if (roots.length === 0) {
          vscode.window.showWarningMessage("Diffchestrator: No scan roots configured. Use the + button to add one.");
          return;
        }
        const items = roots.map((r) => ({
          label: `${r === repoManager.currentRoot ? "$(folder-opened) " : "$(folder) "}${path.basename(r)}`,
          description: r === repoManager.currentRoot ? "active" : "",
          _path: r,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: "Switch scan root",
        });
        if (!picked) return;
        rootPath = picked._path;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Diffchestrator: Scanning ${path.basename(rootPath)}` },
        async () => {
          await repoManager.scan(rootPath!);
          fileWatcher.watchAll();
        }
      );
    }),
    vscode.commands.registerCommand(CMD.addScanRoot, async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        title: "Select root directory to add",
      });
      if (!folders || folders.length === 0) return;
      const newRoot = folders[0].fsPath;
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const current = config.get<string[]>("scanRoots", []);
      if (!current.includes(newRoot)) {
        await config.update("scanRoots", [...current, newRoot], vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.commands.registerCommand(CMD.removeScanRoot, async (item?: any) => {
      const rootPath = item?.rootPath;
      if (!rootPath) return;
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const current = config.get<string[]>("scanRoots", []);
      await config.update("scanRoots", current.filter((r) => r !== rootPath), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand(CMD.openRootTerminal, () => {
      const root = repoManager.currentRoot;
      if (!root) {
        vscode.window.showWarningMessage("Diffchestrator: No scan root selected.");
        return;
      }
      const name = path.basename(root);
      const terminal = vscode.window.createTerminal({
        name,
        cwd: root,
        iconPath: new vscode.ThemeIcon("folder-opened"),
      });
      registerRepoTerminal(root, "shell", terminal);
      repoManager.addDirectoryPath(root);
      terminal.show();
    })
  );

  // Bulk fetch all repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchAll, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos to fetch.");
        return;
      }
      let fetched = 0;
      let skipped = 0;
      let failed = 0;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Fetching all repos", cancellable: false },
        async (progress) => {
          for (let i = 0; i < repos.length; i += BATCH_SMALL) {
            progress.report({ message: `${Math.min(i + BATCH_SMALL, repos.length)}/${repos.length}` });
            await Promise.all(repos.slice(i, i + BATCH_SMALL).map(async (r) => {
              try {
                await sharedGit.fetch(r.path);
                await repoManager.refreshRepo(r.path);
                fetched++;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                // No remote configured — not a real failure
                if (msg.includes("No remote") || msg.includes("no such remote") || msg.includes("does not appear to be a git repository")) {
                  skipped++;
                } else {
                  failed++;
                  outputChannel.appendLine(`[fetch] ${r.name}: ${msg}`);
                }
              }
            }));
          }
        }
      );
      const behindRepos = repoManager.repos.filter((r) => r.behind > 0);
      const summary = behindRepos.length > 0
        ? `${behindRepos.length} repo${behindRepos.length > 1 ? "s" : ""} behind remote`
        : "all up to date";
      const parts = [`Fetched ${fetched} repos`];
      if (skipped > 0) parts.push(`${skipped} local-only`);
      if (failed > 0) parts.push(`${failed} failed`);
      parts.push(summary);
      const msg = `Diffchestrator: ${parts.join(", ")}`;
      if (failed > 0) {
        const action = await vscode.window.showWarningMessage(msg, "Show Log");
        if (action === "Show Log") outputChannel.show();
      } else {
        vscode.window.showInformationMessage(msg);
      }
    }),
    // Bulk pull all repos
    vscode.commands.registerCommand(CMD.bulkPull, async () => {
      const repos = repoManager.repos.filter((r) => r.behind > 0);
      if (repos.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: All repos are up to date. Run Fetch All first.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Pull ${repos.length} repo${repos.length > 1 ? "s" : ""} that are behind remote?`,
        { modal: true },
        "Pull"
      );
      if (confirm !== "Pull") return;
      let success = 0;
      let failed = 0;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Pulling repos", cancellable: false },
        async (progress) => {
          for (const r of repos) {
            progress.report({ message: `${r.name}` });
            try {
              await sharedGit.pull(r.path);
              await repoManager.refreshRepo(r.path);
              success++;
            } catch (err) {
              failed++;
              outputChannel.appendLine(`[pull] ${r.name}: ${err instanceof Error ? err.message : err}`);
            }
          }
        }
      );
      const pullMsg = `Diffchestrator: Pulled ${success} repos${failed > 0 ? `, ${failed} failed` : ""}`;
      if (failed > 0) {
        const action = await vscode.window.showWarningMessage(pullMsg, "Show Log");
        if (action === "Show Log") outputChannel.show();
      } else {
        vscode.window.showInformationMessage(pullMsg);
      }
    }),
    // Sync All: fetch → pull behind → push ahead
    vscode.commands.registerCommand(CMD.syncAll, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos to sync.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Syncing all repos", cancellable: false },
        async (progress) => {
          // Phase 1: fetch
          progress.report({ message: "Fetching..." });
          await vscode.commands.executeCommand(CMD.fetchAll);

          // Phase 2: pull repos that are behind
          const behind = repoManager.repos.filter((r) => r.behind > 0);
          if (behind.length > 0) {
            progress.report({ message: `Pulling ${behind.length} repos...` });
            for (const r of behind) {
              try {
                await sharedGit.pull(r.path);
                await repoManager.refreshRepo(r.path);
              } catch (err) {
                outputChannel.appendLine(`[sync-pull] ${r.name}: ${err instanceof Error ? err.message : err}`);
              }
            }
          }

          // Phase 3: push repos that are ahead
          const ahead = repoManager.repos.filter((r) => r.ahead > 0);
          if (ahead.length > 0) {
            progress.report({ message: `Pushing ${ahead.length} repos...` });
            for (const r of ahead) {
              try {
                await sharedGit.push(r.path);
                await repoManager.refreshRepo(r.path);
              } catch (err) {
                outputChannel.appendLine(`[sync-push] ${r.name}: ${err instanceof Error ? err.message : err}`);
              }
            }
          }
        }
      );
      vscode.window.showInformationMessage("Diffchestrator: Sync complete");
    }),
    // Claude multi-repo review
    vscode.commands.registerCommand(CMD.claudeReviewAll, async () => {
      const changedRepos = repoManager.repos.filter((r) => r.totalChanges > 0);
      if (changedRepos.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: No repos with changes to review.");
        return;
      }
      const addDirArgs = changedRepos.map((r) => `--add-dir ${escapeForTerminal(r.path)}`).join(" ");
      const terminal = vscode.window.createTerminal({
        name: "Multi-repo Review",
        cwd: repoManager.currentRoot,
        iconPath: terminalIcon("claude"),
      });
      terminal.show();
      const prompt = "Review the changes across all these repositories. Summarize what changed, flag any issues, and suggest improvements.";
      terminal.sendText(`claude ${addDirArgs} ${escapeForTerminal(prompt)}`);
    })
  );

  // Copy repo info to clipboard (#33)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.copyRepoInfo, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      const repo = repoManager.getRepo(repoPath);
      const items = [
        { label: "$(file-directory) Path", description: repoPath, _value: repoPath },
        { label: "$(git-branch) Branch", description: repo?.branch ?? "unknown", _value: repo?.branch ?? "" },
      ];
      if (repo?.remoteUrl) {
        items.push({ label: "$(link) Remote URL", description: repo.remoteUrl, _value: repo.remoteUrl });
      }
      items.push({ label: "$(repo) Name", description: path.basename(repoPath), _value: path.basename(repoPath) });
      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Copy to clipboard" });
      if (picked) {
        await vscode.env.clipboard.writeText(picked._value);
        vscode.window.showInformationMessage(`Copied: ${picked._value}`);
      }
    })
  );

  // Keyboard shortcut cheatsheet (#34)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.showShortcuts, async () => {
      const shortcuts = [
        { label: "Alt+D, Tab", description: "Cycle through active repos" },
        { label: "Alt+D, Shift+Tab", description: "Close all active repos" },
        { label: "Alt+D, Q", description: "Close current active repo" },
        { label: "Alt+D, N / Shift+N", description: "Next / Previous changed file" },
        { label: "Alt+D, M", description: "Commit with message" },
        { label: "Alt+D, C", description: "AI Commit (Claude)" },
        { label: "Alt+D, L", description: "Open Claude Code" },
        { label: "Alt+D, Y", description: "Yolo (Claude Sandbox)" },
        { label: "Alt+D, S", description: "Scan for repositories" },
        { label: "Alt+D, Shift+S", description: "Switch scan root" },
        { label: "Alt+D, Shift+T", description: "Open terminal at root" },
        { label: "Alt+D, T", description: "Open terminal at repo" },
        { label: "Alt+D, R", description: "Switch active repo" },
        { label: "Alt+D, F", description: "Browse files in repo" },
        { label: "Alt+D, P", description: "Push" },
        { label: "Alt+D, U", description: "Pull" },
        { label: "Alt+D, D", description: "Toggle changed-only filter" },
        { label: "Alt+D, H", description: "Commit history" },
        { label: "Alt+D, B", description: "Switch branch" },
        { label: "Alt+D, A", description: "Stash management" },
        { label: "Alt+D, G", description: "Toggle inline blame" },
        { label: "Alt+D, E", description: "Favorite current repo" },
        { label: "Alt+D, /", description: "Search in repo (git grep)" },
        { label: "Alt+D, .", description: "Search active repos" },
        { label: "Alt+D, Shift+/", description: "Search all repos" },
        { label: "Alt+D, W", description: "Open repo in new window" },
        { label: "Alt+D, K", description: "Show this cheatsheet" },
        { label: "Alt+D, X", description: "Clean up merged branches" },
        { label: "Alt+D, I", description: "Filter repos by tag" },
        { label: "Alt+D, Z", description: "Undo last commit (soft reset)" },
        { label: "Alt+D, Shift+B", description: "Save workspace snapshot" },
        { label: "Alt+D, Shift+L", description: "Load workspace snapshot" },
      ];
      await vscode.window.showQuickPick(shortcuts, {
        placeHolder: "Diffchestrator Keyboard Shortcuts (Alt+D chord prefix)",
        matchOnDescription: true,
      });
    })
  );

  // Cross-repo activity log (#35)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.activityLog, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos scanned.");
        return;
      }
      type LogEntry = { label: string; description: string; detail: string };
      const entries: LogEntry[] = [];
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "Diffchestrator: Loading activity" },
        async () => {
          for (let i = 0; i < repos.length; i += BATCH_SMALL) {
            await Promise.all(repos.slice(i, i + BATCH_SMALL).map(async (r) => {
              try {
                const commits = await sharedGit.log(r.path, 3);
                for (const c of commits) {
                  entries.push({
                    label: `$(git-commit) ${c.message}`,
                    description: `${r.name} · ${c.author}`,
                    detail: `${c.shortHash} · ${c.date}`,
                  });
                }
              } catch { /* skip */ }
            }));
          }
        }
      );
      entries.sort((a, b) => b.detail.localeCompare(a.detail));
      await vscode.window.showQuickPick(entries.slice(0, 50), {
        placeHolder: "Recent commits across all repos",
        matchOnDescription: true,
        matchOnDetail: true,
      });
    })
  );

  // Branch cleanup (#36)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.branchCleanup, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) return;
      type CleanupItem = vscode.QuickPickItem & { _repo: string; _branch: string };
      const items: CleanupItem[] = [];
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Finding merged branches" },
        async () => {
          for (let i = 0; i < repos.length; i += BATCH_SMALL) {
            await Promise.all(repos.slice(i, i + BATCH_SMALL).map(async (r) => {
              try {
                const merged = await sharedGit.mergedBranches(r.path, r.branch);
                for (const b of merged) {
                  items.push({
                    label: `$(git-branch) ${b}`,
                    description: r.name,
                    picked: true,
                    _repo: r.path,
                    _branch: b,
                  });
                }
              } catch { /* skip */ }
            }));
          }
        }
      );
      if (items.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: No merged branches found.");
        return;
      }
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${items.length} merged branches found — select to delete`,
        canPickMany: true,
      });
      if (!selected || selected.length === 0) return;
      let deleted = 0;
      let failed = 0;
      for (const s of selected) {
        try {
          await sharedGit.deleteBranch(s._repo, s._branch);
          deleted++;
        } catch {
          failed++;
        }
      }
      vscode.window.showInformationMessage(
        `Diffchestrator: Deleted ${deleted} branches${failed > 0 ? `, ${failed} failed` : ""}`
      );
    })
  );

  // Open remote URL (#37)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.openRemoteUrl, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      const repo = repoManager.getRepo(repoPath);
      let url = repo?.remoteUrl;
      if (!url) {
        vscode.window.showWarningMessage("Diffchestrator: No remote URL found for this repo.");
        return;
      }
      // Convert git@ SSH URLs to HTTPS
      if (url.startsWith("git@")) {
        url = url.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
      } else if (url.endsWith(".git")) {
        url = url.replace(/\.git$/, "");
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // Reveal in system file explorer
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.revealInExplorer, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(repoPath));
    })
  );

  // Repo tags (#38)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.setRepoTag, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const tags: Record<string, string[]> = config.get("repoTags", {});
      const currentTags = Object.entries(tags)
        .filter(([, repos]) => repos.includes(repoPath))
        .map(([tag]) => tag);

      const input = await vscode.window.showInputBox({
        prompt: `Tags for ${path.basename(repoPath)} (comma-separated)`,
        value: currentTags.join(", "),
        placeHolder: "frontend, shared, infra",
      });
      if (input === undefined) return;

      // Remove repo from all existing tags
      for (const [tag, repos] of Object.entries(tags)) {
        tags[tag] = repos.filter((r) => r !== repoPath);
        if (tags[tag].length === 0) delete tags[tag];
      }
      // Add to new tags
      if (input.trim()) {
        for (const tag of input.split(",").map((t) => t.trim()).filter(Boolean)) {
          if (!tags[tag]) tags[tag] = [];
          tags[tag].push(repoPath);
        }
      }
      await config.update("repoTags", tags, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Diffchestrator: Tags updated for ${path.basename(repoPath)}`);
    }),
    vscode.commands.registerCommand(CMD.filterByTag, async () => {
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const tags: Record<string, string[]> = config.get("repoTags", {});
      const tagNames = Object.keys(tags);
      if (tagNames.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: No tags defined. Right-click a repo to add tags.");
        return;
      }
      const items = [
        { label: "$(close) Clear filter", description: "Show all repos", _tag: "" },
        ...tagNames.map((t) => ({ label: `$(tag) ${t}`, description: `${tags[t].length} repos`, _tag: t })),
      ];
      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Filter repos by tag" });
      if (!picked) return;
      // Store active tag filter in context for repoTreeProvider
      vscode.commands.executeCommand("setContext", "diffchestrator.activeTagFilter", picked._tag);
      repoManager.setTagFilter(picked._tag || undefined);
    })
  );

  // Workspace snapshots (#39)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.saveSnapshot, async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Snapshot name",
        placeHolder: "e.g., Frontend work, Infra day",
      });
      if (!name) return;
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const snapshots: Record<string, { root?: string; favorites: string[]; recent: string[]; selected?: string }> = config.get("snapshots", {});
      snapshots[name] = {
        root: repoManager.currentRoot,
        favorites: config.get<string[]>("favorites", []),
        recent: repoManager.recentRepoPaths,
        selected: repoManager.selectedRepo,
      };
      await config.update("snapshots", snapshots, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Diffchestrator: Snapshot "${name}" saved`);
    }),
    vscode.commands.registerCommand(CMD.loadSnapshot, async () => {
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const snapshots = { ...config.get<Record<string, { root?: string; favorites: string[]; recent: string[]; selected?: string }>>("snapshots", {}) };
      const names = Object.keys(snapshots);
      if (names.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: No snapshots saved.");
        return;
      }
      const items = [
        ...names.map((n) => ({
          label: `$(bookmark) ${n}`,
          description: snapshots[n].root ? path.basename(snapshots[n].root!) : "",
          _action: "load" as const,
          _name: n,
        })),
        ...names.map((n) => ({
          label: `$(trash) Delete "${n}"`,
          description: "",
          _action: "delete" as const,
          _name: n,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Load or delete a snapshot" });
      if (!picked) return;

      if (picked._action === "delete") {
        delete snapshots[picked._name];
        await config.update("snapshots", snapshots, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Diffchestrator: Snapshot "${picked._name}" deleted`);
        return;
      }

      const snap = snapshots[picked._name];
      if (!snap) return;
      // Restore favorites
      await config.update("favorites", snap.favorites, vscode.ConfigurationTarget.Global);
      // Restore recent repos + selection
      if (snap.recent) repoManager.restoreRecent(snap.recent, snap.selected);
      // Scan the root
      if (snap.root) {
        await repoManager.scan(snap.root);
        fileWatcher.watchAll();
      }
      vscode.window.showInformationMessage(`Diffchestrator: Loaded snapshot "${picked._name}"`);
    })
  );

  // Undo last commit (#41)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.undoCommit, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      const repoName = path.basename(repoPath);
      try {
        const commits = await sharedGit.log(repoPath, 1);
        const lastMsg = commits.length > 0 ? commits[0].message : "last commit";
        const confirm = await vscode.window.showWarningMessage(
          `Undo "${lastMsg}" in ${repoName}? Changes will be kept as staged.`,
          { modal: true },
          "Undo"
        );
        if (confirm !== "Undo") return;
        await sharedGit.resetSoft(repoPath);
        await repoManager.refreshRepo(repoPath);
        vscode.window.showInformationMessage(`Diffchestrator: Undid last commit in ${repoName}. Changes are staged.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Undo failed: ${msg}`);
      }
    })
  );

  // Single-repo fetch (#42)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchRepo, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      const repoName = path.basename(repoPath);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Diffchestrator: Fetching ${repoName}...` },
          async () => {
            await sharedGit.fetch(repoPath);
            await repoManager.refreshRepo(repoPath);
          }
        );
        const repo = repoManager.getRepo(repoPath);
        const behind = repo?.behind ?? 0;
        vscode.window.showInformationMessage(
          `Diffchestrator: Fetched ${repoName}${behind > 0 ? ` (${behind} behind)` : " (up to date)"}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Diffchestrator: Fetch failed for ${repoName}: ${msg}`);
      }
    })
  );

  // Toggle changed only
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleChangedOnly, () =>
      repoManager.toggleChangedOnly()
    )
  );

  // Toggle favorites visibility in Active Repos (two commands for icon swap)
  const updateFavContext = () => {
    const show = vscode.workspace.getConfiguration("diffchestrator").get<boolean>("showFavorites", true);
    vscode.commands.executeCommand("setContext", "diffchestrator.showFavorites", show);
  };
  updateFavContext();

  const toggleFavHandler = async () => {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const current = config.get<boolean>("showFavorites", true);
    await config.update("showFavorites", !current, vscode.ConfigurationTarget.Global);
    updateFavContext();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.toggleShowFavorites, toggleFavHandler),
    vscode.commands.registerCommand(CMD.toggleShowFavoritesOff, toggleFavHandler)
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
        if (sidebarVisible) {
          await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
        }

        // Step 4: Switch terminal
        await showTerminalIfExists(target.path);

        // Step 5: Open first changed file if any
        try {
          const status = await sharedGit.status(target.path);
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
      updateViewInfo();
    })
  );

  // Close active repo from recent list
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeActiveRepo, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      await closeEditorsForRepo(repoPath);
      // Close terminals if autoTerminals is configured
      const autoTerminals = vscode.workspace
        .getConfiguration("diffchestrator")
        .get<string[]>("autoTerminals", []);
      if (autoTerminals.length > 0 || repoManager.isDirectory(repoPath)) {
        const kinds: TerminalKind[] = ["claude", "yolo", "yolonew", "shell"];
        for (const k of kinds) {
          const t = getRepoTerminal(repoPath, k);
          if (t) t.dispose();
        }
      }
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
        await closeEditorsForRepo(selected._repoPath);
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
        await closeEditorsForRepo(p);
      }
      repoManager.clearAllRecentRepos();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    })
  );

  // Navigate changed files without staging
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.nextChangedFile, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const status = await sharedGit.status(repoPath);
      const allFiles = [...status.unstaged, ...status.untracked, ...status.staged];
      if (allFiles.length === 0) return;

      // Find current file in the list
      const editor = vscode.window.activeTextEditor;
      const currentPath = editor?.document.uri.fsPath;
      const currentRel = currentPath ? path.relative(repoPath, currentPath) : "";
      const currentIdx = allFiles.findIndex((f) => f.path === currentRel);
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % allFiles.length : 0;
      const next = allFiles[nextIdx];

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openFileDiff(repoPath, next);
    }),
    vscode.commands.registerCommand(CMD.prevChangedFile, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const status = await sharedGit.status(repoPath);
      const allFiles = [...status.unstaged, ...status.untracked, ...status.staged];
      if (allFiles.length === 0) return;

      const editor = vscode.window.activeTextEditor;
      const currentPath = editor?.document.uri.fsPath;
      const currentRel = currentPath ? path.relative(repoPath, currentPath) : "";
      const currentIdx = allFiles.findIndex((f) => f.path === currentRel);
      const prevIdx = currentIdx > 0 ? currentIdx - 1 : allFiles.length - 1;
      const prev = allFiles[prevIdx];

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openFileDiff(repoPath, prev);
    })
  );

  // Stage/unstage the file currently open in the editor (editor title bar buttons)
  // Delegates to the same stageFile/unstageFile commands used by the sidebar tree,
  // resolving the file path from the active editor first.
  // Reuse shared git instance for editor commands

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.stageCurrentFile, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const absFile = editor.document.uri.fsPath;
      const rel = path.relative(repoPath, absFile);
      if (rel.startsWith("..")) return;
      try {
        await sharedGit.stage(repoPath, [rel]);
        await repoManager.refreshRepo(repoPath);
        await openNextPendingFile(sharedGit, repoPath, rel);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Failed to stage: ${err instanceof Error ? err.message : err}`);
      }
    }),
    vscode.commands.registerCommand(CMD.unstageCurrentFile, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) return;
      const absFile = editor.document.uri.fsPath;
      const rel = path.relative(repoPath, absFile);
      if (rel.startsWith("..")) return;
      try {
        await sharedGit.unstage(repoPath, [rel]);
        await repoManager.refreshRepo(repoPath);
        vscode.window.showInformationMessage(`Unstaged: ${rel}`);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Failed to unstage: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // Select / deselect repo (multi-select toggle)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.selectRepo,
      (item?: any) => {
        const p = resolveRepoPath(item);
        if (p) repoManager.toggleRepoSelection(p);
      }
    )
  );

  // Clear multi-selection
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.clearSelection, () =>
      repoManager.clearMultiSelection()
    )
  );

  // Select all active/recent repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.selectAllActive, () => {
      for (const p of repoManager.recentRepoPaths) {
        if (!repoManager.selectedRepoPaths.has(p)) {
          repoManager.toggleRepoSelection(p);
        }
      }
    }),
    vscode.commands.registerCommand(CMD.deselectAll, () =>
      repoManager.clearMultiSelection()
    )
  );

  // Helper to extract repo path from various argument shapes
  // Tree click: { path: "..." }, Context menu: TreeNode { fullPath: "...", repo: { path: "..." } }
  function resolveRepoPath(item?: any): string | undefined {
    if (!item) return repoManager.selectedRepo;
    if (item.repo?.path) return item.repo.path;
    if (item.fullPath) return item.fullPath;
    if (item.path) return item.path;
    if (item.repoPath) return item.repoPath;
    return repoManager.selectedRepo;
  }

  // Check if a URI belongs to a repo (by file path or git-show query)
  function uriBelongsToRepo(uri: vscode.Uri, repoPath: string): boolean {
    if (uri.scheme === "file" && uri.fsPath.startsWith(repoPath)) return true;
    if (uri.scheme === "git-show") {
      try {
        const params = JSON.parse(uri.query);
        if (params.repoPath === repoPath) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  // Close editors that belong to a specific repo path
  async function closeEditorsForRepo(repoPath: string): Promise<void> {
    const tabsToClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        let belongsToRepo = false;
        const input = tab.input as Record<string, unknown> | undefined;
        if (input?.uri) {
          belongsToRepo = uriBelongsToRepo(input.uri as vscode.Uri, repoPath);
        } else if (input?.original && input?.modified) {
          belongsToRepo =
            uriBelongsToRepo(input.original as vscode.Uri, repoPath) ||
            uriBelongsToRepo(input.modified as vscode.Uri, repoPath);
        }
        if (belongsToRepo) {
          tabsToClose.push(tab);
        }
      }
    }
    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose);
    }
  }

  let previousRepoPath: string | undefined;

  // View diff — selects repo, shows changed files panel, auto-opens first changed file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.viewDiff,
      async (item?: any) => {
        const repoPath = resolveRepoPath(item);
        const preserveFocus = !!item?.preserveFocus;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected."
          );
          return;
        }

        // Close editors from the previous repo before switching
        switchingRepo = true;
        try {
          if (previousRepoPath && previousRepoPath !== repoPath) {
            await closeEditorsForRepo(previousRepoPath);
          }
          previousRepoPath = repoPath;

          repoManager.selectRepo(repoPath);
          // Only steal sidebar focus if diffchestrator panel is already visible
          // and caller isn't preserving focus (e.g. terminal-tab click).
          if (sidebarVisible && !preserveFocus) {
            await vscode.commands.executeCommand(`${VIEW_CHANGED_FILES}.focus`);
          }
          // Don't override user's terminal choice: skip when a programmatic terminal
          // switch is running (cycle/nav) or when the caller preserves focus (terminal click).
          if (!suppressTerminalSwitch && !preserveFocus) {
            await showTerminalIfExists(repoPath);
          }

          // Auto-open configured terminal types — only if not already running
          const autoTerminals = vscode.workspace
            .getConfiguration("diffchestrator")
            .get<string[]>("autoTerminals", []);
          // Skip entirely if repo already has ANY terminals (tracked or untracked)
          const repoBasename = path.basename(repoPath);
          const hasExistingTerminals = vscode.window.terminals.some(
            (t) => t.name === repoBasename
          );
          for (const kind of autoTerminals) {
            if (getRepoTerminal(repoPath, kind as TerminalKind)) continue;
            if (hasExistingTerminals) continue;
            if (kind === "shell") {
              await vscode.commands.executeCommand(CMD.openTerminal, { path: repoPath });
            } else if (kind === "yolo") {
              await vscode.commands.executeCommand(CMD.yolo, { path: repoPath });
            } else if (kind === "yolonew") {
              await vscode.commands.executeCommand(CMD.yolonew, { path: repoPath });
            } else if (kind === "claude") {
              await vscode.commands.executeCommand(CMD.openClaudeCode, { path: repoPath });
            } else if (kind === "claudenew") {
              await vscode.commands.executeCommand(CMD.openClaudeCodeNew, { path: repoPath });
            }
          }
        } finally {
          switchingRepo = false;
        }

        // Directory entries: terminal only, no file operations
        if (repoManager.isDirectory(repoPath)) return;

        // Priority: changed files first (review workflow), then remembered file
        try {
          const status = await sharedGit.status(repoPath);
          const firstFile = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          if (firstFile) {
            await openFileDiff(repoPath, firstFile, { preserveFocus });
          } else {
            // No changes — restore remembered file if we have one
            const remembered = lastOpenFile.get(repoPath);
            if (remembered) {
              try {
                if (remembered.scheme === "file") {
                  await vscode.window.showTextDocument(remembered, { preview: false, preserveFocus });
                } else {
                  const doc = await vscode.workspace.openTextDocument(remembered);
                  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
                }
              } catch (err) {
                outputChannel.appendLine(`[restore file] ${err instanceof Error ? err.message : err}`);
                lastOpenFile.delete(repoPath);
                if (!preserveFocus) {
                  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                }
              }
            } else if (!preserveFocus) {
              await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
          }
        } catch (err) {
          outputChannel.appendLine(`[viewDiff] ${err instanceof Error ? err.message : err}`);
        }
      }
    )
  );

  // View multi-repo diff — opens webview panel with aggregated diffs
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.viewMultiRepoDiff, () => {
      DiffWebviewPanel.createOrShow(context.extensionUri, repoManager);
    })
  );

  // Dashboard webview
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.dashboard, () => {
      DashboardWebviewPanel.createOrShow(context.extensionUri, repoManager, sessionStartTime);
    })
  );

  // Cycle terminal — rotate through alive terminals for selected repo
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cycleTerminal, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      suppressTerminalSwitch = true;
      try { await cycleTerminal(repoPath); } finally { suppressTerminalSwitch = false; }
    })
  );

  // Close terminal — close active or pick which to close
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.closeTerminal, async () => {
      const repoPath = repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      await closeRepoTerminal(repoPath);
    })
  );

  // Navigate terminals across repos — auto-select the target repo
  const registerNav = (cmd: string, direction: 1 | -1) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(cmd, async () => {
        suppressTerminalSwitch = true;
        try {
          const repoPath = await navigateTerminal(direction, [...repoManager.allRepos.map((r) => r.path), ...repoManager.directoryPaths]);
          if (repoPath && repoPath !== repoManager.selectedRepo) {
            // Check if repo is in current root
            const inCurrentRoot = repoManager.allRepos.some((r) => r.path === repoPath);
            if (inCurrentRoot) {
              repoManager.selectRepo(repoPath);
            } else {
              // Try to find in other roots and switch
              const terminal = vscode.window.activeTerminal;
              const match = terminal && repoManager.findRepoInOtherRoots(terminal.name);
              if (match) {
                await vscode.commands.executeCommand(CMD.switchRoot, match.root);
                repoManager.selectRepo(match.path);
              }
            }
          }
        } finally {
          suppressTerminalSwitch = false;
        }
      })
    );
  };
  registerNav(CMD.nextTerminal, 1);
  registerNav(CMD.prevTerminal, -1);

  // Phase 5: File watcher already created above (before command registrations)

  // Phase 6: Inline blame — git blame on current line
  const inlineBlame = new InlineBlameService(repoManager);
  context.subscriptions.push(inlineBlame);

  // Phase 8: Auto-scan workspace folders
  const workspaceAutoScan = new WorkspaceAutoScan(repoManager, fileWatcher);
  context.subscriptions.push(workspaceAutoScan);

  // Auto-scan on startup — resume last root if available, otherwise use first configured root
  const config = vscode.workspace.getConfiguration("diffchestrator");
  if (config.get<boolean>("scanOnStartup", true)) {
    const roots = config.get<string[]>("scanRoots", []);
    const lastRoot = repoManager.currentRoot;
    const startupRoot = lastRoot && roots.includes(lastRoot) ? lastRoot : roots[0];
    if (startupRoot) {
      repoManager.scan(startupRoot).then(() => {
        fileWatcher.watchAll();
        adoptExistingTerminals([...repoManager.allRepos.map((r) => r.path), ...repoManager.directoryPaths]);
      }).catch((err) => {
        outputChannel.appendLine(`[startup scan] ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  // Onboarding: show walkthrough on first run if no scan roots configured
  const wasOnboarded = context.globalState.get<boolean>("diffchestrator.onboarded", false);
  if (!wasOnboarded) {
    const onboardConfig = vscode.workspace.getConfiguration("diffchestrator");
    const roots = onboardConfig.get<string[]>("scanRoots", []);
    if (roots.length === 0) {
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "andrevops-com.diffchestrator#diffchestrator.welcome",
        false
      );
    }
    context.globalState.update("diffchestrator.onboarded", true);
  }

  // Public API for sibling extensions
  return {
    getCurrentRoot: () => repoManager.currentRoot,
    getSelectedRepo: () => repoManager.selectedRepo,
    onDidChangeSelection: repoManager.onDidChangeSelection,
  };
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
