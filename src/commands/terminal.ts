import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { escapeForTerminal } from "../utils/shell";
import { resolveRepoPath } from "../utils/fileItem";

const execFileAsync = promisify(execFile);

export type TerminalKind = "shell" | "claude" | "claudenew" | "yolo" | "yolonew";

/** Terminal icon + color per kind */
const TERMINAL_ICONS: Record<TerminalKind, vscode.ThemeIcon> = {
  claude: new vscode.ThemeIcon("sparkle", new vscode.ThemeColor("terminal.ansiYellow")),
  claudenew: new vscode.ThemeIcon("add", new vscode.ThemeColor("terminal.ansiYellow")),
  yolo: new vscode.ThemeIcon("flame", new vscode.ThemeColor("terminal.ansiRed")),
  yolonew: new vscode.ThemeIcon("zap", new vscode.ThemeColor("terminal.ansiCyan")),
  shell: new vscode.ThemeIcon("terminal"),
};

/** Get the icon for a terminal kind. Exported for use in other modules. */
export function terminalIcon(kind: TerminalKind): vscode.ThemeIcon {
  return TERMINAL_ICONS[kind];
}

/**
 * Check if a command exists on the system.
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    await execFileAsync(lookup, [cmd]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a shell alias or command exists.
 * Unlike commandExists, this spawns an interactive shell to resolve aliases.
 */
