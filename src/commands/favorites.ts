import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD, CTX } from "../constants";

async function toggleFavorite(itemPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("diffchestrator");
  const favorites = [...config.get<string[]>("favorites", [])];
  const idx = favorites.indexOf(itemPath);
  const name = path.basename(itemPath);

  if (idx >= 0) {
    favorites.splice(idx, 1);
    vscode.window.showInformationMessage(
      `Diffchestrator: Removed ${name} from favorites`
    );
  } else {
    favorites.push(itemPath);
    vscode.window.showInformationMessage(
      `Diffchestrator: Added ${name} to favorites`
    );
  }

  await config.update(
    "favorites",
    favorites,
    vscode.ConfigurationTarget.Global
  );
  vscode.commands.executeCommand(
    "setContext",
    CTX.hasFavorites,
    favorites.length > 0
  );
}

export function registerFavoriteCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  // Toggle favorite from context menu (tree item)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.toggleFavorite,
      async (item?: any) => {
        const itemPath = item?.repo?.path ?? item?.fullPath ?? item?.repoPath ?? item?.path;
        if (!itemPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No item selected to favorite."
          );
          return;
        }
        await toggleFavorite(itemPath);
      }
    )
  );

  // Favorite current repo via keyboard shortcut
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.favoriteCurrent,
      async () => {
        const repoPath = repoManager.selectedRepo;
        const root = repoManager.currentRoot;
        if (!repoPath || (root && !repoPath.startsWith(root + path.sep))) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected in the current root. Use Alt+D, R to pick one."
          );
          return;
        }
        await toggleFavorite(repoPath);
      }
    )
  );
}
