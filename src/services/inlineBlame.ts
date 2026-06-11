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

export class InlineBlameService implements vscode.Disposable {
  private _git;
  private _disposables: vscode.Disposable[] = [];
  private _decorationType: vscode.TextEditorDecorationType;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _enabled: boolean;
  /** LRU blame cache: "repoPath:relativePath:line" → result */
  private _blameCache = new Map<string, BlameCacheEntry>();
  private static readonly BLAME_CACHE_TTL = 30_000; // 30s
  private static readonly BLAME_CACHE_MAX = 200;
  /** Monotonic request sequence — stale async results must not overwrite newer ones */
  private _blameSeq = 0;

  constructor(private _repoManager: RepoManager) {
    this._git = _repoManager.git;
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
          if (editor) this._updateBlame(editor);
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
      this._updateBlame(editor);
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
      const cacheKey = `${repoPath}:${relativePath}:${line}`;
      const cached = this._blameCache.get(cacheKey);
      if (cached && Date.now() - cached.time < InlineBlameService.BLAME_CACHE_TTL) {
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

      const blame = await this._git.blame(repoPath, relativePath, line);
      // Result is still valid for the cache, but a newer request (or editor
      // switch) owns the decoration now — don't overwrite it with stale data.
      const stale = seq !== this._blameSeq || editor !== vscode.window.activeTextEditor;
      if (!blame || blame.hash.startsWith("0000000")) {
        this._setCacheEntry(cacheKey, null);
        if (stale) return;
        editor.setDecorations(this._decorationType, []);
        return;
      }
      this._setCacheEntry(cacheKey, blame);
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

  private _setCacheEntry(key: string, blame: BlameResult | null): void {
    // Evict oldest entries when cache is full
    if (this._blameCache.size >= InlineBlameService.BLAME_CACHE_MAX) {
      const first = this._blameCache.keys().next().value;
      if (first !== undefined) this._blameCache.delete(first);
    }
    this._blameCache.set(key, { blame, time: Date.now() });
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
