import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";
import { registerRepoTerminal, getRepoTerminal, validateCli, terminalIcon } from "./terminal";
import type { TerminalKind } from "./terminal";
import { markDedicatedTerminal } from "./terminalLogic";
import { currentShellKind, escapeForTerminal, orElseCommand } from "../utils/shell";
import { resolveRepoPath } from "../utils/fileItem";

/** Terminal kinds that launch an AI agent (everything but a plain shell). */
export type AgentKind = Exclude<TerminalKind, "shell">;

interface AgentSpec {
  /** CLI prerequisite check */
  cli: "claude" | "yolo";
  /** Command for a single-repo terminal (cwd = repo) */
  single: () => string;
  /** Base command for multi-repo mode; `--add-dir` args are appended */
  multi: string;
}

const AGENTS: Record<AgentKind, AgentSpec> = {
  // Continue the last session if there is one, otherwise start fresh —
  // `||` doesn't exist in PowerShell 5.1, so the form depends on the shell.
  claude: { cli: "claude", single: () => orElseCommand("claude -c", "claude", currentShellKind()), multi: "claude" },
  claudenew: { cli: "claude", single: () => "claude", multi: "claude" },
  yolo: { cli: "yolo", single: () => "yolo", multi: "yolo" },
  yolonew: { cli: "yolo", single: () => "yolonew", multi: "yolonew" },
};

/**
 * Multi-repo terminals keyed by `${kind}|${sorted paths}` so re-running the
 * same command on the same selection reuses the session instead of spawning
 * another one.
 */
const multiRepoTerminals = new Map<string, vscode.Terminal>();

function isAlive(t: vscode.Terminal | undefined): t is vscode.Terminal {
  return !!t && vscode.window.terminals.includes(t);
}

/**
 * Open (or reuse) an agent terminal.
 *
 * Multi-repo mode applies only when no explicit item was passed (keyboard /
 * palette) and more than one repo is multi-selected. An explicit item — tree
 * context menu, or the autoTerminals launcher in viewDiff — always targets
 * that single repo, so a lingering multi-selection can't hijack it.
 */
export async function launchAgentTerminal(
  repoManager: RepoManager,
  kind: AgentKind,
  item?: any
): Promise<void> {
  const spec = AGENTS[kind];
  if (!(await validateCli(spec.cli))) return;

  const selectedPaths = repoManager.selectedRepoPaths;
  if (item === undefined && selectedPaths.size > 1) {
    const paths = [...selectedPaths].sort();
    const mapKey = `${kind}|${paths.join("\n")}`;
    const existing = multiRepoTerminals.get(mapKey);
    if (isAlive(existing)) {
      existing.show();
      return;
    }
    const addDirArgs = paths.map((p) => `--add-dir ${escapeForTerminal(p)}`).join(" ");
    const terminal = vscode.window.createTerminal({
      name: "Multi-repo",
      cwd: repoManager.currentRoot,
      iconPath: terminalIcon(kind),
    });
    multiRepoTerminals.set(mapKey, terminal);
    markDedicatedTerminal(terminal, undefined);
    terminal.show();
    terminal.sendText(`${spec.multi} ${addDirArgs}`);
    return;
  }

  const singlePath = resolveRepoPath(item, repoManager.selectedRepo);
  if (!singlePath) {
    vscode.window.showWarningMessage("Diffchestrator: No repository selected. Select a repo first.");
    return;
  }
  if (!repoManager.getRepo(singlePath)) {
    repoManager.addDirectoryPath(singlePath);
  } else {
    repoManager.selectRepo(singlePath);
  }

  // Reuse the repo's existing terminal of this kind if alive
  const existing = getRepoTerminal(singlePath, kind);
  if (existing) {
    existing.show();
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: path.basename(singlePath),
    cwd: singlePath,
    iconPath: terminalIcon(kind),
  });
  registerRepoTerminal(singlePath, kind, terminal);
  terminal.show();
  terminal.sendText(spec.single());
}

export function registerClaudeCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const commands: [string, AgentKind][] = [
    [CMD.openClaudeCode, "claude"],
    [CMD.openClaudeCodeNew, "claudenew"],
    [CMD.yolo, "yolo"],
    [CMD.yolonew, "yolonew"],
  ];
  for (const [command, kind] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (item?: any) => launchAgentTerminal(repoManager, kind, item))
    );
  }

  // Forget closed multi-repo terminals
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      for (const [k, term] of multiRepoTerminals) {
        if (term === t) multiRepoTerminals.delete(k);
      }
    })
  );
}
