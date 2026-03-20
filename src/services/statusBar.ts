import * as vscode from "vscode";
import type { RepoManager } from "./repoManager";

export class StatusBarManager implements vscode.Disposable {
  private _item: vscode.StatusBarItem;
  private _repoManager: RepoManager;
  private _disposables: vscode.Disposable[] = [];

  constructor(repoManager: RepoManager) {
    this._repoManager = repoManager;

    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this._item.command = "workbench.view.extension.diffchestrator";
    this._item.tooltip = "Open Diffchestrator sidebar";
    this._item.show();

    // Set initial scanning state
    this.showScanning();

    // Listen for repo changes
    this._repoManager.onDidChangeRepos(
      () => this._refresh(),
      null,
      this._disposables
    );
  }

  showScanning(): void {
    this._item.text = "$(loading~spin) Scanning...";
    this._item.tooltip = "Diffchestrator: Scanning for repositories...";
  }

  private _refresh(): void {
    const repos = this._repoManager.repos;
    const repoCount = repos.length;
    const changeCount = repos.reduce((sum, r) => sum + r.totalChanges, 0);

    this._item.text = `$(git-branch) ${repoCount} repo${repoCount !== 1 ? "s" : ""}, ${changeCount} change${changeCount !== 1 ? "s" : ""}`;
    this._item.tooltip = `Diffchestrator: ${repoCount} repositories, ${changeCount} total changes`;
  }

  dispose(): void {
    this._item.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
