import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { CMD, BATCH_SMALL } from "../constants";
import { escapeForTerminal } from "../utils/shell";
import { terminalIcon } from "./terminal";

export function registerBulkSyncCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  outputChannel: vscode.OutputChannel
): void {
  const sharedGit = repoManager.git;

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
          for (let i = 0; i < repos.length; i += BATCH_SMALL) {
            progress.report({ message: `${Math.min(i + BATCH_SMALL, repos.length)}/${repos.length}` });
            await Promise.all(repos.slice(i, i + BATCH_SMALL).map(async (r) => {
              try {
                await sharedGit.pull(r.path);
                await repoManager.refreshRepo(r.path);
                success++;
              } catch (err) {
                failed++;
                outputChannel.appendLine(`[pull] ${r.name}: ${err instanceof Error ? err.message : err}`);
              }
            }));
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
            for (let i = 0; i < behind.length; i += BATCH_SMALL) {
              await Promise.all(behind.slice(i, i + BATCH_SMALL).map(async (r) => {
                try {
                  await sharedGit.pull(r.path);
                  await repoManager.refreshRepo(r.path);
                } catch (err) {
                  outputChannel.appendLine(`[sync-pull] ${r.name}: ${err instanceof Error ? err.message : err}`);
                }
              }));
            }
          }

          // Phase 3: push repos that are ahead
          const ahead = repoManager.repos.filter((r) => r.ahead > 0);
          if (ahead.length > 0) {
            progress.report({ message: `Pushing ${ahead.length} repos...` });
            for (let i = 0; i < ahead.length; i += BATCH_SMALL) {
              await Promise.all(ahead.slice(i, i + BATCH_SMALL).map(async (r) => {
                try {
                  await sharedGit.push(r.path);
                  await repoManager.refreshRepo(r.path);
                } catch (err) {
                  outputChannel.appendLine(`[sync-push] ${r.name}: ${err instanceof Error ? err.message : err}`);
                }
              }));
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
}
