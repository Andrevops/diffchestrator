import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import { CMD, CTX } from "../constants";

export function registerFavoriteCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  // Suppress unused parameter warning — repoManager reserved for future use
  void repoManager;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.toggleFavorite,
      async (item?: { path?: string }) => {
        if (!item?.path) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected to favorite."
          );
          return;
        }

        const config = vscode.workspace.getConfiguration("diffchestrator");
        const favorites = [...config.get<string[]>("favorites", [])];
        const idx = favorites.indexOf(item.path);

        if (idx >= 0) {
          favorites.splice(idx, 1);
          vscode.window.showInformationMessage(
            `Diffchestrator: Removed from favorites`
          );
        } else {
          favorites.push(item.path);
          vscode.window.showInformationMessage(
            `Diffchestrator: Added to favorites`
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
