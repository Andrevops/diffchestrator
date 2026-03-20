import * as vscode from "vscode";
import { GitExecutor } from "../git/gitExecutor";

/**
 * TextDocumentContentProvider for the `git-show` URI scheme.
 * Resolves file content from git for diff display.
 *
 * URI format: git-show:/path/to/file?{"path":"file.ts","ref":"HEAD","repoPath":"/repo"}
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private _git = new GitExecutor();

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const params = JSON.parse(uri.query);
      const { path: filePath, ref, repoPath } = params;

      if (!ref) {
        // Empty ref = empty content (for new files being staged)
        return "";
      }

      // git show REF:path
      const gitRef = ref === "HEAD" ? "HEAD" : ref;
      const result = await this._git.show(repoPath, `${gitRef}:${filePath}`);
      return result;
    } catch {
      return "";
    }
  }
}
