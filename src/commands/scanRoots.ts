import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import type { FileWatcher } from "../services/fileWatcher";
import { CMD } from "../constants";
import { registerRepoTerminal } from "./terminal";

export function registerScanRootCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  fileWatcher: FileWatcher
): void {
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
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Diffchestrator: Scanning ${path.basename(rootPath)}` },
          async () => {
            await repoManager.scan(rootPath!);
            fileWatcher.watchAll();
          }
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Diffchestrator: Failed to scan ${path.basename(rootPath)}: ${err instanceof Error ? err.message : err}`
        );
      }
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
}
