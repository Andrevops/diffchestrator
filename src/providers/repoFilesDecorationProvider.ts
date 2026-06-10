import * as vscode from "vscode";
import { ChangeType, FileStatus } from "../types";
import type { FileChange } from "../types";
import type { RepoFilesProvider } from "./repoFilesProvider";

/**
 * Git-status badges and colors for the Repo Files tree.
 *
 * The built-in git extension only decorates repos it knows about (workspace
 * repos), and selected repos are deliberately never workspace folders — so
 * without this provider, changed files render identically to clean ones.
 * Registration is window-global, which also colors matching editor tabs.
 */
export class RepoFilesDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private _disposables: vscode.Disposable[] = [];

  constructor(private _files: RepoFilesProvider) {
    this._disposables.push(
      vscode.window.registerFileDecorationProvider(this),
      _files.onDidUpdateChanges(() => this._onDidChangeFileDecorations.fire(undefined)),
    );
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== "file") return undefined;
    const change = this._files.getChange(uri.fsPath);
    if (change) {
      const decoration = new vscode.FileDecoration(
        badgeFor(change),
        `${change.status} (${change.changeType})`,
        colorFor(change),
      );
      decoration.propagate = true; // bubble color up to parent folders
      return decoration;
    }
    if (this._files.isIgnored(uri.fsPath)) {
      return new vscode.FileDecoration(
        undefined,
        "Gitignored",
        new vscode.ThemeColor("gitDecoration.ignoredResourceForeground"),
      );
    }
    return undefined;
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._onDidChangeFileDecorations.dispose();
  }
}

function badgeFor(fc: FileChange): string {
  if (fc.status === FileStatus.Untracked) return "U";
  switch (fc.changeType) {
    case ChangeType.Added:
      return "A";
    case ChangeType.Deleted:
      return "D";
    case ChangeType.Renamed:
      return "R";
    case ChangeType.Unmerged:
      return "!";
    default:
      return "M";
  }
}

function colorFor(fc: FileChange): vscode.ThemeColor {
  if (fc.status === FileStatus.Untracked) {
    return new vscode.ThemeColor("gitDecoration.untrackedResourceForeground");
  }
  if (fc.changeType === ChangeType.Unmerged) {
    return new vscode.ThemeColor("gitDecoration.conflictingResourceForeground");
  }
  if (fc.status === FileStatus.Staged) {
    switch (fc.changeType) {
      case ChangeType.Added:
        return new vscode.ThemeColor("gitDecoration.addedResourceForeground");
      case ChangeType.Deleted:
        return new vscode.ThemeColor("gitDecoration.stagedDeletedResourceForeground");
      default:
        return new vscode.ThemeColor("gitDecoration.stagedModifiedResourceForeground");
    }
  }
  if (fc.changeType === ChangeType.Deleted) {
    return new vscode.ThemeColor("gitDecoration.deletedResourceForeground");
  }
  return new vscode.ThemeColor("gitDecoration.modifiedResourceForeground");
}
