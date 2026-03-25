# Diffchestrator — VS Code Extension

> **Built for Claude Code.** Multi-repo Git orchestration designed as a companion to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's CLI for agentic coding. Stage, review, and commit across repos without leaving VS Code, then hand off to Claude for AI-powered commits, code reviews, and multi-repo workflows.

## Why Diffchestrator?

Claude Code works best when you can see what it changed, across every repo it touched. Diffchestrator gives you that visibility: a sidebar tree of all your repos, real-time change tracking, one-click diffs, and direct terminal integration with `claude`. No context switching, no manual `git status` in twelve terminals.

## Features

### Claude Code Integration
- **AI Commit** — runs `claude --permission-mode acceptEdits` in the repo's terminal for real-time output (`Ctrl+D, C`)
- **Open Claude Code** — launches `claude -c` to continue the previous session, or `claude --add-dir` for multiple selected repos (`Ctrl+D, L`)
- **Yolo** — opens terminal and runs the `yolo` alias from claude-sandbox (`Ctrl+D, Y`)
- **Claude Multi-Repo Review** — opens Claude with `--add-dir` for all repos with changes and a review prompt
- **Ask Claude** button per diff hunk in the multi-repo diff webview
- **Per-repo terminal tracking** — each repo tracks its own Claude, Yolo, and shell terminals independently. Switching repos auto-switches the terminal panel to the correct session
- **Terminal reuse** — `Ctrl+D, L` and `Ctrl+D, Y` reuse existing sessions instead of spawning new ones
- **CLI validation** — checks that `claude` and `docker` are installed before launching terminals

### Active Repos & Workspace Switching
- **Active Repos view** — unified sidebar section showing favorites (star icons) + recent repos (MRU, up to 10) with live terminal status indicators
- **Toggle favorites** — star button in Active Repos title bar shows/hides favorites (filled star = visible, empty star = hidden). Hidden favorites that are active/recent remain visible as their non-favorite role
- **Persisted across reloads** — active repos, selection, and current scan root survive VS Code restarts
- **Cycle repos** — `Ctrl+D, Tab` cycles through all opened repos including favorites, switching the changed files view, terminal, and diff editor in one keystroke
- **Close active repos** — `Ctrl+D, Q` closes current, `Ctrl+D, Shift+Q` picks which to close, `Ctrl+D, Shift+Tab` closes all
- **Terminal indicators** — each repo shows which terminal types are running (Claude, Yolo, Shell)
- **Auto-switch terminal** — clicking a repo in Active Repos or Repositories auto-surfaces that repo's terminal (priority: Claude > Yolo > Shell)
- **Terminal tab sync** — clicking a terminal tab (Claude, Yolo, shell) auto-selects the repo in the sidebar, opens its changed files, and adds it to Active Repos if not already there
- **Auto-add on terminal open** — opening a terminal, Claude Code, or Yolo session for a repo automatically adds it to Active Repos
- **Smart notifications** — notifies when Claude commits or modifies files. Queues notifications when VS Code is unfocused and shows a grouped summary on refocus. Commit notifications offer "Push" and "Show Terminal" actions
- **Workspace snapshots** — save/load named profiles of your root, favorites, and recent repos

### Repository Discovery & Organization
- **Auto-scan** a root directory to discover all git repos (BFS, configurable depth)
- **Switch scan root** — `Ctrl+D, Shift+S` quick pick dropdown to switch between configured roots; also available as a button in the Repositories title bar
- **Root name in view titles** — Active Repos and Repositories views show the current root name
- **Auto-scan workspace folders** on startup if no roots configured, and when new folders are added
- **Skip directories** like `node_modules`, `.terraform`, `vendor`, `build`, etc. (configurable)
- **Changed-only filter** — toggle to show only repos with uncommitted changes (`Ctrl+D, D`)
- **Changed repos sort first** in the tree for quick access
- **Progress indication** — shows scanning/refreshing progress in the status bar for large repo counts
- **Repo tags** — tag repos with labels (e.g., `frontend`, `infra`, `shared`), then filter the tree by tag with `Ctrl+D, I`. Tags appear as `#tag` in repo descriptions
- **Bulk fetch** — fetch all repos at once from the Repositories title bar; distinguishes local-only repos from real failures
- **Bulk pull** — pull all repos that are behind remote with confirmation
- **Auto-fetch on scan** — optionally run `git fetch` during scan for accurate ahead/behind counts

