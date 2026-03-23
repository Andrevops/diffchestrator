import * as vscode from "vscode";
import type { RepoManager } from "../services/repoManager";
import type { RepoSummary } from "../types";
import { CMD } from "../constants";
import { getRepoTerminal } from "../commands/terminal";
import type { TerminalKind } from "../commands/terminal";

type Role = "active" | "selected" | "recent";

interface ActiveRepoNode {
  repo: RepoSummary;
  role: Role;
  terminalKinds: TerminalKind[];
}

const KIND_LABELS: Record<TerminalKind, string> = {
  claude: "Claude",
  yolo: "Yolo",
  shell: "Shell",
};

function activeKinds(repoPath: string): TerminalKind[] {
  const kinds: TerminalKind[] = ["claude", "yolo", "shell"];
  return kinds.filter((k) => !!getRepoTerminal(repoPath, k));
}

export class ActiveReposProvider implements vscode.TreeDataProvider<ActiveRepoNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActiveRepoNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Cache terminal kinds to avoid re-scanning on every tree rebuild
  private _terminalCache = new Map<string, TerminalKind[]>();
  private _terminalCacheDirty = true;

  constructor(private repoManager: RepoManager) {
    repoManager.onDidChangeSelection(() => this._onDidChangeTreeData.fire());
    repoManager.onDidChangeRepos(() => this._onDidChangeTreeData.fire());

    // Only invalidate terminal cache on terminal open/close, not full tree rebuild
    vscode.window.onDidOpenTerminal(() => {
      this._terminalCacheDirty = true;
      this._onDidChangeTreeData.fire();
    });
    vscode.window.onDidCloseTerminal(() => {
      this._terminalCacheDirty = true;
      this._onDidChangeTreeData.fire();
    });
  }

  private _getTerminalKinds(repoPath: string): TerminalKind[] {
    if (this._terminalCacheDirty) {
      // Rebuild entire cache once, not per-repo
      this._terminalCache.clear();
      for (const rp of this.repoManager.recentRepoPaths) {
        this._terminalCache.set(rp, activeKinds(rp));
      }
      this._terminalCacheDirty = false;
    }
    return this._terminalCache.get(repoPath) ?? [];
  }

  getTreeItem(element: ActiveRepoNode): vscode.TreeItem {
    const r = element.repo;
    const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);

    const parts: string[] = [];
    if (r.branch) parts.push(r.branch);
    // Ahead/behind remote
    const sync: string[] = [];
    if (r.ahead > 0) sync.push(`↑${r.ahead}`);
    if (r.behind > 0) sync.push(`↓${r.behind}`);
    if (sync.length > 0) parts.push(sync.join(" "));
    if (r.totalChanges > 0) parts.push(`${r.totalChanges} changes`);

    // Terminal indicator: show which sessions are active
    const termLabels = element.terminalKinds.map((k) => KIND_LABELS[k]);
    const termTag = termLabels.length > 0 ? `$(terminal) ${termLabels.join("+")} ` : "";

    if (element.role === "active") {
      item.description = `${termTag}● ${parts.join(" · ")}`;
      item.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
    } else if (element.role === "selected") {
      item.description = `${termTag}${parts.join(" · ")}`;
      item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.purple"));
    } else {
      item.description = `${termTag}${parts.join(" · ")}`;
      item.iconPath = new vscode.ThemeIcon("history", new vscode.ThemeColor("foreground"));
    }

    // Unique id per state so VS Code resets selection on refresh
    item.id = `active:${r.path}:${element.role}`;
    item.contextValue = "repo";
    (item as vscode.TreeItem & { path: string }).path = r.path;

    const lines = [
      r.path,
      `Branch: ${r.branch}`,
      r.totalChanges > 0 ? `Changes: ${r.totalChanges}` : "Clean",
    ];
    if (element.role === "active") lines.push("● Active repo");
    else if (element.role === "selected") lines.push("✓ Multi-selected");
    else lines.push("Recently opened");
    if (termLabels.length > 0) lines.push(`Terminals: ${termLabels.join(", ")}`);
    item.tooltip = lines.join("\n");

    item.command = {
      command: CMD.viewDiff,
      title: "View Diff",
      arguments: [{ path: r.path }],
    };

    return item;
  }

  getChildren(): ActiveRepoNode[] {
    const nodes: ActiveRepoNode[] = [];
    const activePath = this.repoManager.selectedRepo;
    const multiPaths = this.repoManager.selectedRepoPaths;
    const recentPaths = this.repoManager.recentRepoPaths;
    const seen = new Set<string>();

    if (activePath) {
      const repo = this.repoManager.getRepo(activePath);
      if (repo) {
        nodes.push({ repo, role: "active", terminalKinds: this._getTerminalKinds(activePath) });
        seen.add(activePath);
      }
    }

    for (const p of multiPaths) {
      if (seen.has(p)) continue;
      const repo = this.repoManager.getRepo(p);
      if (repo) {
        nodes.push({ repo, role: "selected", terminalKinds: this._getTerminalKinds(p) });
        seen.add(p);
      }
    }

    for (const p of recentPaths) {
      if (seen.has(p)) continue;
      const repo = this.repoManager.getRepo(p);
      if (repo) {
        nodes.push({ repo, role: "recent", terminalKinds: this._getTerminalKinds(p) });
        seen.add(p);
      }
    }

    return nodes;
  }
}
