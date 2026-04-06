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

      const gitRef = ref === "HEAD" ? "HEAD" : ref;
      if (filePath && !isValidRef(filePath)) return "";
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