### Sidebar Views (3 sections)
- **Active Repos** — favorites (yellow/blue stars) + recently opened repos with terminal status, active repo highlighted in blue. Pin repos with `Ctrl+D, E`
- **Changed Files** — staged/unstaged/untracked files for the selected repo, grouped by status. Shows diff stats (`+N -M`) per file
- **Repositories** — hierarchical tree with common path prefix collapsing, change count badges, tag indicators, root switcher button
- **View descriptions** — active repo name + branch shown next to "Changed Files" title; root name + tag filter + repo count next to "Repositories"
- **Activity bar badge** — total change count across all repos
- **Tooltips** — hover a repo to see path, branch, change counts, ahead/behind sync status, stash count, remote URL, and last commit with relative date
- **Ahead/behind badges** — `↑N ↓M` shows how many commits you are ahead/behind the remote across all views
- **Health badges** — orange cloud icon for repos behind remote, archive icon with count for stashes
- **Visual highlights** — active repo (blue icon + ●), multi-selected (purple check + ✓), repos with changes (yellow), behind remote (orange), clean repos (green)

### Diff Viewing & Review Workflow
- Click a changed file to open VS Code's **native diff editor** (split view with syntax highlighting)
- **Navigate changed files** — `Ctrl+D, N` / `Shift+N` or ↑↓ buttons in editor title bar to browse files without staging
- **Auto-advance on stage** — staging a file automatically opens the next pending file's diff, enabling a review-then-stage workflow
- **Works from sidebar and editor title bar** — both stage buttons advance to the next file
- **Auto-close stale diffs** — switching to a repo with no changes closes the previous repo's diff; committing a repo's last change auto-closes the diff tab
- **Auto-refresh diffs** — diff content refreshes after CLI commits (no stale content)
- **Context restore** — switching back to a repo reopens the last file you were viewing (changes take priority over remembered files)
- **Multi-repo diff webview** — aggregated diffs across multiple selected repos with react-diff-view
- Per-file stage/unstage controls in the diff view
- **Inline blame** — GitLens-style current-line blame showing author, date, and commit message (`Ctrl+D, G` to toggle)

### Git Operations
- **Stage / Unstage** individual files or all files (inline buttons + context menu + editor title bar)
- **Discard changes** — revert a single file, delete an untracked file, or discard all changes with confirmation dialog
- **Commit** with conventional commit prefix picker (feat/fix/chore/refactor/docs/test/ci) (`Ctrl+D, M`)
- **Undo last commit** (`Ctrl+D, Z`) — soft reset keeping changes staged, with confirmation showing the commit message
- **Auto-push after commit** — optionally push immediately after a successful commit
- **Push** with progress notification (`Ctrl+D, P`)
- **Pull** with progress notification (`Ctrl+D, U`)
- **Fetch** — single-repo fetch via right-click context menu, or bulk fetch all from title bar
- **Bulk commit/push** across multiple selected repos
- **Copy repo info** — right-click to copy path, branch, remote URL, or name to clipboard
- **Open remote URL** — right-click to open the repo's GitHub/GitLab page in browser (auto-converts `git@` SSH URLs to HTTPS)
- **Git detection** — shows error with install link if git isn't available on PATH

