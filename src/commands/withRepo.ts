import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { resolveRepoPath } from "../utils/fileItem";

export const NO_REPO_MESSAGE = "Diffchestrator: No repository selected.";

export interface WithRepoOptions {
  /** Ignore the command argument and always act on the selected repo. */
  selectedOnly?: boolean;
  /** Warning shown when no repo resolves (defaults to NO_REPO_MESSAGE). */
  message?: string;
}

/**
 * Wrap a command handler that needs a repo path: resolves it from the
 * command argument (tree item, `{ path }`, …) falling back to the selected
 * repo, and shows the standard "No repository selected" warning otherwise.
 * The original argument is passed through for handlers that read more
 * from it (e.g. `preserveFocus`).
 */
export function withRepo<R>(
  repoManager: Pick<RepoManager, "selectedRepo">,
  fn: (repoPath: string, item?: any) => R | Promise<R>,
  opts: WithRepoOptions = {}
): (item?: any) => Promise<R | undefined> {
  return async (item?: any) => {
    const repoPath = opts.selectedOnly
      ? repoManager.selectedRepo
      : resolveRepoPath(item, repoManager.selectedRepo);
    if (!repoPath) {
      void vscode.window.showWarningMessage(opts.message ?? NO_REPO_MESSAGE);
      return undefined;
    }
    return fn(repoPath, item);
  };
}
