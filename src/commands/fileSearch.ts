import * as vscode from "vscode";
import * as path from "path";
import type { RepoManager } from "../services/repoManager";
import { CMD, BATCH_SMALL, BATCH_LARGE } from "../constants";
import { resolveRepoPath } from "../utils/fileItem";

/**
 * Pick a codicon per file type as a coarse approximation of Ctrl+P's icon
 * theme lookup. QuickPickItem can't reach the private file-icon-theme API
 * that Ctrl+P uses, so we map extensions (and a few well-known filenames) to
 * the richer codicons VS Code ships (json, markdown, html, etc.) and fall
 * back to ThemeIcon.File for everything else.
 */
function pickFileIcon(relPath: string): vscode.ThemeIcon {
  const name = path.basename(relPath).toLowerCase();

  // Well-known filenames first — some have no extension
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return new vscode.ThemeIcon("file");
  if (name === "makefile" || name === "rakefile" || name === "gemfile") return new vscode.ThemeIcon("file-code");
  if (name === ".gitignore" || name === ".gitattributes") return new vscode.ThemeIcon("source-control");
  if (name === ".env" || name.startsWith(".env.")) return new vscode.ThemeIcon("key");
  if (name.endsWith(".lock") || name === "package-lock.json" || name === "yarn.lock" || name === "pnpm-lock.yaml") return new vscode.ThemeIcon("lock");

  const ext = path.extname(name).slice(1);
  switch (ext) {
    case "json": case "jsonc": case "json5":
      return new vscode.ThemeIcon("json");
    case "md": case "markdown": case "mdx":
      return new vscode.ThemeIcon("markdown");
    case "html": case "htm":
      return new vscode.ThemeIcon("html");
    case "css": case "scss": case "sass": case "less":
      return new vscode.ThemeIcon("symbol-color");
    case "yaml": case "yml": case "toml": case "xml": case "ini": case "conf":
      return new vscode.ThemeIcon("file-code");
    case "ts": case "tsx": case "js": case "jsx": case "mjs": case "cjs":
    case "py": case "rb": case "go": case "rs": case "java":
    case "c": case "cpp": case "cc": case "h": case "hpp":
    case "cs": case "swift": case "kt": case "kts": case "php":
    case "lua": case "dart": case "scala": case "clj": case "ex": case "exs":
    case "vue": case "svelte": case "astro":
      return new vscode.ThemeIcon("file-code");
    case "sh": case "bash": case "zsh": case "fish":
      return new vscode.ThemeIcon("terminal-bash");
    case "ps1": case "psm1":
      return new vscode.ThemeIcon("terminal-powershell");
    case "png": case "jpg": case "jpeg": case "gif": case "svg":
    case "webp": case "ico": case "bmp":
    case "mp3": case "mp4": case "wav": case "mov": case "avi": case "mkv": case "flac":
      return new vscode.ThemeIcon("file-media");
    case "pdf":
      return new vscode.ThemeIcon("file-pdf");
    case "zip": case "tar": case "gz": case "rar": case "7z": case "xz": case "bz2":
      return new vscode.ThemeIcon("file-zip");
    case "log":
      return new vscode.ThemeIcon("output");
    case "sql":
      return new vscode.ThemeIcon("database");
    case "txt": case "rtf":
      return new vscode.ThemeIcon("file-text");
    case "exe": case "dll": case "so": case "dylib": case "bin":
      return new vscode.ThemeIcon("file-binary");
    default:
      return vscode.ThemeIcon.File;
  }
}

