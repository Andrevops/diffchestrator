import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { resolveRepoPath } from "../utils/fileItem";

export function registerTagCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
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
}