async function aliasOrCommandExists(name: string): Promise<boolean> {
  try {
    // Use the user's default shell so aliases from .zshrc/.bashrc are loaded
    const shell = vscode.env.shell || process.env.SHELL || "/bin/bash";
    await execFileAsync(shell, ["-ic", `type ${name}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that required CLI tools are available before running a command.
 * Returns true if all tools are available, false otherwise (shows warning).
 */
const CLAUDE_SANDBOX_URL = "https://github.com/aeanez/claude-sandbox";

export async function validateCli(kind: "claude" | "yolo"): Promise<boolean> {
  if (kind === "yolo") {
    // yolo is typically a shell alias — only validate its binary deps (docker + claude)
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

    // Check that the yolo/yolonew alias is available (provided by claude-sandbox)
    const hasAlias = await aliasOrCommandExists("yolo");
    if (!hasAlias) {
      const action = await vscode.window.showErrorMessage(
        "Diffchestrator: The yolo/yolonew commands require claude-sandbox to be installed and sourced in your shell.",
        "Setup claude-sandbox"
      );
      if (action) {
        vscode.env.openExternal(vscode.Uri.parse(CLAUDE_SANDBOX_URL));
      }
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

/** Infer terminal kind from its icon (creationOptions.iconPath) */
function inferKindFromIcon(terminal: vscode.Terminal): TerminalKind | undefined {
  const opts = terminal.creationOptions as { iconPath?: vscode.ThemeIcon };
  const icon = opts?.iconPath;
  if (icon instanceof vscode.ThemeIcon) {
    if (icon.id === "sparkle") return "claude";
    if (icon.id === "add") return "claudenew";
    if (icon.id === "flame") return "yolo";
    if (icon.id === "zap") return "yolonew";
    if (icon.id === "terminal") return "shell";
  }
  return undefined;
}

/**
 * Scan all existing terminals and adopt ones matching known repo basenames.
 * Called on activation to restore tracking after window reload.
 */
export function adoptExistingTerminals(allRepoPaths: string[]): void {
  const sorted = [...allRepoPaths].sort(
    (a, b) => path.basename(b).length - path.basename(a).length
  );

  for (const terminal of vscode.window.terminals) {
    // Skip if already tracked
    let tracked = false;
    for (const [, t] of repoTerminals) {
      if (t === terminal) { tracked = true; break; }
    }
    if (tracked) continue;

    const name = terminal.name;

    // Match repo by basename in terminal name
    for (const rp of sorted) {
      const repoName = path.basename(rp);
      if (name === repoName || name.includes(repoName)) {
        // Infer kind from icon, fall back to name-based inference, then "shell"
        const kind = inferKindFromIcon(terminal)
          ?? (/claude/i.test(name) ? "claude" :
              /yolonew/i.test(name) ? "yolonew" :
              /yolo/i.test(name) ? "yolo" :
              /^DC:/i.test(name) ? "shell" : "shell");

        // Only adopt if this repo+kind slot is empty
        if (!repoTerminals.has(key(rp, kind))) {
          repoTerminals.set(key(rp, kind), terminal);
        }
        break;
      }
    }
  }
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
  claudenew: [],
  yolo: [],
  yolonew: [],
  shell: [],
};

function buildPatterns(repoPath: string, kind: TerminalKind): RegExp[] {
  const name = escapeRegex(path.basename(repoPath));
  // Only match legacy prefixed names — icon-only terminals (bare repo name)
  // are tracked exclusively via the repoTerminals map to avoid cross-type collisions
  switch (kind) {
    case "claude":
      return [
        new RegExp(`^Claude:\\s*${name}$`, "i"),
        new RegExp(`^Claude Code[^]*${name}$`, "i"),
      ];
    case "claudenew":
      return [];
    case "yolo":
      return [
        new RegExp(`^YOLO:\\s*${name}$`, "i"),
      ];
    case "yolonew":
      return [
        new RegExp(`^YOLONEW:\\s*${name}$`, "i"),
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

  // Fallback 1: scan by legacy prefixed name patterns
  const patterns = buildPatterns(repoPath, kind);
  for (const terminal of vscode.window.terminals) {
    if (patterns.some((p) => p.test(terminal.name))) {
      repoTerminals.set(key(repoPath, kind), terminal);
      return terminal;
    }
  }

  // Fallback 2: match icon-only terminals (bare repo name) by name + icon
  // This handles post-reload adoption where prefixes were removed
  const repoName = path.basename(repoPath);
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === repoName) {
      // Already tracked under a different kind? Skip.
      let alreadyTracked = false;
      for (const [, t] of repoTerminals) {
        if (t === terminal) { alreadyTracked = true; break; }
      }
      if (alreadyTracked) continue;

      // Verify kind via icon if available, otherwise accept for requested kind
      const iconKind = inferKindFromIcon(terminal);
      if (iconKind === kind || iconKind === undefined) {
        repoTerminals.set(key(repoPath, kind), terminal);
        return terminal;
      }
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
      // Infer kind from name or legacy prefix, then icon
      let kind: TerminalKind =
        /claude/i.test(name) ? "claude" :
        /yolonew/i.test(name) ? "yolonew" :
        /yolo/i.test(name) ? "yolo" :
        /^DC:/i.test(name) ? "shell" :
        inferKindFromIcon(terminal) ?? "shell";

      // Don't overwrite a slot occupied by a different alive terminal
      const existing = repoTerminals.get(key(rp, kind));
      if (existing && existing !== terminal && vscode.window.terminals.includes(existing)) {
        // Slot taken — try other kinds
        const allKinds: TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];
        const freeKind = allKinds.find((k) => {
          const t = repoTerminals.get(key(rp, k));
          return !t || t === terminal || !vscode.window.terminals.includes(t);
        });
        if (freeKind) kind = freeKind; else return rp; // all slots full, just return repo
      }

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
    name,
    cwd: repoPath,
    iconPath: TERMINAL_ICONS.shell,
  });
  repoTerminals.set(key(repoPath, "shell"), terminal);
  return terminal;
}

/**
 * Check if a repo has any active terminal (any kind).
 */
export function hasActiveTerminal(repoPath: string): boolean {
  const kinds: TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];
  return kinds.some((k) => !!getAlive(repoPath, k));
}

/**
 * Switch to the best terminal for a repo (claude > yolo > shell).
 * Returns focus to editor after switching.
 */
export async function showTerminalIfExists(repoPath: string): Promise<boolean> {
  const kinds: TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];

  // Prefer the same kind as the currently active terminal so switching repos
  // keeps the user on the same terminal type (e.g. shell → shell, claude → claude)
  const active = vscode.window.activeTerminal;
  if (active) {
    const activeKind = inferKindFromIcon(active);
    if (activeKind) {
      const sameKind = getAlive(repoPath, activeKind);
      if (sameKind) {
        sameKind.show(false);
        await new Promise((r) => setTimeout(r, 150));
        await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
        return true;
      }
    }
  }

  // Fallback: first alive terminal by priority
  for (const kind of kinds) {
    const existing = getAlive(repoPath, kind);
    if (existing) {
      existing.show(false);
      await new Promise((r) => setTimeout(r, 150));
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      return true;
    }
  }
  return false;
}

const CYCLE_ORDER: TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];

/**
 * Get all alive terminal kinds for a repo, in cycle order.
 */
function getAliveKinds(repoPath: string): TerminalKind[] {
  return CYCLE_ORDER.filter((k) => !!getAlive(repoPath, k));
}

/**
 * Cycle to the next alive terminal for a repo.
 * If the currently active terminal belongs to this repo, advances to the next kind.
 * Otherwise shows the first alive terminal.
 */
export async function cycleTerminal(repoPath: string): Promise<boolean> {
  const alive = getAliveKinds(repoPath);
  if (alive.length === 0) {
    vscode.window.showInformationMessage("Diffchestrator: No terminals open for this repo.");
    return false;
  }
  if (alive.length === 1) {
    const t = getAlive(repoPath, alive[0])!;
    t.show(false);
    return true;
  }

  // Determine which kind is currently active
  const active = vscode.window.activeTerminal;
  let currentKind: TerminalKind | undefined;
  if (active) {
    for (const k of alive) {
      if (getAlive(repoPath, k) === active) {
        currentKind = k;
        break;
      }
    }
  }

  // Advance to next in the alive list
  const idx = currentKind ? alive.indexOf(currentKind) : -1;
  const nextKind = alive[(idx + 1) % alive.length];
  const next = getAlive(repoPath, nextKind)!;
  next.show(false);
  return true;
}

/**
 * Close the active terminal for a repo.
 * If the currently active terminal belongs to this repo, close it.
 * Otherwise show a picker of alive terminals to close.
 */
export async function closeRepoTerminal(repoPath: string): Promise<void> {
  const alive = getAliveKinds(repoPath);
  if (alive.length === 0) {
    vscode.window.showInformationMessage("Diffchestrator: No terminals open for this repo.");
    return;
  }

  // If active terminal belongs to this repo, close it directly
  const active = vscode.window.activeTerminal;
  if (active) {
    for (const k of alive) {
      if (getAlive(repoPath, k) === active) {
        active.dispose();
        return;
      }
    }
  }

  // Otherwise pick which to close
  if (alive.length === 1) {
    getAlive(repoPath, alive[0])!.dispose();
    return;
  }

  const items = alive.map((k) => ({
    label: k.charAt(0).toUpperCase() + k.slice(1),
    kind: k,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Close which terminal?",
  });
  if (picked) {
    getAlive(repoPath, picked.kind as TerminalKind)?.dispose();
  }
}

/**
 * Tracks which terminals we've visited in the current split group.
 * Used to detect when focusNextPane/focusPreviousPane wraps around.
 */
const groupVisited = new Set<vscode.Terminal>();

/**
 * Remembers terminals that are at the edge of a split group for each direction.
 * After detecting a wrap once, subsequent navigations from the same terminal
 * in the same direction skip the pane command entirely (no flicker).
 */
const knownGroupEdges = new Map<vscode.Terminal, Set<1 | -1>>();

// Clean up edge cache when terminals close
vscode.window.onDidCloseTerminal((t) => knownGroupEdges.delete(t));

/**
 * Execute a VS Code command and wait for activeTerminal to change.
 * Sets up listener BEFORE executing to avoid race conditions.
 * Returns the new terminal, or undefined if no change within timeout.
 */
function execAndWaitForChange(
  command: string,
  before: vscode.Terminal | undefined,
  timeoutMs: number,
): Promise<vscode.Terminal | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      disp.dispose();
      // Final check in case event was missed
      const current = vscode.window.activeTerminal;
      resolve(current && current !== before ? current : undefined);
    }, timeoutMs);

    const disp = vscode.window.onDidChangeActiveTerminal((t) => {
      clearTimeout(timer);
      disp.dispose();
      resolve(t ?? undefined);
    });

    // Execute after listener is ready
    vscode.commands.executeCommand(command);
  });
}

async function moveToNextGroup(direction: 1 | -1): Promise<void> {
  groupVisited.clear();
  const groupCmd = direction === 1
    ? "workbench.action.terminal.focusNext"
    : "workbench.action.terminal.focusPrevious";
  await execAndWaitForChange(groupCmd, vscode.window.activeTerminal, 200);
}

/**
 * Navigate to the next/previous terminal, traversing split panes within
 * groups before moving to the next group.
 *
 * Known limitation: navigation through split terminal groups is unreliable
 * because VS Code doesn't expose terminal group/tab structure via the API.
 * focusNextPane wraps silently, focusNext skips panes, and
 * vscode.window.terminals is in creation order (not visual).
 * Workaround: use Alt+D ↑/↓ for tabs + Alt+D J for panes within a group.
 *
 * direction: 1 = next (down), -1 = previous (up)
 */
export async function navigateTerminal(direction: 1 | -1, allRepoPaths: string[]): Promise<string | undefined> {
  if (vscode.window.terminals.length === 0) {
    vscode.window.showInformationMessage("Diffchestrator: No terminals open.");
    return undefined;
  }

  // Ensure terminal panel is visible
  if (!vscode.window.activeTerminal) {
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    await new Promise((r) => setTimeout(r, 100));
  }

  const before = vscode.window.activeTerminal;

  // If this terminal is a known group edge for this direction, skip pane → go to next group
  if (before && knownGroupEdges.get(before)?.has(direction)) {
    await moveToNextGroup(direction);
    const current = vscode.window.activeTerminal;
    return current ? findRepoForTerminal(current, allRepoPaths) : undefined;
  }

  // Reset visited set if we're on a terminal we haven't seen (user clicked elsewhere)
  if (before && !groupVisited.has(before) && groupVisited.size > 0) {
    groupVisited.clear();
  }
  if (before) groupVisited.add(before);

  // Try moving within the split group first
  const paneCmd = direction === 1
    ? "workbench.action.terminal.focusNextPane"
    : "workbench.action.terminal.focusPreviousPane";

  const afterPane = await execAndWaitForChange(paneCmd, before, 200);

  if (afterPane && !groupVisited.has(afterPane)) {
    // Successfully moved to a new pane within the group — track it
    groupVisited.add(afterPane);
  } else {
    // Single pane (no change) or wrapped to visited terminal → mark edge and move
    if (before) {
      if (!knownGroupEdges.has(before)) knownGroupEdges.set(before, new Set());
      knownGroupEdges.get(before)!.add(direction);
    }
    await moveToNextGroup(direction);
  }

  const current = vscode.window.activeTerminal;
  if (!current) return undefined;

  return findRepoForTerminal(current, allRepoPaths);
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
        const targetPath = resolveRepoPath(item, repoManager.selectedRepo);
        if (!targetPath) {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
          return;
        }
        // If path is not a known repo, track as directory entry
        if (!repoManager.getRepo(targetPath)) {
          repoManager.addDirectoryPath(targetPath);
        } else {
          repoManager.selectRepo(targetPath);
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
      async (item?: any) => {
        if (!(await validateCli("yolo"))) return;

        const selectedPaths = repoManager.selectedRepoPaths;
        const singlePath = resolveRepoPath(item, repoManager.selectedRepo);

        if (selectedPaths.size > 1) {
          // Multi-repo mode: open yolo with --add-dir for each selected repo
          const addDirArgs = [...selectedPaths]
            .map((p) => `--add-dir ${escapeForTerminal(p)}`)
            .join(" ");

          const terminal = vscode.window.createTerminal({
            name: "Multi-repo",
            cwd: repoManager.currentRoot,
            iconPath: TERMINAL_ICONS.yolo,
          });
          terminal.show();
          terminal.sendText(`yolo ${addDirArgs}`);
        } else if (singlePath) {
          if (!repoManager.getRepo(singlePath)) {
            repoManager.addDirectoryPath(singlePath);
          } else {
            repoManager.selectRepo(singlePath);
          }
          const existing = getAlive(singlePath, "yolo");
          if (existing) {
            existing.show();
            return;
          }

          const name = path.basename(singlePath);
          const terminal = vscode.window.createTerminal({
            name,
            cwd: singlePath,
            iconPath: TERMINAL_ICONS.yolo,
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

  // Yolonew — reuse existing yolonew terminal or create new one
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.yolonew,
      async (item?: any) => {
        if (!(await validateCli("yolo"))) return;

        const selectedPaths = repoManager.selectedRepoPaths;
        const singlePath = resolveRepoPath(item, repoManager.selectedRepo);

        if (selectedPaths.size > 1) {
          const addDirArgs = [...selectedPaths]
            .map((p) => `--add-dir ${escapeForTerminal(p)}`)
            .join(" ");

          const terminal = vscode.window.createTerminal({
            name: "Multi-repo",
            cwd: repoManager.currentRoot,
            iconPath: TERMINAL_ICONS.yolonew,
          });
          terminal.show();
          terminal.sendText(`yolonew ${addDirArgs}`);
        } else if (singlePath) {
          if (!repoManager.getRepo(singlePath)) {
            repoManager.addDirectoryPath(singlePath);
          } else {
            repoManager.selectRepo(singlePath);
          }
          const existing = getAlive(singlePath, "yolonew");
          if (existing) {
            existing.show();
            return;
          }

          const name = path.basename(singlePath);
          const terminal = vscode.window.createTerminal({
            name,
            cwd: singlePath,
            iconPath: TERMINAL_ICONS.yolonew,
          });
          repoTerminals.set(key(singlePath, "yolonew"), terminal);
          terminal.show();
          terminal.sendText("yolonew");
        } else {
          vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        }
      }
    )
  );
}