export function registerFileSearchCommand(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const git = repoManager.git;

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.searchFiles, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage(
          "Diffchestrator: No repositories scanned. Run 'Scan for Repositories' first."
        );
        return;
      }

      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = "Type to search files across all repositories...";
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      quickPick.onDidChangeValue((value) => {
        if (debounceTimer) clearTimeout(debounceTimer);

        if (value.length < 2) {
          quickPick.items = [];
          return;
        }

        debounceTimer = setTimeout(async () => {
          quickPick.busy = true;
          const items: vscode.QuickPickItem[] = [];

          // Search across all repos concurrently (max BATCH_LARGE at a time)
          for (let i = 0; i < repos.length; i += BATCH_LARGE) {
            const batch = repos.slice(i, i + BATCH_LARGE);
            const results = await Promise.all(
              batch.map(async (repo) => {
                try {
                  const files = await git.listFiles(repo.path, value);
                  return files.slice(0, 20).map((f) => ({
                    label: `$(file) ${path.basename(f)}`,
                    description: f,
                    detail: repo.name,
                    _fullPath: path.join(repo.path, f),
                  }));
                } catch {
                  return [];
                }
              })
            );

            for (const batch of results) {
              items.push(...batch);
            }
          }

          quickPick.items = items.slice(0, 100);
          quickPick.busy = false;
        }, 300);
      });

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as
          | (vscode.QuickPickItem & { _fullPath?: string })
          | undefined;
        if (selected?._fullPath) {
          vscode.window.showTextDocument(
            vscode.Uri.file(selected._fullPath)
          );
        }
        quickPick.dispose();
      });

      quickPick.onDidHide(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        quickPick.dispose();
      });

      quickPick.show();
    })
  );

  // Browse files in a specific repo (pre-loaded, instant filter)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.browseFiles, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }

      const repoName = path.basename(repoPath);

      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = `Browse files in ${repoName}...`;
      quickPick.matchOnDescription = true;
      quickPick.busy = true;

      // Pre-load all files. Codicon per type approximates Ctrl+P's rendering
      // (json, markdown, html have dedicated codicons; everything else bins
      // into file-code / file-media / file-zip / etc., with ThemeIcon.File as
      // the final fallback).
      try {
        const files = await git.listFiles(repoPath);
        quickPick.items = files.map((f) => {
          const fullPath = path.join(repoPath, f);
          return {
            label: path.basename(f),
            description: f, // full relative path, dimmed
            iconPath: pickFileIcon(f),
            _fullPath: fullPath,
            _relPath: f,
          };
        });
      } catch {
        quickPick.items = [{ label: "Failed to list files", description: "" }];
      }
      quickPick.busy = false;

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as
          | (vscode.QuickPickItem & { _fullPath?: string })
          | undefined;
        if (selected?._fullPath) {
          vscode.window.showTextDocument(vscode.Uri.file(selected._fullPath));
        }
        quickPick.dispose();
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    })
  );

  // Shared grep QuickPick across one or many repos
  function openGrepQuickPick(repoPaths: string[], placeholder: string): void {
    const multiRepo = repoPaths.length > 1;
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = placeholder;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    quickPick.onDidChangeValue((value) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (value.length < 2) {
        quickPick.items = [];
        return;
      }

      debounceTimer = setTimeout(async () => {
        quickPick.busy = true;
        try {
          // Grep all repos in parallel (batched to 5)
          const allMatches: (vscode.QuickPickItem & { _fullPath?: string; _line?: number; _repoPath?: string; _noAction?: boolean })[] = [];
          for (let i = 0; i < repoPaths.length; i += BATCH_SMALL) {
            const batch = repoPaths.slice(i, i + BATCH_SMALL);
            const results = await Promise.all(
              batch.map(async (rp) => {
                try {
                  const matches = await git.grep(rp, value, 30);
                  const repoName = path.basename(rp);
                  return matches.map((m) => ({
                    label: `$(file) ${path.basename(m.file)}:${m.line}`,
                    description: multiRepo
                      ? `${path.dirname(m.file) !== "." ? path.dirname(m.file) + " " : ""}[${repoName}]`
                      : (path.dirname(m.file) !== "." ? path.dirname(m.file) : undefined),
                    detail: m.text,
                    _fullPath: path.join(rp, m.file),
                    _line: m.line,
                    _repoPath: rp,
                  }));
                } catch {
                  return [];
                }
              })
            );
            allMatches.push(...results.flat());
          }

          if (allMatches.length === 0) {
            quickPick.items = [{ label: "$(info) No matches found", description: "", _noAction: true }];
          } else {
            quickPick.items = allMatches.slice(0, 100);
          }
        } catch {
          quickPick.items = [{ label: "$(warning) Search failed", description: "" }];
        }
        quickPick.busy = false;
      }, 300);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0] as
        | (vscode.QuickPickItem & { _fullPath?: string; _line?: number; _repoPath?: string; _noAction?: boolean })
        | undefined;
      if (selected?._fullPath && !selected._noAction) {
        const line = (selected._line ?? 1) - 1;
        // Switch to the repo if it's a multi-repo search
        if (selected._repoPath && selected._repoPath !== repoManager.selectedRepo) {
          vscode.commands.executeCommand(CMD.viewDiff, { path: selected._repoPath });
        }
        vscode.window.showTextDocument(
          vscode.Uri.file(selected._fullPath),
          { selection: new vscode.Range(line, 0, line, 0) }
        );
      }
      quickPick.dispose();
    });

    quickPick.onDidHide(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      quickPick.dispose();
    });

    quickPick.show();
  }

  // Search in selected repo
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.grepInRepo, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      openGrepQuickPick([repoPath], `Search in ${path.basename(repoPath)}...`);
    })
  );

  // Search across active/recent repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.grepActiveRepos, async () => {
      const recent = repoManager.recentRepoPaths;
      if (recent.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No active repos. Open some repos first.");
        return;
      }
      const names = recent.map((p) => path.basename(p)).slice(0, 3).join(", ");
      const suffix = recent.length > 3 ? ` +${recent.length - 3} more` : "";
      openGrepQuickPick([...recent], `Search active repos (${names}${suffix})...`);
    })
  );

  // Search across all scanned repos
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.grepAllRepos, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos scanned.");
        return;
      }
      openGrepQuickPick(
        repos.map((r) => r.path),
        `Search all ${repos.length} repos...`
      );
    })
  );

  // Open repo in new VS Code window — gives full native search, explorer, etc.
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.searchInRepo, async (item?: any) => {
      const repoPath = resolveRepoPath(item, repoManager.selectedRepo);
      if (!repoPath) {
        vscode.window.showWarningMessage("Diffchestrator: No repository selected.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(repoPath), true);
    })
  );

  // Switch repo — QuickPick to select a repo and make it active
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.switchRepo, async () => {
      const repos = repoManager.repos;
      if (repos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos scanned.");
        return;
      }

      const currentPath = repoManager.selectedRepo;

      const items = repos.map((r) => ({
        label: `$(repo) ${r.name}`,
        description: r.branch + (r.totalChanges > 0 ? ` — ${r.totalChanges} changes` : ""),
        detail: r.path,
        _repoPath: r.path,
        picked: r.path === currentPath,
      }));

      const changesMap = new Map<string, number>(repos.map((r) => [r.path, r.totalChanges]));

      // Sort: current repo first, then repos with changes, then alphabetical
      items.sort((a, b) => {
        if (a._repoPath === currentPath) return -1;
        if (b._repoPath === currentPath) return 1;
        const aChanges = changesMap.get(a._repoPath) ?? 0;
        const bChanges = changesMap.get(b._repoPath) ?? 0;
        if (aChanges !== bChanges) return bChanges - aChanges;
        return a.label.localeCompare(b.label);
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Switch to a repository...",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await vscode.commands.executeCommand(CMD.viewDiff, { path: selected._repoPath });
      }
    })
  );

  // Switch repo across ALL roots
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.switchRepoAllRoots, async () => {
      const allRepos = repoManager.getAllRootRepoPaths();
      if (allRepos.length === 0) {
        vscode.window.showWarningMessage("Diffchestrator: No repos found across configured roots.");
        return;
      }

      const currentRoot = repoManager.currentRoot;
      const currentPath = repoManager.selectedRepo;

      const items = allRepos.map((r) => ({
        label: `$(repo) ${r.repoName}`,
        description: r.root === currentRoot ? r.root : `$(globe) ${r.root}`,
        detail: r.repoPath,
        _repoPath: r.repoPath,
        _root: r.root,
      }));

      // Sort: current repo first, current root repos next, then alphabetical
      items.sort((a, b) => {
        if (a._repoPath === currentPath) return -1;
        if (b._repoPath === currentPath) return 1;
        const aInRoot = a._root === currentRoot ? 0 : 1;
        const bInRoot = b._root === currentRoot ? 0 : 1;
        if (aInRoot !== bInRoot) return aInRoot - bInRoot;
        return a.label.localeCompare(b.label);
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Switch to a repository (all roots)...",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        // Switch root if needed
        if (selected._root !== currentRoot) {
          await vscode.commands.executeCommand(CMD.switchRoot, selected._root);
        }
        await vscode.commands.executeCommand(CMD.viewDiff, { path: selected._repoPath });
      }
    })
  );
}
