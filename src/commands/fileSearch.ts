import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerFileSearchCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.searchFiles, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repositories scanned. Run 'Scan for Repositories' first."
        );
        return;
      }

      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = "Type to search files across all repositories...";
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      quickPick.onDidChangeValue((value) => {
        if (debounceTimer) clearTimeout(debounceTimer);

        if (value.length < 2) {
          quickPick.items = [];
          return;
        }

        debounceTimer = setTimeout(async () => {
          quickPick.busy = true;
          const items: vscode.QuickPickItem[] = [];

          // Search across all repos concurrently (max 10 at a time)
          const BATCH = 10;
          for (let i = 0; i < repos.length; i += BATCH) {
            const batch = repos.slice(i, i + BATCH);
            const results = await Promise.all(
              batch.map(async (repo) => {
                try {
                  const files = await git.listFiles(repo.path, value);
                  return files.slice(0, 20).map((f) => ({
                    label: `$(file) ${path.basename(f)}`,
                    description: f,
                    detail: repo.name,
                    _fullPath: path.join(repo.path, f),
                  }));
                } catch {
                  return [];
                }
              })
            );

            for (const batch of results) {
              items.push(...batch);
            }
          }

          quickPick.items = items.slice(0, 100);
          quickPick.busy = false;
        }, 300);
      });

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as
          | (vscode.QuickPickItem & { _fullPath?: string })
          | undefined;
        if (selected?._fullPath) {
          vscode.window.showTextDocument(
            vscode.Uri.file(selected._fullPath)
          );
        }
        quickPick.dispose();
      });

      quickPick.onDidHide(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        quickPick.dispose();
      });

      quickPick.show();
    })
  );

  // Browse files in a specific repo (pre-loaded, instant filter)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.browseFiles, async (item?: any) => {
      const repoPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }

      const repoName = path.basename(repoPath);

      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = `Browse files in ${repoName}...`;
      quickPick.matchOnDescription = true;
      quickPick.busy = true;

      // Pre-load all files
      try {
        const files = await git.listFiles(repoPath);
        quickPick.items = files.map((f) => ({
          label: `$(file) ${path.basename(f)}`,
          description: path.dirname(f) !== "." ? path.dirname(f) : undefined,
          detail: undefined,
          _fullPath: path.join(repoPath, f),
          _relPath: f,
        }));
      } catch {
        quickPick.items = [{ label: "Failed to list files", description: "" }];
      }
      quickPick.busy = false;

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as
          | (vscode.QuickPickItem & { _fullPath?: string })
          | undefined;
        if (selected?._fullPath) {
          vscode.window.showTextDocument(vscode.Uri.file(selected._fullPath));
        }
        quickPick.dispose();
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    })
  );

  // Shared grep QuickPick across one or many repos
  function openGrepQuickPick(repoPaths: string[], placeholder: string): void {
    const multiRepo = repoPaths.length > 1;
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = placeholder;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    quickPick.onDidChangeValue((value) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (value.length < 2) {
        quickPick.items = [];
        return;
      }

      debounceTimer = setTimeout(async () => {
        quickPick.busy = true;
        try {
          // Grep all repos in parallel (batched to 5)
          const allMatches: (vscode.QuickPickItem & { _fullPath?: string; _line?: number; _repoPath?: string; _noAction?: boolean })[] = [];
          const BATCH = 5;
          for (let i = 0; i < repoPaths.length; i += BATCH) {
            const batch = repoPaths.slice(i, i + BATCH);
            const results = await Promise.all(
              batch.map(async (rp) => {
                try {
                  const matches = await git.grep(rp, value, 30);
                  const repoName = path.basename(rp);
                  return matches.map((m) => ({
                    label: `$(file) ${path.basename(m.file)}:${m.line}`,
                    description: multiRepo
                      ? `${path.dirname(m.file) !== "." ? path.dirname(m.file) + " " : ""}[${repoName}]`
                      : (path.dirname(m.file) !== "." ? path.dirname(m.file) : undefined),
                    detail: m.text,
                    _fullPath: path.join(rp, m.file),
                    _line: m.line,
                    _repoPath: rp,
                  }));
                } catch {
                  return [];
                }
              })
            );
            allMatches.push(...results.flat());
          }

          if (allMatches.length === 0) {
            quickPick.items = [{ label: "$(info) No matches found", description: "", _noAction: true } as any];
          } else {
            quickPick.items = allMatches.slice(0, 100);
          }
        } catch {
          quickPick.items = [{ label: "$(warning) Search failed", description: "" }];
        }
        quickPick.busy = false;
      }, 300);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0] as
        | (vscode.QuickPickItem & { _fullPath?: string; _line?: number; _repoPath?: string; _noAction?: boolean })
        | undefined;
      if (selected?._fullPath && !selected._noAction) {
        const line = (selected._line ?? 1) - 1;
        // Switch to the repo if it's a multi-repo search
        if (selected._repoPath && selected._repoPath !== repoManager.selectedRepo) {
          vscode.commands.executeCommand(CMD.viewDiff, { path: selected._repoPath });
        }
        vscode.window.showTextDocument(
          vscode.Uri.file(selected._fullPath),
          { selection: new vscode.Range(line, 0, line, 0) }
        );
      }
      quickPick.dispose();
    });

    quickPick.onDidHide(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      quickPick.dispose();
    });

    quickPick.show();
  }

  // Search in selected repo
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.grepInRepo, async (item?: any) => {
      const repoPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      openGrepQuickPick([repoPath], `Search in ${path.basename(repoPath)}...`);
    })
  );

  // Search across active/recent repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.grepActiveRepos, async () => {
      const recent = repoManager.recentRepoPaths;
      if (recent.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No active repos. Open some repos first.");
        return;
      }
      const names = recent.map((p) => path.basename(p)).slice(0, 3).join(", ");
      const suffix = recent.length > 3 ? ` +${recent.length - 3} more` : "";
      openGrepQuickPick([...recent], `Search active repos (${names}${suffix})...`);
    })
  );

  // Search across all scanned repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.grepAllRepos, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos scanned.");
        return;
      }
      openGrepQuickPick(
        repos.map((r) => r.path),
        `Search all ${repos.length} repos...`
      );
    })
  );

  // Open repo in new VS Code window — gives full native search, explorer, etc.
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.searchInRepo, async (item?: any) => {
      const repoPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(repoPath), true);
    })
  );

  // Switch repo — QuickPick to select a repo and make it active
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.switchRepo, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos scanned.");
        return;
      }

      const currentPath = repoManager.selectedRepo;

      const items = repos.map((r) => ({
        label: `$(repo) ${r.name}`,
        description: r.branch + (r.totalChanges > 0 ? ` — ${r.totalChanges} changes` : ""),
        detail: r.path,
        _repoPath: r.path,
        picked: r.path === currentPath,
      }));

      const changesMap = new Map<string, number>(repos.map((r) => [r.path, r.totalChanges]));

      // Sort: current repo first, then repos with changes, then alphabetical
      items.sort((a, b) => {
        if (a._repoPath === currentPath) return -1;
        if (b._repoPath === currentPath) return 1;
        const aChanges = changesMap.get(a._repoPath) ?? 0;
        const bChanges = changesMap.get(b._repoPath) ?? 0;
        if (aChanges !== bChanges) return bChanges - aChanges;
        return a.label.localeCompare(b.label);
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Switch to a repository...",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await vscode.commands.executeCommand(CMD.viewDiff, { path: selected._repoPath });
      }
    })
  );
}
