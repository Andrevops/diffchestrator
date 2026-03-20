import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerScanCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.scan, async () => {
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const configuredRoots = config.get<string[]>("scanRoots", []);

      let rootPath: string | undefined;

      if (configuredRoots.length > 0) {
        // Let user pick from configured roots or browse
        const items: vscode.QuickPickItem[] = configuredRoots.map((r) => ({
          label: r,
          description: "Configured root",
        }));
        items.push({
          label: "$(folder) Browse...",
          description: "Select a folder to scan",
        });

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: "Select root directory to scan for repositories",
        });

        if (!picked) return;

        if (picked.label.startsWith("$(folder)")) {
          const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: "Select root directory to scan",
          });
          if (!folders || folders.length === 0) return;
          rootPath = folders[0].fsPath;
        } else {
          rootPath = picked.label;
        }
      } else {
        const folders = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          title: "Select root directory to scan for repositories",
        });
        if (!folders || folders.length === 0) return;
        rootPath = folders[0].fsPath;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Diffchestrator: Scanning for repositories",
          cancellable: false,
        },
        async (progress) => {
          const listener = repoManager.onDidScanProgress((p) => {
            progress.report({
              message: `${p.dirsScanned} dirs scanned, ${p.reposFound} repos found`,
            });
          });

          try {
            await repoManager.scan(rootPath!);
            const count = repoManager.repos.length;
            vscode.window.showInformationMessage(
              `Diffchestrator: Found ${count} repositor${count === 1 ? "y" : "ies"}`
            );
          } finally {
            listener.dispose();
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.rescan, async () => {
      const root = repoManager.currentRoot;
      if (!root) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No previous scan root. Use 'Scan for Repositories' first."
        );
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Diffchestrator: Rescanning repositories",
          cancellable: false,
        },
        async (progress) => {
          const listener = repoManager.onDidScanProgress((p) => {
            progress.report({
              message: `${p.dirsScanned} dirs scanned, ${p.reposFound} repos found`,
            });
          });

          try {
            await repoManager.scan(root);
            const count = repoManager.repos.length;
            vscode.window.showInformationMessage(
              `Diffchestrator: Found ${count} repositor${count === 1 ? "y" : "ies"}`
            );
          } finally {
            listener.dispose();
          }
        }
      );
    })
  );
}
