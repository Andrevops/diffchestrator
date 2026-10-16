import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "./repoManager";
import { CMD, CONFIG } from "../constants";
import { timeAgoShort } from "../utils/time";

interface BlameResult {
  hash: string;
  author: string;
  date: string;
  summary: string;
}

interface BlameCacheEntry {
  blame: BlameResult | null;
  time: number;
}

/**
 * Per-line blame results keyed by (absolute file path, line). Line numbers
 * are only meaningful for one version of a file, so callers must drop a
 * file's entries whenever its text changes (edit, save) and everything when
 * HEAD moves (commit, checkout, pull). Bounded FIFO + TTL as a backstop.
 */
export class BlameCache {
  static readonly TTL = 30_000; // 30s
  static readonly MAX = 200;
  private _entries = new Map<string, BlameCacheEntry>();

  private static _key(filePath: string, line: number): string {
    return `${filePath}\0${line}`;
  }

  get(filePath: string, line: number, now = Date.now()): BlameCacheEntry | undefined {
    const e = this._entries.get(BlameCache._key(filePath, line));
    return e && now - e.time < BlameCache.TTL ? e : undefined;
  }

  set(filePath: string, line: number, blame: BlameResult | null, now = Date.now()): void {
    // Evict oldest entries when cache is full
    if (this._entries.size >= BlameCache.MAX) {
      const first = this._entries.keys().next().value;
      if (first !== undefined) this._entries.delete(first);
    }
    this._entries.set(BlameCache._key(filePath, line), { blame, time: now });
  }

  invalidateFile(filePath: string): void {
    const prefix = filePath + "\0";
    for (const k of [...this._entries.keys()]) {
      if (k.startsWith(prefix)) this._entries.delete(k);
    }
  }

  clear(): void {
    this._entries.clear();
  }

  get size(): number {
    return this._entries.size;
  }
}

export class InlineBlameService implements vscode.Disposable {
  private _git;
  private _repoManager: RepoManager;
  private _disposables: vscode.Disposable[] = [];
  private _decorationType: vscode.TextEditorDecorationType;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _enabled: boolean;
  private _blameCache = new BlameCache();
  /** Monotonic request sequence — stale async results must not overwrite newer ones */
  private _blameSeq = 0;

  constructor(repoManager: RepoManager) {
    this._repoManager = repoManager;
    this._git = repoManager.git;
    const config = vscode.workspace.getConfiguration("diffchestrator");
    this._enabled = config.get<boolean>("showInlineBlame", true);

    this._decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
        margin: "0 0 0 3em",
      },
      isWholeLine: true,
    });

    // Listen for cursor position changes
    this._disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!this._enabled) return;
        this._debouncedUpdate(e.textEditor);
      })
    );

    // Listen for active editor change
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!this._enabled || !editor) return;
        this._debouncedUpdate(editor);
      })
    );

    // Cached line numbers are only valid for the text they were computed
    // from: drop a file's entries on edit/save, everything when HEAD moves.
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme === "file" && e.contentChanges.length > 0) {
          this._blameCache.invalidateFile(e.document.uri.fsPath);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === "file") this._blameCache.invalidateFile(doc.uri.fsPath);
      }),
      // Fires on commit, checkout, pull, reset (any HEAD/status change)
      repoManager.onDidChangeRepos(() => this._blameCache.clear())
    );

    // Listen for config changes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG.showInlineBlame)) {
          const cfg = vscode.workspace.getConfiguration("diffchestrator");
          this._enabled = cfg.get<boolean>("showInlineBlame", true);
          if (!this._enabled) {
            this._clearDecorations();
          }
        }
      })
    );

    // Toggle command
    this._disposables.push(
      vscode.commands.registerCommand(CMD.toggleBlame, () => {
        this._enabled = !this._enabled;
        // Persist to settings
        const cfg = vscode.workspace.getConfiguration("diffchestrator");
        cfg.update("showInlineBlame", this._enabled, vscode.ConfigurationTarget.Global);
        if (!this._enabled) {
          this._clearDecorations();
        } else {
          const editor = vscode.window.activeTextEditor;
          if (editor) void this._updateBlame(editor);
        }
        vscode.window.showInformationMessage(
          `Diffchestrator: Inline blame ${this._enabled ? "enabled" : "disabled"}`
        );
      })
    );
  }

  private _debouncedUpdate(editor: vscode.TextEditor): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      void this._updateBlame(editor);
    }, 300);
  }

  private _clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this._decorationType, []);
    }
  }

  private _findRepoForFile(filePath: string): string | undefined {
    for (const repo of this._repoManager.repos) {
      if (filePath.startsWith(repo.path + path.sep) || filePath === repo.path) {
        return repo.path;
      }
    }
    return undefined;
  }

  private async _updateBlame(editor: vscode.TextEditor): Promise<void> {
    if (!this._enabled) return;
    // Sequence guard: a slow `git blame` must not overwrite the decoration
    // set by a newer (e.g. cache-hit) request, or write to a stale editor.
    const seq = ++this._blameSeq;

    const doc = editor.document;
    // Only for file:// URIs
    if (doc.uri.scheme !== "file") {
      editor.setDecorations(this._decorationType, []);
      return;
    }

    const filePath = doc.uri.fsPath;
    const repoPath = this._findRepoForFile(filePath);
    if (!repoPath) {
      editor.setDecorations(this._decorationType, []);
      return;
    }

    const line = editor.selection.active.line + 1; // 1-based
    if (line < 1 || doc.lineAt(line - 1).text.trim() === "") {
      editor.setDecorations(this._decorationType, []);
      return;
    }

    const relativePath = path.relative(repoPath, filePath);

    try {
      const cached = this._blameCache.get(filePath, line);
      if (cached) {
        if (!cached.blame) {
          editor.setDecorations(this._decorationType, []);
          return;
        }
        const decoration: vscode.DecorationOptions = {
          range: new vscode.Range(line - 1, 0, line - 1, 0),
          renderOptions: {
            after: {
              contentText: `  ${cached.blame.author}, ${timeAgoShort(cached.blame.date)} — ${cached.blame.summary}`,
            },
          },
        };
        editor.setDecorations(this._decorationType, [decoration]);
        return;
      }

      // Unsaved edits shift lines relative to the file on disk — blame the
      // buffer itself so the annotation matches the line the cursor is on.
      const version = doc.version;
      const blame = await this._git.blame(
        repoPath,
        relativePath,
        line,
        doc.isDirty ? doc.getText() : undefined
      );
      // The text changed while git ran: the result describes an older
      // version, so neither cache nor show it.
      if (doc.version !== version) return;
      // Result is still valid for the cache, but a newer request (or editor
      // switch) owns the decoration now — don't overwrite it with stale data.
      const stale = seq !== this._blameSeq || editor !== vscode.window.activeTextEditor;
      if (!blame || blame.hash.startsWith("0000000")) {
        this._blameCache.set(filePath, line, null);
        if (stale) return;
        editor.setDecorations(this._decorationType, []);
        return;
      }
      this._blameCache.set(filePath, line, blame);
      if (stale) return;

      const decoration: vscode.DecorationOptions = {
        range: new vscode.Range(line - 1, 0, line - 1, 0),
        renderOptions: {
          after: {
            contentText: `  ${blame.author}, ${timeAgoShort(blame.date)} — ${blame.summary}`,
          },
        },
      };

      editor.setDecorations(this._decorationType, [decoration]);
    } catch {
      if (seq !== this._blameSeq || editor !== vscode.window.activeTextEditor) return;
      editor.setDecorations(this._decorationType, []);
    }
  }

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._decorationType.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