### Branch & Stash Management
- **Branch Switcher** (`Ctrl+D, B`) — QuickPick listing all local branches with current branch marked, plus "Create new branch..." option
- **Branch Cleanup** (`Ctrl+D, X`) — find merged branches across all repos and delete them in bulk
- **Stash Management** (`Ctrl+D, A`) — stash push (with message), list stashes, pop latest, apply specific stash, view stash diffs
- **Commit History** (`Ctrl+D, H`) — QuickPick showing last 15 commits, select to view full diff in editor
- **Cross-repo Activity Log** — recent commits across ALL repos sorted by date

### Search & Navigation
- **Search in Repo** (`Ctrl+D, /`) — live git grep QuickPick scoped to the selected repo, opens file at matched line
- **Search Active Repos** (`Ctrl+D, .`) — git grep across all recent/active repos with `[repo-name]` badges
- **Search All Repos** (`Ctrl+D, Shift+/`) — git grep across every scanned repo
- Selecting a search result from a different repo auto-switches to it (terminal, changed files, everything)
- **Browse Files** (`Ctrl+D, F`) — QuickPick with all files in a repo via `git ls-files`, instant filtering
- **Switch Repo** (`Ctrl+D, R`) — QuickPick sorted by changes, current repo first
- **Open in New Window** (`Ctrl+D, W`) — opens the selected repo in a new VS Code window for full native search

### File Watcher
- Watches `.git/` directories per repo (HEAD, index, refs changes) with 500ms debounce
- Status updates in real-time when commits, staging, or branch changes occur
- Auto-suppresses after explicit operations (stage/commit) to avoid redundant refreshes
- Falls back to polling at configurable interval (default 10s)
- **Pauses when VS Code loses focus** — no wasted disk reads in the background; refreshes immediately on refocus

### Performance
- **Single shared git instance** — all commands share one GitExecutor with request deduplication (concurrent calls share one Promise) and a 1s TTL cache
- **Lazy activation** — extension defers loading until the sidebar is opened or VS Code finishes startup
- **Smart file watching** — watches `.git/` directories only (not `**/*`), with automatic suppression after explicit refreshes to avoid double updates
- **Event coalescing** — rapid repo-change events are batched into a single tick, preventing cascading tree rebuilds during scan
- **Conditional event firing** — tree views only rebuild when data actually changes (~90% fewer rebuilds during idle polling)
- **Batched concurrency** — `refreshAll` and scan limited to 5-10 concurrent git processes with progress indication
- **Terminal state caching** — Active Repos only rescans terminals on open/close events
- **Status bar debounce** — consolidates multiple rapid updates into one render

### Status Bar
- **Left**: repo count + total changes (click to open sidebar)
- **Right**: active repo name + branch + changes with prominent background (click to switch repo)

## Keyboard Shortcuts

All shortcuts use **Ctrl+D** as a chord prefix — press `Ctrl+D`, release, then press the key:

| Chord | Action |
|-------|--------|
| `Ctrl+D, Tab` | Cycle through recent active repos |
| `Ctrl+D, Shift+Tab` | Close all active repos |
| `Ctrl+D, Q` | Close current active repo |
| `Ctrl+D, Shift+Q` | Pick which active repo to close |
| `Ctrl+D, N` | Next changed file |
| `Ctrl+D, Shift+N` | Previous changed file |
| `Ctrl+D, M` | Commit with message (conventional prefix picker) |
| `Ctrl+D, C` | AI Commit (Claude) |
| `Ctrl+D, L` | Open Claude Code (continues session) |
| `Ctrl+D, Y` | Yolo (Claude Sandbox) |
| `Ctrl+D, S` | Scan for repositories |
| `Ctrl+D, Shift+S` | Switch scan root |
| `Ctrl+D, Shift+T` | Open terminal at scan root |
| `Ctrl+D, T` | Open terminal at repo |
| `Ctrl+D, R` | Switch active repo |
| `Ctrl+D, F` | Browse files in repo |
| `Ctrl+D, P` | Push |
| `Ctrl+D, U` | Pull |
| `Ctrl+D, D` | Toggle changed-only filter |
| `Ctrl+D, H` | Commit history |
| `Ctrl+D, B` | Switch branch |
| `Ctrl+D, A` | Stash management |
| `Ctrl+D, G` | Toggle inline blame |
| `Ctrl+D, E` | Favorite current repo |
| `Ctrl+D, /` | Search in repo (git grep) |
| `Ctrl+D, .` | Search active repos |
| `Ctrl+D, Shift+/` | Search all repos |
| `Ctrl+D, W` | Open repo in new VS Code window |
| `Ctrl+D, K` | Show keyboard shortcut cheatsheet |
| `Ctrl+D, X` | Clean up merged branches |
| `Ctrl+D, I` | Filter repos by tag |
| `Ctrl+D, Z` | Undo last commit (soft reset) |
| `Ctrl+D, Shift+B` | Save workspace snapshot |
| `Ctrl+D, Shift+L` | Load workspace snapshot |

