import * as vscode from "vscode";
import type { RepoManager } from "./repoManager";
import { CMD } from "../constants";
import { showTerminalIfExists } from "../commands/terminal";

export function registerNotifications(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  outputChannel: vscode.OutputChannel
): void {
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
}
