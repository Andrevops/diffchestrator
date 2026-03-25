import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import type { RepoSummary } from "../types";
import { CMD, CONFIG } from "../constants";
import { getRepoTerminal } from "../commands/terminal";
import type { TerminalKind } from "../commands/terminal";

type Role = "favorite" | "active" | "selected" | "recent";

interface ActiveRepoNode {
  repo?: RepoSummary;
  repoPath: string;
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

    // Refresh when favorites or showFavorites config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("diffchestrator.favorites") ||
          e.affectsConfiguration(CONFIG.showFavorites)) {
        this._onDidChangeTreeData.fire();
      }
    });
  }

  private _getTerminalKinds(repoPath: string): TerminalKind[] {
    if (this._terminalCacheDirty) {
      this._terminalCache.clear();
      this._terminalCacheDirty = false;
    }
    if (!this._terminalCache.has(repoPath)) {
      this._terminalCache.set(repoPath, activeKinds(repoPath));
    }
    return this._terminalCache.get(repoPath) ?? [];
  }

  private _getFavoritePaths(): string[] {
    const config = vscode.workspace.getConfiguration("diffchestrator");
    return config.get<string[]>("favorites", []);
  }

  getTreeItem(element: ActiveRepoNode): vscode.TreeItem {
    const name = element.repo?.name ?? path.basename(element.repoPath);
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    const r = element.repo;
    const isActive = element.repoPath === this.repoManager.selectedRepo;

    const parts: string[] = [];
    if (r) {
      if (r.branch) parts.push(r.branch);
      const sync: string[] = [];
      if (r.ahead > 0) sync.push(`↑${r.ahead}`);
      if (r.behind > 0) sync.push(`↓${r.behind}`);
      if (sync.length > 0) parts.push(sync.join(" "));
      if (r.totalChanges > 0) parts.push(`${r.totalChanges} changes`);
    } else {
      parts.push("(not scanned)");
    }

    // Terminal indicator
    const termLabels = element.terminalKinds.map((k) => KIND_LABELS[k]);
    const termTag = termLabels.length > 0 ? `$(terminal) ${termLabels.join("+")} ` : "";

    if (element.role === "favorite") {
      const activeMarker = isActive ? "● " : "";
      item.description = `${termTag}${activeMarker}${parts.join(" · ")}`;
      item.iconPath = isActive
        ? new vscode.ThemeIcon("star-full", new vscode.ThemeColor("charts.blue"))
        : new vscode.ThemeIcon("star-full", new vscode.ThemeColor("charts.yellow"));
    } else if (element.role === "active") {
      item.description = `${termTag}● ${parts.join(" · ")}`;
      item.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
    } else if (element.role === "selected") {
      item.description = `${termTag}${parts.join(" · ")}`;
      item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.purple"));
    } else {
      item.description = `${termTag}${parts.join(" · ")}`;
      item.iconPath = new vscode.ThemeIcon("history", new vscode.ThemeColor("foreground"));
    }

    item.id = `active:${element.repoPath}:${element.role}:${isActive ? "a" : "i"}`;
    item.contextValue = "repo";
    (item as vscode.TreeItem & { path: string; repoPath: string }).path = element.repoPath;
    (item as vscode.TreeItem & { repoPath: string }).repoPath = element.repoPath;

    const lines = [element.repoPath];
    if (r) {
      lines.push(`Branch: ${r.branch}`);
      lines.push(r.totalChanges > 0 ? `Changes: ${r.totalChanges}` : "Clean");
    }
    if (element.role === "favorite") lines.push("★ Favorite");
    else if (element.role === "active") lines.push("● Active repo");
    else if (element.role === "selected") lines.push("✓ Multi-selected");
    else lines.push("Recently opened");
    if (termLabels.length > 0) lines.push(`Terminals: ${termLabels.join(", ")}`);
    item.tooltip = lines.join("\n");

    item.command = {
      command: CMD.viewDiff,
      title: "View Diff",
      arguments: [{ path: element.repoPath }],
    };

    return item;
  }

  private _isUnderRoot(repoPath: string): boolean {
    const root = this.repoManager.currentRoot;
    return !root || repoPath.startsWith(root + path.sep);
  }

  getChildren(): ActiveRepoNode[] {
    const nodes: ActiveRepoNode[] = [];
    const activePath = this.repoManager.selectedRepo;
    const multiPaths = this.repoManager.selectedRepoPaths;
    const recentPaths = this.repoManager.recentRepoPaths;
    const seen = new Set<string>();

    // Favorites first (if shown)
    const config = vscode.workspace.getConfiguration("diffchestrator");
    const showFavorites = config.get<boolean>("showFavorites", true);
    const favoritePaths = new Set(this._getFavoritePaths());

    if (showFavorites) {
      for (const favPath of favoritePaths) {
        if (!this._isUnderRoot(favPath)) continue;
        const repo = this.repoManager.getRepo(favPath);
        nodes.push({ repo, repoPath: favPath, role: "favorite", terminalKinds: this._getTerminalKinds(favPath) });
        seen.add(favPath);
      }
    }

    // Active repo (show even if it's a hidden favorite — just as "active" role)
    if (activePath && this._isUnderRoot(activePath) && !seen.has(activePath)) {
      const repo = this.repoManager.getRepo(activePath);
      if (repo) {
        nodes.push({ repo, repoPath: activePath, role: "active", terminalKinds: this._getTerminalKinds(activePath) });
        seen.add(activePath);
      }
    }

    // Multi-selected
    for (const p of multiPaths) {
      if (seen.has(p) || !this._isUnderRoot(p)) continue;
      const repo = this.repoManager.getRepo(p);
      if (repo) {
        nodes.push({ repo, repoPath: p, role: "selected", terminalKinds: this._getTerminalKinds(p) });
        seen.add(p);
      }
    }

    // Recent
    for (const p of recentPaths) {
      if (seen.has(p) || !this._isUnderRoot(p)) continue;
      const repo = this.repoManager.getRepo(p);
      if (repo) {
        nodes.push({ repo, repoPath: p, role: "recent", terminalKinds: this._getTerminalKinds(p) });
        seen.add(p);
      }
    }

    return nodes;
  }
}