> On macOS, use `Cmd+D` instead of `Ctrl+D`.

## Context Menu Actions

Right-click a **repository** in the tree:

- View Diff / Commit / Push / Pull / Fetch / AI Commit / Undo Commit
- Commit History / Switch Branch / Stash Management
- Browse Files / Open Repo in New Window
- Open Terminal / Open Claude Code / Yolo
- Copy Repo Info / Open Remote in Browser / Set Tags
- Toggle Favorite / Select (for multi-repo operations)

Right-click a **directory** in the tree:

- Open Terminal / Open Claude Code / Yolo (launches with cwd set to the directory)
- Toggle Favorite

Right-click a **changed file**:

- Stage / Unstage (also available as inline icon buttons)
- Discard Changes (with confirmation)

**Editor title bar** (top-right of diff editor):

- Prev/Next Changed File (↑↓ buttons to browse without staging)
- Stage This File / Unstage This File (with auto-advance to next file)

**Changed Files view title**:

- Stage All / Unstage All / Discard All

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `diffchestrator.scanRoots` | `[]` | Root directories to scan for repos |
| `diffchestrator.scanMaxDepth` | `6` | Maximum directory depth for scanning |
| `diffchestrator.scanExtraSkipDirs` | `[]` | Additional directory names to skip |
| `diffchestrator.scanOnStartup` | `true` | Auto-scan configured roots on VS Code start |
| `diffchestrator.changedOnlyDefault` | `false` | Show only changed repos by default |
| `diffchestrator.autoRefreshInterval` | `10` | Auto-refresh interval in seconds (0 to disable) |
| `diffchestrator.claudePermissionMode` | `acceptEdits` | Permission mode for Claude CLI |
| `diffchestrator.showInlineBlame` | `true` | Show inline git blame on current line |
| `diffchestrator.showFavorites` | `true` | Show favorites in Active Repos view |
| `diffchestrator.fetchOnScan` | `false` | Auto-fetch during scan for accurate ahead/behind counts |
| `diffchestrator.autoPushAfterCommit` | `false` | Auto-push after successful commit via `Ctrl+D, M` |
| `diffchestrator.favorites` | `[]` | Persisted favorite paths (managed by extension) |
| `diffchestrator.repoTags` | `{}` | Repo tags for filtering (managed by extension) |
| `diffchestrator.snapshots` | `{}` | Workspace snapshots (managed by extension) |

## Getting Started

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=andrevops-com.diffchestrator) or build locally with `make package`
2. Add your project root to settings:
   ```json
   {
     "diffchestrator.scanRoots": ["/home/user/projects"]
   }
   ```
   Or just open a folder — the extension auto-detects workspace folders if no roots are configured.
3. The extension auto-scans on startup and populates the sidebar
4. Click a repo to see its changed files, click a file to see the diff
5. Use `Ctrl+D, C` to AI commit with Claude, `Ctrl+D, L` to open Claude Code
6. Press `Ctrl+D, K` to see all keyboard shortcuts

