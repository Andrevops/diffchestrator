import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { resolveRepoPath } from "../utils/fileItem";

export function registerRepoInfoCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
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
}
