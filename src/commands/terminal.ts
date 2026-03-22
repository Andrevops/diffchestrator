import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export type TerminalKind = "shell" | "claude" | "yolo";

/** Map key: `${repoPath}::${kind}` */
const repoTerminals = new Map<string, vscode.Terminal>();

function key(repoPath: string, kind: TerminalKind): string {
  return `${repoPath}::${kind}`;
}

// Clean up map when terminals close
vscode.window.onDidCloseTerminal((t) => {
  for (const [k, term] of repoTerminals) {
    if (term === t) {
      repoTerminals.delete(k);
      break;
    }
  }
});

/**
 * Name patterns used to detect untracked terminals by scanning
 * vscode.window.terminals. Claude Code renames its terminal to
 * "Claude: <repo>", so we match on that too.
 */
const NAME_PATTERNS: Record<TerminalKind, RegExp[]> = {
  claude: [], // built dynamically from repo name
  yolo: [],
  shell: [],
};

function buildPatterns(repoPath: string, kind: TerminalKind): RegExp[] {
  const name = path.basename(repoPath);
  switch (kind) {
    case "claude":
      return [
        new RegExp(`^Claude:\\s*${escapeRegex(name)}`, "i"),
        new RegExp(`^Claude Code.*${escapeRegex(name)}`, "i"),
      ];
    case "yolo":
      return [new RegExp(`^YOLO:\\s*${escapeRegex(name)}`, "i")];
    case "shell":
      return [new RegExp(`^DC:\\s*${escapeRegex(name)}`, "i")];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAlive(repoPath: string, kind: TerminalKind): vscode.Terminal | undefined {
  // First check the tracked map
  const existing = repoTerminals.get(key(repoPath, kind));
  if (existing && vscode.window.terminals.includes(existing)) {
    return existing;
  }
  // Clean stale entry
  repoTerminals.delete(key(repoPath, kind));

  // Fallback: scan all terminals by name pattern and adopt untracked ones
  const patterns = buildPatterns(repoPath, kind);
  for (const terminal of vscode.window.terminals) {
    if (patterns.some((p) => p.test(terminal.name))) {
      // Adopt it into the map
      repoTerminals.set(key(repoPath, kind), terminal);
      return terminal;
    }
  }

  return undefined;
}

/**
 * Register a terminal in the tracking map.
 */
export function registerRepoTerminal(repoPath: string, kind: TerminalKind, terminal: vscode.Terminal): void {
  repoTerminals.set(key(repoPath, kind), terminal);
}

/**
 * Get an existing alive terminal for a repo + kind, or undefined.
 */
export function getRepoTerminal(repoPath: string, kind: TerminalKind): vscode.Terminal | undefined {
  return getAlive(repoPath, kind);
}

/**
 * Get or create a shell terminal for a repo path.
 */
export function getOrCreateTerminal(repoPath: string): vscode.Terminal {
  const existing = getAlive(repoPath, "shell");
  if (existing) return existing;

  const name = path.basename(repoPath);
  const terminal = vscode.window.createTerminal({
    name: `DC: ${name}`,
    cwd: repoPath,
  });
  repoTerminals.set(key(repoPath, "shell"), terminal);
  return terminal;
}

/**
 * Check if a repo has any active terminal (any kind).
 */
export function hasActiveTerminal(repoPath: string): boolean {
  const kinds: TerminalKind[] = ["claude", "yolo", "shell"];
  return kinds.some((k) => !!getAlive(repoPath, k));
}

/**
 * Switch to the best terminal for a repo (claude > yolo > shell).
 * Returns focus to editor after switching.
 */
export async function showTerminalIfExists(repoPath: string): Promise<boolean> {
  // Priority: claude > yolo > shell
  const kinds: TerminalKind[] = ["claude", "yolo", "shell"];
  for (const kind of kinds) {
    const existing = getAlive(repoPath, kind);
    if (existing) {
      existing.show(false);
      setTimeout(() => {
        vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      }, 100);
      return true;
    }
  }
  return false;
}

export function registerTerminalCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  // Open shell terminal
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.openTerminal,
      (item?: any) => {
        const targetPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!targetPath) {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
          return;
        }
        const terminal = getOrCreateTerminal(targetPath);
        terminal.show();
      }
    )
  );

  // Yolo — reuse existing yolo terminal or create new one
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.yolo,
      (item?: any) => {
        const targetPath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;
        if (!targetPath) {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
          return;
        }

        const existing = getAlive(targetPath, "yolo");
        if (existing) {
          existing.show();
          return;
        }

        const name = path.basename(targetPath);
        const terminal = vscode.window.createTerminal({
          name: `YOLO: ${name}`,
          cwd: targetPath,
        });
        repoTerminals.set(key(targetPath, "yolo"), terminal);
        terminal.show();
        terminal.sendText("yolo");
      }
    )
  );
}
