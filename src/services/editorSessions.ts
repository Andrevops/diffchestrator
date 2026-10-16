import * as vscode from "vscode";
import type { RepoManager } from "./repoManager";
import { isWithin, uriBelongsToRepo } from "../utils/paths";

/** Max repos remembered for both the last-open file and full tab sessions (LRU). */
const MAX_REPOS = 20;

/** A tab captured when a repo's editors are closed on switch-away. */
type SavedTab =
  | { kind: "text"; uri: vscode.Uri; viewColumn?: vscode.ViewColumn; active: boolean }
  | {
      kind: "diff";
      original: vscode.Uri;
      modified: vscode.Uri;
      label: string;
      viewColumn?: vscode.ViewColumn;
      active: boolean;
    };

/** Insert/refresh `key` at the MRU end of a Map and evict the oldest beyond `max`. */
function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value as K;
    map.delete(oldest);
  }
}

/**
 * Per-repo editor state for repo switching:
 * - the last file the user had open in each repo (restored when a clean repo
 *   is revisited), tracked from active-editor changes;
 * - the full tab session closed on switch-away (restored on return).
 */
export class EditorSessions implements vscode.Disposable {
  private readonly _lastOpenFile = new Map<string, vscode.Uri>();
  private readonly _savedTabs = new Map<string, SavedTab[]>();
  /** >0 while a repo switch is closing/opening editors — ignore editor changes */
  private _switching = 0;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _repoManager: RepoManager,
    private readonly _log: (msg: string) => void
  ) {
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this._onActiveEditor(editor))
    );
  }

  private _onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (this._switching > 0) return; // ignore changes caused by repo switch
    const repoPath = this._repoManager.selectedRepo;
    if (!repoPath) return;

    if (!editor) {
      // All editors closed while user is in this repo — clear memory
      this._lastOpenFile.delete(repoPath);
      return;
    }

    const uri = editor.document.uri;
    // Trailing separator so /x/foo doesn't match /x/foo-bar
    if ((uri.scheme === "file" && isWithin(uri.fsPath, repoPath)) || uri.scheme === "git-show") {
      lruSet(this._lastOpenFile, repoPath, uri, MAX_REPOS);
    }
  }

  /** Run `fn` with active-editor tracking suspended (repo switch in progress). */
  async duringSwitch<T>(fn: () => Promise<T>): Promise<T> {
    this._switching++;
    try {
      return await fn();
    } finally {
      this._switching--;
    }
  }

  rememberedFile(repoPath: string): vscode.Uri | undefined {
    return this._lastOpenFile.get(repoPath);
  }

  forgetRememberedFile(repoPath: string): void {
    this._lastOpenFile.delete(repoPath);
  }

  /**
   * Close editors that belong to a specific repo path, remembering the full
   * tab set so returning to the repo restores the session — not just one file.
   */
  async closeEditorsForRepo(repoPath: string): Promise<void> {
    const tabsToClose: vscode.Tab[] = [];
    const saved: SavedTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as Record<string, unknown> | undefined;
        if (input?.uri && uriBelongsToRepo(input.uri as vscode.Uri, repoPath)) {
          tabsToClose.push(tab);
          saved.push({
            kind: "text",
            uri: input.uri as vscode.Uri,
            viewColumn: group.viewColumn,
            active: tab.isActive && group.isActive,
          });
        } else if (
          input?.original &&
          input?.modified &&
          (uriBelongsToRepo(input.original as vscode.Uri, repoPath) ||
            uriBelongsToRepo(input.modified as vscode.Uri, repoPath))
        ) {
          tabsToClose.push(tab);
          saved.push({
            kind: "diff",
            original: input.original as vscode.Uri,
            modified: input.modified as vscode.Uri,
            label: tab.label,
            viewColumn: group.viewColumn,
            active: tab.isActive && group.isActive,
          });
        }
      }
    }
    if (tabsToClose.length > 0) {
      lruSet(this._savedTabs, repoPath, saved, MAX_REPOS);
      await vscode.window.tabGroups.close(tabsToClose);
    }
  }

  /** Restore a previously captured tab session. Returns true if anything reopened. */
  async restoreEditorsForRepo(repoPath: string, preserveFocus: boolean): Promise<boolean> {
    const saved = this._savedTabs.get(repoPath);
    if (!saved || saved.length === 0) return false;
    this._savedTabs.delete(repoPath); // the tabs are live again; re-captured on next switch
    // Open the previously-active tab last so it ends up focused.
    const ordered = [...saved.filter((t) => !t.active), ...saved.filter((t) => t.active)];
    let restored = false;
    for (const t of ordered) {
      const focusOpts = { preview: false, preserveFocus: preserveFocus || !t.active };
      try {
        if (t.kind === "text") {
          await vscode.window.showTextDocument(t.uri, { ...focusOpts, viewColumn: t.viewColumn });
        } else {
          await vscode.commands.executeCommand("vscode.diff", t.original, t.modified, t.label, {
            ...focusOpts,
            viewColumn: t.viewColumn,
          });
        }
        restored = true;
      } catch (err) {
        // File deleted / ref gone since capture — skip it
        this._log(`[restore tabs] ${err instanceof Error ? err.message : err}`);
      }
    }
    return restored;
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
  }
}
