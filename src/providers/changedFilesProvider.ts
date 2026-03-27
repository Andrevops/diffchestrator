import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
// Uses repoManager.git (shared GitExecutor with TTL cache)
import type { FileChange } from "../types";
import { ChangeType, FileStatus } from "../types";

type TreeElement = SectionNode | FileNode;

interface SectionNode {
  type: "section";
  label: string;
  status: FileStatus;
  files: FileChange[];
  repoPath: string;
}

interface FileNode {
  type: "file";
  fileChange: FileChange;
  repoPath: string;
}

export class ChangedFilesProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _diffStatCache = new Map<string, { additions: number; deletions: number }>();

  private _channel: vscode.OutputChannel;

  constructor(private repoManager: RepoManager, channel?: vscode.OutputChannel) {
    this._channel = channel ?? vscode.window.createOutputChannel("Diffchestrator Debug");
    repoManager.onDidChangeSelection(() => {
      this._diffStatCache.clear();
      this._onDidChangeTreeData.fire();
    });
    repoManager.onDidChangeRepos(() => {
      this._diffStatCache.clear();
      this._onDidChangeTreeData.fire();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element.type === "section") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${element.files.length}`;
      item.contextValue = `section-${element.status}`;
      item.iconPath = this._sectionIcon(element.status);
      return item;
    }

    // File node
    const fc = element.fileChange;
    const fileName = path.basename(fc.path);
    const dirName = path.dirname(fc.path);

    const item = new vscode.TreeItem(
      fileName,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = dirName !== "." ? dirName : undefined;
    // Diff stats will be set asynchronously via resolveTreeItem
    item.tooltip = `${fc.path} (${fc.changeType})`;
    item.iconPath = this._fileIcon(fc.changeType);

    // Context value controls inline stage/unstage buttons
    switch (fc.status) {
      case FileStatus.Staged:
        item.contextValue = "file-staged";
        break;
      case FileStatus.Unstaged:
        item.contextValue = "file-unstaged";
        break;
      case FileStatus.Untracked:
        item.contextValue = "file-untracked";
        break;
    }

    // Store data for commands
    (item as vscode.TreeItem & { repoPath: string; filePath: string; fileChange: FileChange }).repoPath =
      element.repoPath;
    (item as vscode.TreeItem & { repoPath: string; filePath: string; fileChange: FileChange }).filePath =
      fc.path;
    (item as vscode.TreeItem & { repoPath: string; filePath: string; fileChange: FileChange }).fileChange =
      fc;

    // Click to open diff
    if (fc.status === FileStatus.Untracked) {
      item.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [vscode.Uri.file(path.join(element.repoPath, fc.path))],
      };
    } else {
      const staged = fc.status === FileStatus.Staged;
      const leftUri = this._gitUri(element.repoPath, fc.path, staged);
      const rightUri = staged
        ? this._indexUri(element.repoPath, fc.path)
        : vscode.Uri.file(path.join(element.repoPath, fc.path));

      this._channel.appendLine(`[diff] file="${fc.path}" status="${fc.status}" staged=${staged}`);
      this._channel.appendLine(`[diff] leftUri=${leftUri.toString()}`);
      this._channel.appendLine(`[diff] rightUri=${rightUri.toString()}`);

      if (fc.changeType === ChangeType.Deleted) {
        item.command = {
          command: "vscode.open",
          title: "Open File",
          arguments: [leftUri],
        };
      } else {
        item.command = {
          command: "vscode.diff",
          title: "Show Diff",
          arguments: [
            leftUri,
            rightUri,
            `${fileName} (${staged ? "Staged" : "Working Tree"})`,
          ],
        };
      }
    }

    return item;
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (element) {
      if (element.type === "section") {
        return element.files.map((fc) => ({
          type: "file" as const,
          fileChange: fc,
          repoPath: element.repoPath,
        }));
      }
      return [];
    }

    // Root: get status for selected repo
    const repoPath = this.repoManager.selectedRepo;
    if (!repoPath) return [];

    try {
      const status = await this.repoManager.git.status(repoPath);
      const sections: SectionNode[] = [];

      if (status.staged.length > 0) {
        sections.push({
          type: "section",
          label: "Staged Changes",
          status: FileStatus.Staged,
          files: status.staged,
          repoPath,
        });
      }
      if (status.unstaged.length > 0) {
        sections.push({
          type: "section",
          label: "Unstaged Changes",
          status: FileStatus.Unstaged,
          files: status.unstaged,
          repoPath,
        });
      }
      if (status.untracked.length > 0) {
        sections.push({
          type: "section",
          label: "Untracked Files",
          status: FileStatus.Untracked,
          files: status.untracked,
          repoPath,
        });
      }

      return sections;
    } catch {
      return [];
    }
  }

  async resolveTreeItem(item: vscode.TreeItem, element: TreeElement): Promise<vscode.TreeItem> {
    if (element.type !== "file") return item;
    const fc = element.fileChange;
    if (fc.status === FileStatus.Untracked) return item;
    try {
      const staged = fc.status === FileStatus.Staged;
      const cacheKey = `${element.repoPath}:${fc.path}:${staged}`;
      let stats = this._diffStatCache.get(cacheKey);
      if (!stats) {
        stats = await this.repoManager.git.diffStatFile(element.repoPath, fc.path, staged);
        this._diffStatCache.set(cacheKey, stats);
      }
      if (stats.additions > 0 || stats.deletions > 0) {
        const statStr = `+${stats.additions} -${stats.deletions}`;
        item.tooltip = `${fc.path} (${fc.changeType}) ${statStr}`;
        const dirName = path.dirname(fc.path);
        const dir = dirName !== "." ? `${dirName} ` : "";
        item.description = `${dir}${statStr}`;
      }
    } catch { /* ignore */ }
    return item;
  }

  private _sectionIcon(status: FileStatus): vscode.ThemeIcon {
    switch (status) {
      case FileStatus.Staged:
        return new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.green"));
      case FileStatus.Unstaged:
        return new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("charts.yellow"));
      case FileStatus.Untracked:
        return new vscode.ThemeIcon("question", new vscode.ThemeColor("charts.blue"));
    }
  }

  private _fileIcon(changeType: ChangeType): vscode.ThemeIcon {
    switch (changeType) {
      case ChangeType.Modified:
        return new vscode.ThemeIcon("edit", new vscode.ThemeColor("charts.yellow"));
      case ChangeType.Added:
        return new vscode.ThemeIcon("add", new vscode.ThemeColor("charts.green"));
      case ChangeType.Deleted:
        return new vscode.ThemeIcon("trash", new vscode.ThemeColor("charts.red"));
      case ChangeType.Renamed:
        return new vscode.ThemeIcon("arrow-right", new vscode.ThemeColor("charts.blue"));
      case ChangeType.Copied:
        return new vscode.ThemeIcon("files", new vscode.ThemeColor("charts.blue"));
      case ChangeType.Unmerged:
        return new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.orange"));
      default:
        return new vscode.ThemeIcon("file");
    }
  }

  private _gitUri(repoPath: string, filePath: string, staged: boolean): vscode.Uri {
    // Staged: compare against HEAD; Unstaged: compare against index (:0)
    const ref = staged ? "HEAD" : ":0";
    return vscode.Uri.parse(
      `git-show:${path.join(repoPath, filePath)}`
    ).with({
      query: JSON.stringify({ path: filePath, ref, repoPath }),
    });
  }

  private _indexUri(repoPath: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(
      `git-show:${path.join(repoPath, filePath)}`
    ).with({
      query: JSON.stringify({ path: filePath, ref: ":0", repoPath }),
    });
  }
}
