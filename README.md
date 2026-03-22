# Diffchestrator — VS Code Extension

> **Built for Claude Code.** Multi-repo Git orchestration designed as a companion to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's CLI for agentic coding. Stage, review, and commit across repos without leaving VS Code, then hand off to Claude for AI-powered commits, code reviews, and multi-repo workflows.

## Why Diffchestrator?

Claude Code works best when you can see what it changed, across every repo it touched. Diffchestrator gives you that visibility: a sidebar tree of all your repos, real-time change tracking, one-click diffs, and direct terminal integration with `claude`. No context switching, no manual `git status` in twelve terminals.

## Features

### Claude Code Integration
- **AI Commit** — runs `claude --permission-mode acceptEdits` in the repo's terminal for real-time output (`Ctrl+D, C`)
- **Open Claude Code** — launches `claude -c` to continue the previous session, or `claude --add-dir` for multiple selected repos (`Ctrl+D, L`)
- **Yolo** — opens terminal and runs the `yolo` alias from claude-sandbox (`Ctrl+D, Y`)
- **Ask Claude** button per diff hunk in the multi-repo diff webview
- **Per-repo terminal tracking** — each repo tracks its own Claude, Yolo, and shell terminals independently. Switching repos auto-switches the terminal panel to the correct session.
- **Terminal reuse** — `Ctrl+D, L` and `Ctrl+D, Y` reuse existing sessions instead of spawning new ones

### Active Repos & Workspace Switching
- **Active Repos view** — sidebar section showing recent repos (MRU, up to 10) with live terminal status indicators
- **Cycle repos** — `Ctrl+D, Tab` cycles through all recent repos (like Alt+Tab but for repos), switching the changed files view, terminal, and diff editor in one keystroke
- **Terminal indicators** — each repo shows which terminal types are running (Claude, Yolo, Shell)
- **Auto-switch terminal** — clicking a repo in Active Repos, Favorites, or Repositories auto-surfaces that repo's terminal (priority: Claude > Yolo > Shell)

### Repository Discovery
- **Auto-scan** a root directory to discover all git repos (BFS, configurable depth)
- **Auto-scan workspace folders** on startup if no roots configured, and when new folders are added
- **Skip directories** like `node_modules`, `.terraform`, `vendor`, `build`, etc. (configurable)
- **Changed-only filter** — toggle to show only repos with uncommitted changes (`Ctrl+D, D`)
- **Changed repos sort first** in the tree for quick access

### Sidebar Views
- **Active Repos** — recently opened repos with terminal status, active repo highlighted in blue
- **Changed Files** — staged/unstaged/untracked files for the selected repo, grouped by status
- **Favorites** — pin repos for quick access with `Ctrl+D, E`; active repo highlighted with blue star
- **Repositories** — hierarchical tree with common path prefix collapsing, change count badges
- **View descriptions** — active repo name + branch shown next to "Changed Files" title
- **Activity bar badge** — total change count across all repos
- **Tooltips** — hover a repo to see path, branch, change counts, ahead/behind sync status, remote URL, and last commit with relative date
- **Ahead/behind badges** — `↑N ↓M` shows how many commits you are ahead/behind the remote across all views
- **Visual highlights** — active repo (blue icon + ●), multi-selected (purple check + ✓), repos with changes (yellow), clean repos (green)

### Diff Viewing & Review Workflow
- Click a changed file to open VS Code's **native diff editor** (split view with syntax highlighting)
- **Auto-advance on stage** — staging a file automatically opens the next pending file's diff, enabling a review-then-stage workflow
- **Works from sidebar and editor title bar** — both stage buttons advance to the next file
- **Auto-close stale diffs** — switching to a repo with no changes closes the previous repo's diff
- **Multi-repo diff webview** — aggregated diffs across multiple selected repos with react-diff-view
- Per-file stage/unstage controls in the diff view
- **Inline blame** — GitLens-style current-line blame showing author, date, and commit message (`Ctrl+D, G` to toggle)

### Git Operations
- **Stage / Unstage** individual files or all files (inline buttons + context menu + editor title bar)
- **Discard changes** — revert a single file or all changes with confirmation dialog
- **Commit** with message input box
- **Push** with progress notification
- **Pull** with progress notification (`Ctrl+D, U`)
- **Bulk commit/push** across multiple selected repos

### Branch & Stash Management
- **Branch Switcher** (`Ctrl+D, B`) — QuickPick listing all local branches with current branch marked, plus "Create new branch..." option
- **Stash Management** (`Ctrl+D, A`) — stash push (with message), list stashes, pop latest, apply specific stash, view stash diffs
- **Commit History** (`Ctrl+D, H`) — QuickPick showing last 15 commits, select to view full diff in editor

### Search & Navigation
- **Search in Repo** (`Ctrl+D, /`) — live git grep QuickPick scoped to the selected repo, opens file at matched line
- **Search Active Repos** (`Ctrl+D, .`) — git grep across all recent/active repos with `[repo-name]` badges
- **Search All Repos** (`Ctrl+D, Shift+/`) — git grep across every scanned repo
- Selecting a search result from a different repo auto-switches to it (terminal, changed files, everything)
- **Browse Files** (`Ctrl+D, F`) — QuickPick with all files in a repo via `git ls-files`, instant filtering
- **Switch Repo** (`Ctrl+D, R`) — QuickPick sorted by changes, current repo first
- **Open in New Window** (`Ctrl+D, W`) — opens the selected repo in a new VS Code window for full native search

