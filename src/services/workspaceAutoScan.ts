import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import type { RepoManager } from "./repoManager";

/**
 * Auto-scan for git repos when workspace folders change or on startup
 * if no scanRoots are configured.
 */
export class WorkspaceAutoScan implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private _repoManager: RepoManager,
    private _fileWatcher: { watchAll(): void },
  ) {
    // Listen for workspace folder changes
    this._disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const folder of e.added) {
          this._checkAndOfferScan(folder.uri.fsPath).catch((err) => {
            console.error("[diffchestrator] workspace folder auto-scan failed:", err);
          });
        }
      })
    );

    // On startup: if scanRoots is empty, check workspace folders
    this._autoScanOnStartup().catch((err) => {
      console.error("[diffchestrator] startup auto-scan failed:", err);
    });
  }

  private async _autoScanOnStartup(): Promise<void> {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const roots = config.get<string[]>("scanRoots", []);

    if (roots.length > 0) return; // Already configured

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    // Check each workspace folder for git repos
    for (const folder of folders) {
      const hasGit = await this._containsGitRepo(folder.uri.fsPath);
      if (hasGit) {
        const answer = await vscode.window.showInformationMessage(
          `Diffchestrator: Workspace folder "${folder.name}" contains git repos. Add it to scan roots?`,
          "Yes",
          "No"
        );

        if (answer === "Yes") {
          const current = config.get<string[]>("scanRoots", []);
          if (!current.includes(folder.uri.fsPath)) {
            await config.update(
              "scanRoots",
              [...current, folder.uri.fsPath],
              vscode.ConfigurationTarget.Global
            );
          }
          try {
            await this._repoManager.scan(folder.uri.fsPath);
            this._fileWatcher.watchAll();
          } catch (err) {
            vscode.window.showErrorMessage(
              `Diffchestrator: Failed to scan "${folder.name}": ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }
    }
  }

  private async _checkAndOfferScan(folderPath: string): Promise<void> {
    const hasGit = await this._containsGitRepo(folderPath);
    if (!hasGit) return;

    const answer = await vscode.window.showInformationMessage(
      `Diffchestrator: New folder "${path.basename(folderPath)}" contains git repos. Add to scan roots?`,
      "Yes",
      "No"
    );

    if (answer === "Yes") {
      const config = vscode.workspace.getConfiguration("diffchestrator");
      const current = config.get<string[]>("scanRoots", []);
      if (!current.includes(folderPath)) {
        await config.update(
          "scanRoots",
          [...current, folderPath],
          vscode.ConfigurationTarget.Global
        );
      }
      try {
        await this._repoManager.scan(folderPath);
        this._fileWatcher.watchAll();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Diffchestrator: Failed to scan "${path.basename(folderPath)}": ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }

  /**
   * Check if a directory or its immediate children contain a .git folder.
   * Only looks 2 levels deep to keep it fast. Fully async to avoid blocking.
   */
  private async _containsGitRepo(dirPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(dirPath, ".git"));
      return true;
    } catch { /* not found */ }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
          try {
            await fs.access(path.join(dirPath, entry.name, ".git"));
            return true;
          } catch { /* not found */ }
        }
      }
    } catch {
      /* permission denied etc */
    }
    return false;
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
