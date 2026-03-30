import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { escapeForTerminal } from "../utils/shell";

const execFileAsync = promisify(execFile);

export type TerminalKind = "shell" | "claude" | "yolo";

/**
 * Check if a command exists on the system.
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that required CLI tools are available before running a command.
 * Returns true if all tools are available, false otherwise (shows warning).
 */
export async function validateCli(kind: "claude" | "yolo"): Promise<boolean> {
  if (kind === "yolo") {
    // yolo alias requires both docker and claude
    const [hasDocker, hasClaude] = await Promise.all([
      commandExists("docker"),
      commandExists("claude"),
    ]);
    const missing: string[] = [];
    if (!hasDocker) missing.push("docker");
    if (!hasClaude) missing.push("claude");
    if (missing.length > 0) {
      vscode.window.showErrorMessage(
        `Diffchestrator: Yolo requires ${missing.join(" and ")} to be installed.`
      );
      return false;
    }
    return true;
  }

  // claude / aiCommit
  const hasClaude = await commandExists("claude");
  if (!hasClaude) {
    vscode.window.showErrorMessage(
      "Diffchestrator: Claude Code CLI is not installed. Install it from https://docs.anthropic.com/en/docs/claude-code"
    );
    return false;
  }
  return true;
}

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
 *
 * Matching strategy:
 * 1. Check the tracking map (exact match by terminal object)
 * 2. Check if the terminal name contains any scanned repo's basename
 *    (handles any naming: "Claude: repo", "YOLO: repo", "node repo", etc.)
 *    Longest basename match wins to avoid "foo" matching "foo-bar"
 */
export function findRepoForTerminal(terminal: vscode.Terminal, allRepoPaths: string[]): string | undefined {
  // Check tracked map first
  for (const [k, t] of repoTerminals) {
    if (t === terminal) {
      return k.split("::")[0];
    }
  }

  // Fallback: find the repo whose basename appears in the terminal name.
  // Sort by basename length descending so "diffchestrator-vscode" matches
  // before "diffchestrator".
  const name = terminal.name;
  const sorted = [...allRepoPaths].sort(
    (a, b) => path.basename(b).length - path.basename(a).length
  );

  for (const rp of sorted) {
    const repoName = path.basename(rp);
    if (name.includes(repoName)) {
      // Adopt into tracking map
      const kind: TerminalKind =
        /claude/i.test(name) ? "claude" :
        /yolo/i.test(name) ? "yolo" : "shell";
      repoTerminals.set(key(rp, kind), terminal);
      return rp;
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
      async (item?: any) => {
        if (!(await validateCli("yolo"))) return;

        const selectedPaths = repoManager.selectedRepoPaths;
        const singlePath = item?.repo?.path ?? item?.fullPath ?? item?.path ?? repoManager.selectedRepo;

        if (selectedPaths.size > 1) {
          // Multi-repo mode: open yolo with --add-dir for each selected repo
          const addDirArgs = [...selectedPaths]
            .map((p) => `--add-dir ${escapeForTerminal(p)}`)
            .join(" ");

          const terminal = vscode.window.createTerminal({
            name: "YOLO (multi-repo)",
            cwd: repoManager.currentRoot,
          });
          terminal.show();
          terminal.sendText(`yolo ${addDirArgs}`);
        } else if (singlePath) {
          repoManager.selectRepo(singlePath);
          const existing = getAlive(singlePath, "yolo");
          if (existing) {
            existing.show();
            return;
          }

          const name = path.basename(singlePath);
          const terminal = vscode.window.createTerminal({
            name: `YOLO: ${name}`,
            cwd: singlePath,
          });
          repoTerminals.set(key(singlePath, "yolo"), terminal);
          terminal.show();
          terminal.sendText("yolo");
        } else {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        }
      }
    )
  );
}