### File Watcher
- Automatic filesystem watching per repo with 500ms debounce
- Status updates in real-time when files change externally (terminal, other editors)
- Falls back to polling at configurable interval (default 10s)
- **Pauses when VS Code loses focus** — no wasted disk reads in the background; refreshes immediately on refocus

### Status Bar
- **Left**: repo count + total changes (click to open sidebar)
- **Right**: active repo name + branch + changes with prominent background (click to switch repo)

## Keyboard Shortcuts

All shortcuts use **Ctrl+D** as a chord prefix — press `Ctrl+D`, release, then press the key:

| Chord | Action |
|-------|--------|
| `Ctrl+D, Tab` | Cycle through recent active repos |
| `Ctrl+D, C` | AI Commit (Claude) |
| `Ctrl+D, L` | Open Claude Code (continues session) |
| `Ctrl+D, Y` | Yolo (Claude Sandbox) |
| `Ctrl+D, S` | Scan for repositories |
| `Ctrl+D, R` | Switch active repo |
| `Ctrl+D, F` | Browse files in repo |
| `Ctrl+D, P` | Push |
| `Ctrl+D, U` | Pull |
| `Ctrl+D, T` | Open terminal at repo |
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

> On macOS, use `Cmd+D` instead of `Ctrl+D`.

## Context Menu Actions

Right-click a **repository** in the tree:

- View Diff / Commit / Push / Pull / AI Commit
- Commit History / Switch Branch / Stash Management
- Browse Files / Open Repo in New Window
- Open Terminal / Open Claude Code / Yolo
- Toggle Favorite / Select (for multi-repo operations)

Right-click a **changed file**:

- Stage / Unstage (also available as inline icon buttons)
- Discard Changes (with confirmation)

**Editor title bar** (top-right of diff editor):

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
| `diffchestrator.favorites` | `[]` | Persisted favorite paths (managed by extension) |

## Getting Started

1. Install the extension (F5 to run in development, or package with `vsce`)
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

## Release

```bash
npm run release          # Auto-detect bump from conventional commits
npm run release:patch    # Force patch bump
npm run release:minor    # Force minor bump
npm run release:major    # Force major bump
```

The release script reads commit messages since the last `v*` tag, picks the semver bump (`feat:` = minor, `fix:` = patch, `BREAKING CHANGE` = major), commits the version bump, tags, builds, and packages the `.vsix`.

## Development

```bash
# Install dependencies
npm install
cd webview-ui && npm install && cd ..

# Build
npm run build          # Extension + webview
npm run compile        # Extension only
npm run build:webview  # Webview only

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
│   │                         # status, diff, stage, unstage, commit, push, pull,
│   │                         # log, branches, checkout, stash, blame, show, clean, grep
│   └── scanner.ts            # BFS directory scanner
├── providers/
│   ├── activeReposProvider.ts # Recent repos with terminal status indicators
│   ├── repoTreeProvider.ts   # Repo tree with active/selected highlights + tooltips
│   ├── favoritesTreeProvider.ts # Favorites with active highlight
│   ├── changedFilesProvider.ts
│   └── gitContentProvider.ts # TextDocumentContentProvider for diff/show URIs
├── commands/
│   ├── scan.ts               # Scan/rescan
│   ├── stage.ts              # Stage/unstage file + all + auto-advance
│   ├── commit.ts             # Commit (single + bulk)
│   ├── push.ts               # Push (single + bulk)
│   ├── pull.ts               # Pull with progress
│   ├── aiCommit.ts           # Claude CLI AI commit (runs in terminal)
│   ├── openClaude.ts         # Open Claude Code terminal (per-repo tracking)
│   ├── terminal.ts           # Terminal management (shell/claude/yolo per repo)
│   ├── favorites.ts          # Toggle favorites + favorite current repo
│   ├── fileSearch.ts         # Browse files + switch repo + open in new window
│   ├── commitHistory.ts      # Commit history viewer
│   ├── discard.ts            # Discard file/all changes
│   ├── switchBranch.ts       # Branch switcher + create
│   └── stash.ts              # Stash push/list/pop/apply
├── services/
│   ├── repoManager.ts        # Central state + MRU recent repos + cycle
│   ├── fileWatcher.ts        # Per-repo filesystem watcher
│   ├── statusBar.ts          # Status bar items
│   ├── inlineBlame.ts        # Current-line git blame decorations
│   └── workspaceAutoScan.ts  # Auto-scan workspace folders
├── views/
│   └── diffWebviewPanel.ts   # Multi-repo diff webview
└── utils/
    ├── paths.ts
    └── disposable.ts

webview-ui/                   # React app for multi-repo diff
├── src/
│   ├── App.tsx               # Diff viewer with react-diff-view
│   └── vscode.ts             # VS Code API wrapper
└── vite.config.ts            # Builds to dist/webview/

scripts/
└── release.mjs               # Auto-detect semver bump + commit + tag + build
```

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API, esbuild
- **Git**: `child_process.execFile` (no shell=true)
- **Webview**: React 19, Vite, react-diff-view
- **AI**: Claude Code CLI integration
- **No backend server** — everything runs in-process via the VS Code extension host
