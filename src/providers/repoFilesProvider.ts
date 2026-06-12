import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { RepoManager } from "../services/repoManager";
import type { FileChange } from "../types";
import { FileStatus } from "../types";
import { CONFIG } from "../constants";

export interface FileNode {
  uri: vscode.Uri;
  isDirectory: boolean;
  name: string;
  /** Path relative to the repo root, forward-slash separated (git relpath). */
  relPath: string;
  change?: FileChange;
  // Set on changed files so resolveFileItem()-shaped commands
  // (stage/unstage/discard) accept tree nodes directly.
  repoPath?: string;
  filePath?: string;
  fileChange?: FileChange;
}

/** VS Code convention: tree DnD mime type is the lowercased view id. */
const DND_MIME = "application/vnd.code.tree.diffchestrator.repofiles";

/** Above this many distinct changed directories, a full refresh is cheaper. */
const MAX_TARGETED_DIRS = 5;

/**
 * Tree view of the currently-selected repo's file hierarchy.
 *
 * Backed by fs.promises.readdir with lazy per-directory expansion. Nothing
 * touches workspace folders, so switching the selected repo reroots the tree
 * without triggering a VS Code window reload.
 */
export class RepoFilesProvider
  implements
    vscode.TreeDataProvider<FileNode>,
    vscode.TreeDragAndDropController<FileNode>,
    vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<FileNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Fired whenever the change/ignore maps are rebuilt — drives decorations. */
  private _onDidUpdateChanges = new vscode.EventEmitter<void>();
  readonly onDidUpdateChanges = this._onDidUpdateChanges.event;

  readonly dropMimeTypes = [DND_MIME];
  readonly dragMimeTypes = [DND_MIME, "text/uri-list"];

  private _disposables: vscode.Disposable[] = [];
  private _fsWatcher: vscode.FileSystemWatcher | undefined;
  /** Whether the recursive watcher was requested (view became visible). */
  private _watchingEnabled = false;
  /** Keys are git relpaths: forward-slash separated, relative to the root. */
  private _changedFiles = new Map<string, FileChange>();
  /** True once _changedFiles reflects a completed git status for the root. */
  private _changesLoaded = false;
  /** In-flight status load — dedupes concurrent getChildren calls. */
  private _changesPromise: Promise<void> | undefined;
  /** Absolute paths of gitignored entries, populated per expanded directory. */
  private _ignored = new Set<string>();
  /** Nodes returned by getChildren, keyed by fsPath — used for targeted refresh and reveal. */
  private _nodes = new Map<string, FileNode>();
  /** Parent directories of watcher events pending the debounced refresh. */
  private _pendingDirs = new Set<string>();
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private _repoManager: RepoManager) {
    this._disposables.push(
      _repoManager.onDidChangeSelection(() => {
        this._resetState();
        // Only re-root the watcher if one was already active — the watcher
        // itself is created lazily on first view visibility (ensureWatching).
        if (this._watchingEnabled) this._watchSelectedRepo();
        this._onDidChangeTreeData.fire();
      }),
      _repoManager.onDidChangeRepos(() => {
        this._changedFiles = new Map();
        this._changesLoaded = false;
        this._onDidChangeTreeData.fire();
      }),
      // Fallback for mounts where native file watching is unreliable (e.g.
      // Windows-side writes on WSL drvfs): in-editor saves always refresh.
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const root = this._repoManager.selectedRepo;
        if (!root || doc.uri.scheme !== "file") return;
        const p = doc.uri.fsPath;
        if (p === root || p.startsWith(root + path.sep)) this._scheduleRefresh(doc.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG.filesHideIgnored)) this.refresh();
      }),
    );
    // Deliberately no _watchSelectedRepo() here: the recursive `**/*` watcher
    // is expensive (especially on WSL) and only useful once the Files view is
    // actually shown — extension.ts calls ensureWatching() on first visibility.
  }

  /**
   * Start watching the selected repo for file changes. Idempotent; called on
   * the Files view's first visibility so a never-opened view costs nothing.
   */
  ensureWatching(): void {
    if (this._watchingEnabled) return;
    this._watchingEnabled = true;
    this._watchSelectedRepo();
  }

  private _resetState(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    this._changedFiles = new Map();
    this._changesLoaded = false;
    // Drop the in-flight load handle: the old root's load will discard its
    // own result (staleness check), and the new root must start fresh.
    this._changesPromise = undefined;
    this._ignored.clear();
    this._nodes.clear();
    this._pendingDirs.clear();
  }

  private _watchSelectedRepo(): void {
    this._fsWatcher?.dispose();
    this._fsWatcher = undefined;

    const root = this._repoManager.selectedRepo;
    if (!root) return;

    // Base must be a Uri: with a string base, createFileSystemWatcher only
    // reports events for paths inside the opened workspace folders, and
    // selected repos are deliberately never workspace folders.
    const pattern = new vscode.RelativePattern(vscode.Uri.file(root), "**/*");
    this._fsWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    this._fsWatcher.onDidCreate((uri) => this._scheduleRefresh(uri));
    this._fsWatcher.onDidDelete((uri) => this._scheduleRefresh(uri));
    this._fsWatcher.onDidChange((uri) => {
      this._scheduleRefresh(uri);
      if (!this._isNoise(uri)) void this._reloadOpenEditorsFor(uri);
    });
  }

  /**
   * The watcher fires on `**\/*`, so an active repo (build output, .git index
   * churn, node_modules) can emit many events per second. Each refresh runs
   * `git status` + readdir, so firing on every event hammers the disk. Coalesce
   * bursts into a single refresh and drop events from paths that never affect
   * the tree.
   */
  private _scheduleRefresh(uri: vscode.Uri): void {
    if (this._isNoise(uri)) return;
    this._pendingDirs.add(path.dirname(uri.fsPath));
    if (this._refreshTimer) return; // a refresh is already pending
    this._refreshTimer = setTimeout(() => void this._flushRefresh(), 400);
  }

  /**
   * Refresh just the directories that saw events when possible; fall back to
   * a full refresh when the root itself changed or events were widespread.
   */
  private async _flushRefresh(): Promise<void> {
    this._refreshTimer = undefined;
    const dirs = [...this._pendingDirs];
    this._pendingDirs.clear();
    const root = this.rootPath;
    this._changedFiles = new Map();
    this._changesLoaded = false;
    // Reload eagerly so decorations (which read the map directly, including
    // for collapsed dirs and editor tabs) never go stale waiting for an expand.
    await this._ensureChangedFiles();

    // The selected repo changed while git status ran — the pending dirs and
    // cached nodes belong to the old root; the selection handler already
    // fired a full refresh for the new one.
    if (root !== this.rootPath) return;

    if (!root || dirs.length > MAX_TARGETED_DIRS || dirs.includes(root)) {
      this._onDidChangeTreeData.fire();
      return;
    }
    for (const dir of dirs) {
      const node = this._nodes.get(dir);
      // A dir that was never expanded has nothing rendered to refresh;
      // decorations were already updated above.
      if (node) this._onDidChangeTreeData.fire(node);
    }
  }

  /** Paths that generate watcher noise but are irrelevant to the file tree. */
  private _isNoise(uri: vscode.Uri): boolean {
    const p = uri.fsPath;
    return (
      p.includes(`${path.sep}.git${path.sep}`) ||
      p.endsWith(`${path.sep}.git`) ||
      p.includes(`${path.sep}node_modules${path.sep}`)
    );
  }

  /**
   * When a file in the selected repo changes on disk, force any open editor
   * showing that file to reload from disk. VS Code's automatic reload is
   * unreliable in WSL / when the editor is part of a diff input — leaving the
   * buffer stale and dirty, which causes a "save?" prompt on close that can
   * overwrite the external edit.
   *
   * Reverts by URI rather than focusing the editor first: showTextDocument
   * can only show a plain text editor, so for a file that's open only as the
   * modified side of a diff tab it would spawn a new standalone tab (and
   * steal focus). Reverting the shared text model updates every editor
   * showing it, diff sides included, without opening anything.
   */
  private async _reloadOpenEditorsFor(uri: vscode.Uri): Promise<void> {
    const target = uri.fsPath;
    let openInTab = false;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          openInTab = input.uri.scheme === "file" && input.uri.fsPath === target;
        } else if (input instanceof vscode.TabInputTextDiff) {
          openInTab =
            (input.modified.scheme === "file" && input.modified.fsPath === target) ||
            (input.original.scheme === "file" && input.original.fsPath === target);
        }
        if (openInTab) break;
      }
      if (openInTab) break;
    }
    if (!openInTab) return;

    // No loaded document means the tab isn't resolved yet — VS Code reads
    // fresh from disk when it activates, so there's nothing stale to revert.
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.scheme === "file" && d.uri.fsPath === target,
    );
    if (!doc) return;
    try {
      await vscode.commands.executeCommand("workbench.action.files.revert", doc.uri);
    } catch {
      /* ignore — best-effort reload */
    }
  }

  /** Currently-selected repo path; drives the tree root. */
  get rootPath(): string | undefined {
    return this._repoManager.selectedRepo;
  }

  refresh(): void {
    this._changedFiles = new Map();
    this._changesLoaded = false;
    this._ignored.clear();
    this._nodes.clear();
    this._onDidChangeTreeData.fire();
  }

  /** Change for an absolute path inside the selected repo (decorations). */
  getChange(fsPath: string): FileChange | undefined {
    const root = this.rootPath;
    if (!root || !fsPath.startsWith(root + path.sep)) return undefined;
    // Map keys are git relpaths (forward slashes); path.relative uses
    // backslashes on Windows.
    return this._changedFiles.get(path.relative(root, fsPath).split(path.sep).join("/"));
  }

  /** Whether an absolute path was reported gitignored (decorations). */
  isIgnored(fsPath: string): boolean {
    return this._ignored.has(fsPath);
  }

  /**
   * Node for an absolute path inside the selected repo. Prefers the cached
   * instance from getChildren; otherwise synthesizes one (reveal matches by
   * TreeItem.id, so identity doesn't matter).
   */
  nodeForPath(fsPath: string, isDirectory = false): FileNode | undefined {
    const root = this.rootPath;
    if (!root || fsPath === root || !fsPath.startsWith(root + path.sep)) return undefined;
    const cached = this._nodes.get(fsPath);
    if (cached) return cached;
    return this._buildNode(root, fsPath, isDirectory);
  }

  getParent(node: FileNode): FileNode | undefined {
    const root = this.rootPath;
    if (!root) return undefined;
    const parent = path.dirname(node.uri.fsPath);
    if (parent === node.uri.fsPath || parent === root) return undefined;
    return this.nodeForPath(parent, true);
  }

  private _buildNode(root: string, absPath: string, isDirectory: boolean): FileNode {
    // Git relpath form (forward slashes) — matches _changedFiles keys and the
    // paths git commands expect, on Windows included.
    const relPath = path.relative(root, absPath).split(path.sep).join("/");
    const change = isDirectory ? undefined : this._changedFiles.get(relPath);
    const node: FileNode = {
      uri: vscode.Uri.file(absPath),
      isDirectory,
      name: path.basename(absPath),
      relPath,
      change,
    };
    if (change) {
      node.repoPath = root;
      node.filePath = change.path;
      node.fileChange = change;
    }
    return node;
  }

  getTreeItem(node: FileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.uri,
      node.isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    // Stable id: lets reveal() match synthesized nodes and preserves
    // expansion state across refreshes.
    item.id = node.uri.fsPath;
    item.label = node.name;
    item.resourceUri = node.uri;
    if (node.isDirectory) {
      item.contextValue = "repo-file-dir";
    } else if (node.change) {
      item.contextValue =
        node.change.status === FileStatus.Staged ? "repo-file-staged" : "repo-file-changed";
    } else {
      item.contextValue = "repo-file";
    }
    if (!node.isDirectory) {
      const fc = node.change;
      if (fc && fc.status !== FileStatus.Untracked) {
        const repoPath = this.rootPath!;
        const staged = fc.status === FileStatus.Staged;
        const ref = staged ? "HEAD" : ":0";
        const leftUri = vscode.Uri.parse(
          `git-show:${path.join(repoPath, fc.path)}`,
        ).with({ query: JSON.stringify({ path: fc.path, ref, repoPath }) });
        const rightUri = staged
          ? vscode.Uri.parse(
              `git-show:${path.join(repoPath, fc.path)}`,
            ).with({ query: JSON.stringify({ path: fc.path, ref: ":0", repoPath }) })
          : node.uri;
        item.command = {
          command: "vscode.diff",
          title: "Show Diff",
          arguments: [leftUri, rightUri, `${node.name} (${staged ? "Staged" : "Working Tree"})`],
        };
      } else {
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [node.uri],
        };
      }
    }
    return item;
  }

  private async _ensureChangedFiles(): Promise<void> {
    if (this._changesLoaded) return;
    // Dedupe concurrent expands: one status run, one decoration refresh.
    if (this._changesPromise) return this._changesPromise;
    const promise = this._loadChangedFiles();
    this._changesPromise = promise;
    try {
      await promise;
    } finally {
      // Only clear our own handle — _resetState may have already replaced it.
      if (this._changesPromise === promise) this._changesPromise = undefined;
    }
  }

  private async _loadChangedFiles(): Promise<void> {
    const root = this.rootPath;
    if (!root) return;
    // Build into a fresh map and only commit it if the selection hasn't
    // changed while git status ran — otherwise the OLD repo's results would
    // populate the map now owned by the NEW repo (wrong decorations, and
    // stage/discard nodes pointing at the wrong repoPath).
    const fresh = new Map<string, FileChange>();
    try {
      const status = await this._repoManager.git.status(root);
      for (const fc of [...status.staged, ...status.unstaged, ...status.untracked]) {
        fresh.set(fc.path, fc);
      }
    } catch { /* ignore */ }
    if (root !== this.rootPath) return;
    this._changedFiles = fresh;
    this._changesLoaded = true;
    this._onDidUpdateChanges.fire();
  }

  async getChildren(node?: FileNode): Promise<FileNode[]> {
    const root = this.rootPath;
    if (!root) return [];

    await this._ensureChangedFiles();

    const dir = node ? node.uri.fsPath : root;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const filtered = entries.filter((e) => e.name !== ".git");
    filtered.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // One batched (and 30s-cached) ignore listing per repo instead of a
    // `check-ignore` spawn per expanded directory.
    let ignoredSet = new Set<string>();
    try {
      ignoredSet = await this._repoManager.git.ignoredPaths(root);
    } catch { /* ignore — entries just render undimmed */ }

    // Selection changed while we awaited — don't cache nodes for the old root.
    if (root !== this.rootPath) return [];

    const hideIgnored = vscode.workspace
      .getConfiguration()
      .get<boolean>(CONFIG.filesHideIgnored, false);

    // Drop stale cache entries for this directory before re-adding. Entries
    // that disappeared take their cached descendants with them — otherwise
    // deleted/moved subtrees keep serving stale isIgnored/node answers.
    const present = new Set(filtered.map((e) => path.join(dir, e.name)));
    const gonePrefixes: string[] = [];
    for (const key of [...this._nodes.keys()]) {
      if (path.dirname(key) === dir) {
        this._nodes.delete(key);
        if (!present.has(key)) gonePrefixes.push(key + path.sep);
      }
    }
    for (const key of [...this._ignored]) {
      if (path.dirname(key) === dir) {
        this._ignored.delete(key);
        if (!present.has(key)) gonePrefixes.push(key + path.sep);
      }
    }
    if (gonePrefixes.length > 0) {
      for (const key of [...this._nodes.keys()]) {
        if (gonePrefixes.some((p) => key.startsWith(p))) this._nodes.delete(key);
      }
      for (const key of [...this._ignored]) {
        if (gonePrefixes.some((p) => key.startsWith(p))) this._ignored.delete(key);
      }
    }

    const nodes: FileNode[] = [];
    for (const e of filtered) {
      const absPath = path.join(dir, e.name);
      const rel = path.relative(root, absPath).split(path.sep).join("/");
      const ignored = this._isEntryIgnored(ignoredSet, rel);
      if (ignored) this._ignored.add(absPath);
      if (ignored && hideIgnored) continue;
      const n = this._buildNode(root, absPath, e.isDirectory());
      this._nodes.set(absPath, n);
      nodes.push(n);
    }
    return nodes;
  }

  /**
   * Whether a forward-slash relpath is gitignored according to the batched
   * `ls-files --ignored --directory` set: a file entry matches exactly, a
   * directory entry has a trailing "/", and contents of ignored directories
   * are not listed individually — so also match any ancestor "dir/" prefix.
   */
  private _isEntryIgnored(ignoredSet: Set<string>, rel: string): boolean {
    if (ignoredSet.size === 0) return false;
    if (ignoredSet.has(rel) || ignoredSet.has(rel + "/")) return true;
    let slash = rel.indexOf("/");
    while (slash > 0) {
      if (ignoredSet.has(rel.slice(0, slash + 1))) return true;
      slash = rel.indexOf("/", slash + 1);
    }
    return false;
  }

  // ── Drag and drop ──────────────────────────────────────────────────────

  handleDrag(source: readonly FileNode[], dataTransfer: vscode.DataTransfer): void {
    dataTransfer.set(
      DND_MIME,
      new vscode.DataTransferItem(source.map((n) => n.uri.fsPath)),
    );
    // Lets files be dropped onto the editor area to open them.
    dataTransfer.set(
      "text/uri-list",
      new vscode.DataTransferItem(source.map((n) => n.uri.toString()).join("\r\n")),
    );
  }

  async handleDrop(
    target: FileNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    const root = this.rootPath;
    if (!root) return;
    const sources = (dataTransfer.get(DND_MIME)?.value as string[] | undefined) ?? [];
    if (sources.length === 0) return;

    const destDir = !target
      ? root
      : target.isDirectory
        ? target.uri.fsPath
        : path.dirname(target.uri.fsPath);
    if (destDir !== root && !destDir.startsWith(root + path.sep)) return;

    const failures: string[] = [];
    for (const src of sources) {
      if (src === root || !src.startsWith(root + path.sep)) continue;
      if (destDir === src || destDir.startsWith(src + path.sep)) {
        failures.push(`${path.basename(src)}: cannot move a folder into itself`);
        continue;
      }
      const dest = path.join(destDir, path.basename(src));
      if (dest === src) continue;
      try {
        let exists = true;
        try {
          await fs.promises.stat(dest);
        } catch {
          exists = false;
        }
        if (exists) {
          failures.push(`${path.basename(src)}: already exists in destination`);
          continue;
        }
        await fs.promises.rename(src, dest);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${path.basename(src)}: ${msg}`);
      }
    }
    if (failures.length > 0) {
      vscode.window.showErrorMessage(
        `Diffchestrator: Some items were not moved — ${failures.join("; ")}`,
      );
    }
    this.refresh();
  }

  dispose(): void {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._fsWatcher?.dispose();
    for (const d of this._disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
    this._onDidUpdateChanges.dispose();
  }
}