## Release

```bash
make release          # Auto-detect bump from conventional commits
make release-patch    # Force patch bump
make release-minor    # Force minor bump
make release-major    # Force major bump
make install          # Install latest .vsix locally
make clean            # Remove build artifacts
```

The release script reads commit messages since the last `v*` tag, picks the semver bump (`feat:` = minor, `fix:` = patch, `BREAKING CHANGE` = major), updates CHANGELOG.md, commits the version bump, tags, builds, and packages the `.vsix`.

## Development

```bash
# Install dependencies
npm install
cd webview-ui && npm install && cd ..

# Build
make build           # Extension + webview
make compile         # Extension only (fast)
make watch           # Watch mode

# Debug
# Press F5 in VS Code to launch Extension Host
```

## Architecture

```
src/
├── extension.ts              # Activation entrypoint
├── constants.ts              # Command/view/config IDs
├── types.ts                  # Shared TypeScript interfaces
├── git/
│   ├── gitExecutor.ts        # Git CLI wrapper (child_process.execFile)
│   │                         # status, diff, stage, unstage, commit, push, pull, fetch,
│   │                         # log, branches, checkout, stash, blame, show, clean, grep
│   └── scanner.ts            # BFS directory scanner
├── providers/
│   ├── activeReposProvider.ts # Favorites + recent repos with terminal indicators
│   ├── repoTreeProvider.ts   # Repo tree with health badges + tag indicators + tooltips
│   ├── changedFilesProvider.ts # Changed files with diff stats
│   └── gitContentProvider.ts # TextDocumentContentProvider for diff/show URIs
├── commands/
│   ├── scan.ts               # Scan/rescan
│   ├── stage.ts              # Stage/unstage file + all + auto-advance
│   ├── commit.ts             # Commit with prefix picker (single + bulk) + auto-push
│   ├── push.ts               # Push (single + bulk)
│   ├── pull.ts               # Pull with progress
│   ├── aiCommit.ts           # Claude CLI AI commit with .git watcher
│   ├── openClaude.ts         # Open Claude Code terminal (per-repo tracking)
│   ├── terminal.ts           # Terminal management + CLI validation
│   ├── favorites.ts          # Toggle favorites + favorite current repo
│   ├── fileSearch.ts         # Browse files + switch repo + open in new window
│   ├── commitHistory.ts      # Commit history viewer
│   ├── discard.ts            # Discard file/all changes (tracked + untracked)
│   ├── switchBranch.ts       # Branch switcher + create
│   └── stash.ts              # Stash push/list/pop/apply
├── services/
│   ├── repoManager.ts        # Central state + MRU + cycle + tag filter + snapshots
│   ├── fileWatcher.ts        # .git directory watcher with suppression
│   ├── statusBar.ts          # Status bar items with debounce
│   ├── inlineBlame.ts        # Current-line git blame decorations
│   └── workspaceAutoScan.ts  # Auto-scan workspace folders (async)
├── views/
│   └── diffWebviewPanel.ts   # Multi-repo diff webview
└── utils/
    ├── time.ts              # Shared timeAgo / timeAgoShort utilities
    ├── paths.ts
    └── disposable.ts

webview-ui/                   # React app for multi-repo diff
├── src/
│   ├── App.tsx               # Diff viewer with react-diff-view
│   └── vscode.ts             # VS Code API wrapper
└── vite.config.ts            # Builds to dist/webview/

scripts/
└── release.mjs               # Auto-detect semver bump + changelog + commit + tag + build
```

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API, esbuild
- **Git**: `child_process.execFile` (no shell=true)
- **Webview**: React 19, Vite, react-diff-view
- **AI**: Claude Code CLI integration
- **CI/CD**: GitHub Actions for building and releasing
- **No backend server** — everything runs in-process via the VS Code extension host
