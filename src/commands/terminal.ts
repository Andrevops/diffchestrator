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
  const name = escapeRegex(path.basename(repoPath));
  switch (kind) {
    case "claude":
      return [
        new RegExp(`^Claude:\\s*${name}$`, "i"),
        new RegExp(`^Claude Code[^]*${name}$`, "i"),
      ];
    case "yolo":
      // yolo runs claude which renames the terminal, so also check Claude: prefix
      return [
        new RegExp(`^YOLO:\\s*${name}$`, "i"),
      ];
    case "shell":
      return [new RegExp(`^DC:\\s*${name}$`, "i")];
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
 * Find which repo path a terminal belongs to.
 * Pass allRepoPaths (from repoManager.repos) so we can match terminals
 * that aren't in the tracking map yet.
 */
export function findRepoForTerminal(terminal: vscode.Terminal, allRepoPaths: string[]): string | undefined {
  // Check tracked map first
  for (const [k, t] of repoTerminals) {
    if (t === terminal) {
      return k.split("::")[0];
    }
  }
  // Fallback: extract repo name from terminal name and match against all known repos
  const name = terminal.name;
  const patterns: RegExp[] = [
    /^Claude:\s*(.+)$/i,
    /^YOLO:\s*(.+)$/i,
    /^DC:\s*(.+)$/i,
    /^Claude Code\s*-\s*(.+)$/i,
  ];
  for (const regex of patterns) {
    const match = name.match(regex);
    if (match) {
      const repoName = match[1].trim();
      for (const rp of allRepoPaths) {
        if (path.basename(rp) === repoName) {
          // Adopt the terminal into the tracking map
          const kind: TerminalKind =
            /^Claude/i.test(name) ? "claude" :
            /^YOLO/i.test(name) ? "yolo" : "shell";
          repoTerminals.set(key(rp, kind), terminal);
          return rp;
        }
      }
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
      // show(false) takes focus to force the terminal panel to switch tabs
      existing.show(false);
      // Wait for the tab switch to settle, then return focus to editor
      await new Promise((r) => setTimeout(r, 150));
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
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
        repoManager.selectRepo(targetPath);
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

        repoManager.selectRepo(targetPath);
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
