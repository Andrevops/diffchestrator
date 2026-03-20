import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { CMD, CTX } from "../constants";

export function registerFavoriteCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  void repoManager;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.toggleFavorite,
      async (item?: any) => {
        // Extract path from TreeNode (context menu) or { path } (command palette)
        const itemPath = item?.repo?.path ?? item?.fullPath ?? item?.path;
        if (!itemPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No item selected to favorite."
          );
          return;
        }

        const config = vscode.workspace.getConfiguration("diffchestrator");
        const favorites = [...config.get<string[]>("favorites", [])];
        const idx = favorites.indexOf(itemPath);

        if (idx >= 0) {
          favorites.splice(idx, 1);
          vscode.window.showInformationMessage(
            `Removed from favorites`
          );
        } else {
          favorites.push(itemPath);
          vscode.window.showInformationMessage(
            `Added to favorites`
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
    )
  );
}
