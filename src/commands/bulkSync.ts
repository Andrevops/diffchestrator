import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { CMD, BATCH_SMALL } from "../constants";
import type { RepoSummary } from "../types";
import { escapeForTerminal } from "../utils/shell";
import { formatRepoList, planSync, pluralRepos } from "../utils/repoList";
import { terminalIcon } from "./terminal";

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function registerBulkSyncCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  outputChannel: vscode.OutputChannel
): void {
  const sharedGit = repoManager.git;

  /**
   * Fetch every repo (batched) and refresh its state. Shared by Fetch All and
   * Sync All so the latter doesn't pop Fetch All's toast mid-sync.
   */
  const fetchRepos = async (
    repos: readonly RepoSummary[],
    report: (message: string) => void
  ): Promise<{ fetched: number; skipped: number; failed: number }> => {
    let fetched = 0;
    let skipped = 0;
    let failed = 0;
    for (let i = 0; i < repos.length; i += BATCH_SMALL) {
      report(`${Math.min(i + BATCH_SMALL, repos.length)}/${repos.length}`);
      await Promise.all(repos.slice(i, i + BATCH_SMALL).map(async (r) => {
        try {
          await sharedGit.fetch(r.path);
          await repoManager.refreshRepo(r.path);
          fetched++;
        } catch (err) {
          const msg = errMsg(err);
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
    return { fetched, skipped, failed };
  };

  const showResult = async (msg: string, hasFailures: boolean): Promise<void> => {
    if (hasFailures) {
      const action = await vscode.window.showWarningMessage(msg, "Show Log");
      if (action === "Show Log") outputChannel.show();
    } else {
      vscode.window.showInformationMessage(msg);
    }
  };

  // Bulk fetch all repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchAll, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos to fetch.");
        return;
      }
      const { fetched, skipped, failed } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Fetching all repos", cancellable: false },
        (progress) => fetchRepos(repos, (message) => progress.report({ message }))
      );
      const behindRepos = repoManager.repos.filter((r) => r.behind > 0);
      const summary = behindRepos.length > 0
        ? `${behindRepos.length} repo${behindRepos.length > 1 ? "s" : ""} behind remote`
        : "all up to date";
      const parts = [`Fetched ${fetched} repos`];
      if (skipped > 0) parts.push(`${skipped} local-only`);
      if (failed > 0) parts.push(`${failed} failed`);
      parts.push(summary);
      await showResult(`Diffchestrator: ${parts.join(", ")}`, failed > 0);
    }),
    // Bulk pull all repos
    vscode.commands.registerCommand(CMD.bulkPull, async () => {
      const repos = repoManager.repos.filter((r) => r.behind > 0);
      if (repos.length === 0) {
        vscode.window.showInformationMessage("Diffchestrator: All repos are up to date. Run Fetch All first.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Pull ${pluralRepos(repos.length)} that ${repos.length === 1 ? "is" : "are"} behind remote?`,
        { modal: true, detail: formatRepoList(repos.map((r) => r.name)) },
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
      await showResult(`Diffchestrator: Pulled ${success} repos${failed > 0 ? `, ${failed} failed` : ""}`, failed > 0);
    }),
    // Sync All: fetch → (confirm) → ff-only pull clean behind repos → push ahead repos
    vscode.commands.registerCommand(CMD.syncAll, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos to sync.");
        return;
      }

      // Phase 1: fetch (read-only on the working tree, so no confirm needed).
      // Calls the shared helper directly — executing CMD.fetchAll would pop
      // its own summary toast in the middle of the sync.
      const fetchResult = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Sync — fetching", cancellable: false },
        (progress) => fetchRepos(repos, (message) => progress.report({ message }))
      );

      // Plan from fresh ahead/behind state
      const plan = planSync(repoManager.repos);
      const skippedNote = (): string[] => {
        const notes: string[] = [];
        if (plan.skippedDirty.length > 0) {
          notes.push(`Skipping ${pluralRepos(plan.skippedDirty.length)} with uncommitted changes:\n${formatRepoList(plan.skippedDirty.map((r) => r.name), 5)}`);
        }
        if (plan.skippedDiverged.length > 0) {
          notes.push(`Skipping ${pluralRepos(plan.skippedDiverged.length)} that diverged from upstream:\n${formatRepoList(plan.skippedDiverged.map((r) => r.name), 5)}`);
        }
        return notes;
      };

      if (plan.pull.length === 0 && plan.push.length === 0) {
        const parts = ["Diffchestrator: Sync — nothing to pull or push"];
        if (fetchResult.failed > 0) parts.push(`${fetchResult.failed} fetch failed`);
        const skipped = plan.skippedDirty.length + plan.skippedDiverged.length;
        if (skipped > 0) parts.push(`${skipped} skipped (dirty/diverged)`);
        await showResult(parts.join(", "), fetchResult.failed > 0 || skipped > 0);
        return;
      }

      const detail: string[] = [];
      if (plan.pull.length > 0) {
        detail.push(`Pull (fast-forward only) ${pluralRepos(plan.pull.length)}:\n${formatRepoList(plan.pull.map((r) => r.name))}`);
      }
      if (plan.push.length > 0) {
        detail.push(`Push ${pluralRepos(plan.push.length)}:\n${formatRepoList(plan.push.map((r) => r.name))}`);
      }
      detail.push(...skippedNote());
      const confirm = await vscode.window.showWarningMessage(
        `Sync: pull ${pluralRepos(plan.pull.length)} and push ${pluralRepos(plan.push.length)}?`,
        { modal: true, detail: detail.join("\n\n") },
        "Sync"
      );
      if (confirm !== "Sync") return;

      let pulled = 0;
      let pushed = 0;
      let pullFailed = 0;
      let pushFailed = 0;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Diffchestrator: Syncing repos", cancellable: false },
        async (progress) => {
          // Phase 2: fast-forward clean repos that are behind
          if (plan.pull.length > 0) {
            progress.report({ message: `Pulling ${pluralRepos(plan.pull.length)}...` });
            for (let i = 0; i < plan.pull.length; i += BATCH_SMALL) {
              await Promise.all(plan.pull.slice(i, i + BATCH_SMALL).map(async (r) => {
                try {
                  const ok = await sharedGit.pullFastForwardOnly(r.path);
                  if (ok) {
                    pulled++;
                  } else {
                    pullFailed++;
                    outputChannel.appendLine(`[sync-pull] ${r.name}: fast-forward failed (diverged, conflicting untracked files, or no upstream)`);
                  }
                } catch (err) {
                  pullFailed++;
                  outputChannel.appendLine(`[sync-pull] ${r.name}: ${errMsg(err)}`);
                }
                await repoManager.refreshRepo(r.path);
              }));
            }
          }

          // Phase 3: push repos that are only ahead
          if (plan.push.length > 0) {
            progress.report({ message: `Pushing ${pluralRepos(plan.push.length)}...` });
            for (let i = 0; i < plan.push.length; i += BATCH_SMALL) {
              await Promise.all(plan.push.slice(i, i + BATCH_SMALL).map(async (r) => {
                try {
                  await sharedGit.push(r.path);
                  pushed++;
                } catch (err) {
                  pushFailed++;
                  outputChannel.appendLine(`[sync-push] ${r.name}: ${errMsg(err)}`);
                }
                await repoManager.refreshRepo(r.path);
              }));
            }
          }
        }
      );

      const parts = [`Pulled ${pulled}`, `pushed ${pushed}`];
      const failures = fetchResult.failed + pullFailed + pushFailed;
      if (fetchResult.failed > 0) parts.push(`${fetchResult.failed} fetch failed`);
      if (pullFailed > 0) parts.push(`${pullFailed} pull failed`);
      if (pushFailed > 0) parts.push(`${pushFailed} push failed`);
      if (plan.skippedDirty.length > 0) parts.push(`${plan.skippedDirty.length} skipped (uncommitted changes)`);
      if (plan.skippedDiverged.length > 0) parts.push(`${plan.skippedDiverged.length} skipped (diverged)`);
      for (const r of plan.skippedDirty) outputChannel.appendLine(`[sync] ${r.name}: skipped — uncommitted changes`);
      for (const r of plan.skippedDiverged) outputChannel.appendLine(`[sync] ${r.name}: skipped — diverged from upstream`);
      const skipped = plan.skippedDirty.length + plan.skippedDiverged.length;
      await showResult(
        `Diffchestrator: Sync ${failures > 0 ? "finished with errors" : "complete"} — ${parts.join(", ")}`,
        failures > 0 || skipped > 0
      );
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
