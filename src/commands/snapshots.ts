import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import type { FileWatcher } from "../services/fileWatcher";
import { CMD } from "../constants";

export function registerSnapshotCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  fileWatcher: FileWatcher
): void {
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
        recent: [...repoManager.recentRepoPaths],
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
}
