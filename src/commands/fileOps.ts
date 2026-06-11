import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD, CONFIG } from "../constants";
import { terminalIcon } from "./terminal";

export function registerFileOpsCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  // Repo Files tree — file operations
  type FileOpNode = { uri: vscode.Uri; isDirectory?: boolean };
  const fileOpTargets = (node?: FileOpNode, nodes?: FileOpNode[]): FileOpNode[] =>
    (nodes?.length ? nodes : node ? [node] : []).filter((n) => !!n?.uri);
  const showFileOpError = (action: string, err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Diffchestrator: Failed to ${action}: ${msg}`);
  };
  /** Resolve a new-entry name against a directory, confined to the repo. */
  const resolveNewEntryPath = (dir: string, name: string): string | undefined => {
    const root = repoManager.selectedRepo ?? dir;
    const target = path.resolve(dir, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      vscode.window.showErrorMessage("Diffchestrator: Path escapes the repository.");
      return undefined;
    }
    return target;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fileDelete, async (node?: FileOpNode, nodes?: FileOpNode[]) => {
      const targets = fileOpTargets(node, nodes);
      if (targets.length === 0) return;
      const label =
        targets.length === 1
          ? `"${path.basename(targets[0].uri.fsPath)}"`
          : `${targets.length} items`;
      const yes = await vscode.window.showWarningMessage(
        `Move ${label} to the trash?`, { modal: true }, "Move to Trash"
      );
      if (yes !== "Move to Trash") return;
      for (const t of targets) {
        try {
          await vscode.workspace.fs.delete(t.uri, { recursive: true, useTrash: true });
        } catch (err: unknown) {
          showFileOpError(`delete ${path.basename(t.uri.fsPath)}`, err);
        }
      }
    }),
    vscode.commands.registerCommand(CMD.fileRename, async (node?: FileOpNode) => {
      if (!node?.uri) return;
      const oldPath = node.uri.fsPath;
      const oldName = path.basename(oldPath);
      const newName = await vscode.window.showInputBox({
        prompt: "New name",
        value: oldName,
        valueSelection: [0, oldName.lastIndexOf(".") > 0 ? oldName.lastIndexOf(".") : oldName.length],
        validateInput: (v) => {
          if (!v.trim()) return "Name is required";
          if (v.includes("/") || v.includes("\\")) return "Name cannot contain path separators";
          return undefined;
        },
      });
      if (!newName || newName === oldName) return;
      const newPath = path.join(path.dirname(oldPath), newName);
      try {
        // Skip the exists-precheck for case-only renames: on case-insensitive
        // filesystems (macOS/Windows/some WSL mounts) stat(newPath) resolves to
        // the old file itself and would wrongly reject the rename.
        if (newName.toLowerCase() !== oldName.toLowerCase()) {
          let exists = true;
          try { await fs.promises.stat(newPath); } catch { exists = false; }
          if (exists) {
            vscode.window.showErrorMessage(`Diffchestrator: "${newName}" already exists.`);
            return;
          }
        }
        await fs.promises.rename(oldPath, newPath);
      } catch (err: unknown) {
        showFileOpError(`rename ${oldName}`, err);
      }
    }),
    vscode.commands.registerCommand(CMD.fileCopyPath, async (node?: FileOpNode, nodes?: FileOpNode[]) => {
      const targets = fileOpTargets(node, nodes);
      if (targets.length === 0) return;
      await vscode.env.clipboard.writeText(targets.map((t) => t.uri.fsPath).join("\n"));
    }),
    vscode.commands.registerCommand(CMD.fileCopyRelativePath, async (node?: FileOpNode, nodes?: FileOpNode[]) => {
      const targets = fileOpTargets(node, nodes);
      if (targets.length === 0) return;
      const root = repoManager.selectedRepo;
      await vscode.env.clipboard.writeText(
        targets
          .map((t) => (root ? path.relative(root, t.uri.fsPath) : t.uri.fsPath))
          .join("\n"),
      );
    }),
    vscode.commands.registerCommand(CMD.fileRevealInExplorer, async (node?: FileOpNode) => {
      if (!node?.uri) return;
      try {
        await vscode.commands.executeCommand("revealFileInOS", node.uri);
      } catch (err: unknown) {
        showFileOpError("reveal in explorer", err);
      }
    }),
    vscode.commands.registerCommand(CMD.fileOpenTerminal, async (node?: FileOpNode) => {
      if (!node?.uri) return;
      const dir = node.isDirectory ? node.uri.fsPath : path.dirname(node.uri.fsPath);
      const terminal = vscode.window.createTerminal({ cwd: dir, name: path.basename(dir), iconPath: terminalIcon("shell") });
      terminal.show();
    }),
    vscode.commands.registerCommand(CMD.fileNewFile, async (node?: FileOpNode) => {
      const root = repoManager.selectedRepo;
      if (!root && !node?.uri) return;
      const dir = node?.isDirectory ? node.uri.fsPath : node?.uri ? path.dirname(node.uri.fsPath) : root!;
      const name = await vscode.window.showInputBox({
        prompt: "File name (use / to create inside new folders)",
        validateInput: (v) => (v.trim() ? undefined : "Name is required"),
      });
      if (!name) return;
      const filePath = resolveNewEntryPath(dir, name);
      if (!filePath) return;
      try {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        // wx: fail instead of truncating an existing file
        await fs.promises.writeFile(filePath, "", { flag: "wx" });
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
          vscode.window.showErrorMessage(`Diffchestrator: "${name}" already exists.`);
        } else {
          showFileOpError("create file", err);
        }
      }
    }),
    vscode.commands.registerCommand(CMD.fileNewFolder, async (node?: FileOpNode) => {
      const root = repoManager.selectedRepo;
      if (!root && !node?.uri) return;
      const dir = node?.isDirectory ? node.uri.fsPath : node?.uri ? path.dirname(node.uri.fsPath) : root!;
      const name = await vscode.window.showInputBox({
        prompt: "Folder name (use / for nested folders)",
        validateInput: (v) => (v.trim() ? undefined : "Name is required"),
      });
      if (!name) return;
      const folderPath = resolveNewEntryPath(dir, name);
      if (!folderPath) return;
      try {
        await fs.promises.mkdir(folderPath, { recursive: true });
      } catch (err: unknown) {
        showFileOpError("create folder", err);
      }
    }),
    vscode.commands.registerCommand(CMD.fileToggleIgnored, async () => {
      const cfg = vscode.workspace.getConfiguration();
      const current = cfg.get<boolean>(CONFIG.filesHideIgnored, false);
      await cfg.update(CONFIG.filesHideIgnored, !current, vscode.ConfigurationTarget.Global);
      // The provider refreshes itself via its onDidChangeConfiguration listener.
    }),
  );
}
