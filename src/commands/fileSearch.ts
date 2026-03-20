import * as vscode from "vscode";
import * as path from "path";
import { GitExecutor } from "../git/gitExecutor";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerFileSearchCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = new GitExecutor();

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
}
