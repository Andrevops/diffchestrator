import * as vscode from "vscode";
import type { GitExecutor } from "../git/gitExecutor";

/**
 * TextDocumentContentProvider for the `git-show` URI scheme.
 * Resolves file content from git for diff display.
 *
 * URI format: git-show:/path/to/file?{"path":"file.ts","ref":"HEAD","repoPath":"/repo"}
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private _git: GitExecutor) {}

  /**
   * Invalidate all open git-show documents so VS Code re-fetches content.
   * Call this after commits, staging, or branch changes.
   */
  refresh(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === "git-show") {
        this._onDidChange.fire(doc.uri);
      }
    }
  }

  /** Validate a git ref to prevent flag/command injection */
  private _isValidRef(ref: string): boolean {
    // Allow: HEAD, :0, commit hashes, branch names, stash@{N}, tag names
    // Block: anything starting with - (flag injection), shell metacharacters
    return typeof ref === "string" && ref.length > 0 && ref.length < 256
      && !ref.startsWith("-") && !/[;&|`$(){}]/.test(ref);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const params = JSON.parse(uri.query);
      const { path: filePath, ref, repoPath, fullShow } = params;

      if (!ref) {
        return "";
      }

      if (!this._isValidRef(ref)) return "";

      if (fullShow) {
        return await this._git.show(repoPath, ref);
      }

      const gitRef = ref === "HEAD" ? "HEAD" : ref;
      if (filePath && !this._isValidRef(filePath)) return "";
      const result = await this._git.show(repoPath, `${gitRef}:${filePath}`);
      return result;
    } catch {
      return "";
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
