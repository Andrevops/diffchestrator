import * as vscode from "vscode";
import type { GitExecutor } from "../git/gitExecutor";
import { isValidRef } from "../utils/gitValidation";

/**
 * TextDocumentContentProvider for the `git-show` URI scheme.
 * Resolves file content from git for diff display.
 *
 * URI format: git-show:/path/to/file?{"path":"file.ts","ref":"HEAD","repoPath":"/repo"}
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private _git: GitExecutor;

  // Explicit field (not a parameter property) so Node's strip-only
  // TypeScript loader can run this module in unit tests.
  constructor(git: GitExecutor) {
    this._git = git;
  }

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

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const params = JSON.parse(uri.query);
      const { path: filePath, ref, repoPath, fullShow } = params;

      if (!ref) {
        return "";
      }

      if (!isValidRef(ref)) return "";

      if (fullShow) {
        return await this._git.show(repoPath, ref);
      }

      // Only the ref is validated: paths legitimately contain ( ) $ & ; { }
      // (e.g. Next.js "app/(auth)/page.tsx"). git receives the "<ref>:<path>"
      // arg via execFile (no shell), and it can't start with "-" because a
      // valid ref doesn't.
      if (typeof filePath !== "string" || !filePath) return "";
      const result = await this._git.show(repoPath, `${ref}:${filePath}`);
      return result;
    } catch {
      return "";
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
