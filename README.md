# Diffchestrator — VS Code Extension

Multi-repo Git orchestration for VS Code. Scan a directory to discover all git repositories, view changes across repos, stage/commit/push, and integrate with Claude Code for AI-powered workflows — all from the sidebar.

## Features

### Repository Discovery
- **Auto-scan** a root directory to discover all git repos (BFS, configurable depth)
- **Skip directories** like `node_modules`, `.terraform`, `vendor`, `build`, etc.
- **Changed-only filter** — toggle to show only repos with uncommitted changes
- **Changed repos sort first** in the tree for quick access

### Sidebar Views
- **Repositories** — hierarchical tree with common path prefix collapsing, change count badges
- **Favorites** — pin repos and directories for quick access (right-click → Toggle Favorite)
- **Changed Files** — staged/unstaged/untracked files for the selected repo, grouped by status
- **View descriptions** — active repo name + branch shown next to the "Changed Files" title
- **Activity bar badge** — total change count across all repos

### Diff Viewing
- Click a changed file to open VS Code's **native diff editor** (split view with syntax highlighting)
- **Multi-repo diff webview** — aggregated diffs across multiple selected repos with react-diff-view
- Per-file stage/unstage controls in the diff view
- "Ask Claude" button per diff hunk

### Git Operations
- **Stage / Unstage** individual files or all files (inline buttons + context menu)
- **Commit** with message input box
- **Push** with progress notification
- **AI Commit** — runs `claude -p --permission-mode acceptEdits` to auto-review, stage, and commit
- **Bulk commit/push** across multiple selected repos

### Terminal & Claude Integration
- **Open Terminal** at any repo or directory (context menu + shortcut)
- **Open Claude Code** — launches `claude` in a terminal for single repos, or `claude --add-dir` for multiple selected repos
- **Browse Files** — QuickPick with all files in a repo, instant filtering (via `git ls-files`)
- **Switch Repo** — QuickPick to switch the active repo, sorted by changes

### File Watcher
- Automatic filesystem watching per repo with 500ms debounce
- Status updates in real-time when files change externally (terminal, other editors)

### Status Bar
- **Left**: repo count + total changes (click → open sidebar)
- **Right**: active repo name + branch + changes with prominent background (click → switch repo)

## Keyboard Shortcuts

All shortcuts use **Alt+D** as a chord prefix:

| Chord | Action |
|-------|--------|
| `Alt+D, S` | Scan for repositories |
| `Alt+D, R` | Switch active repo |
| `Alt+D, F` | Browse files in repo |
| `Alt+D, C` | AI Commit (Claude) |
| `Alt+D, P` | Push |
| `Alt+D, T` | Open terminal at repo |
| `Alt+D, L` | Open Claude Code |
| `Alt+D, D` | Toggle changed-only filter |

## Context Menu Actions

Right-click a **repository** in the tree:

- View Diff
- Commit / Push / AI Commit
- Browse Files
- Open Terminal
- Open Claude Code
- Toggle Favorite
- Select (for multi-repo operations)

Right-click a **changed file**:

- Stage / Unstage (also available as inline icon buttons)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `diffchestrator.scanRoots` | `[]` | Root directories to scan for repos |
| `diffchestrator.scanMaxDepth` | `6` | Maximum directory depth for scanning |
| `diffchestrator.scanExtraSkipDirs` | `[]` | Additional directory names to skip |
| `diffchestrator.scanOnStartup` | `true` | Auto-scan configured roots on VS Code start |
| `diffchestrator.changedOnlyDefault` | `false` | Show only changed repos by default |
| `diffchestrator.autoRefreshInterval` | `10` | Auto-refresh interval in seconds |
| `diffchestrator.claudePermissionMode` | `acceptEdits` | Permission mode for Claude CLI (`acceptEdits`, `default`, `plan`, `auto`) |
| `diffchestrator.favorites` | `[]` | Persisted favorite paths (managed by extension) |

## Getting Started

1. Install the extension (F5 to run in development, or package with `vsce`)
2. Add your project root to settings:
   ```json
   {
     "diffchestrator.scanRoots": ["/home/user/projects"]
   }
   ```
3. The extension auto-scans on startup and populates the sidebar
4. Click a repo to see its changed files, click a file to see the diff
5. Use `Alt+D, C` to AI commit, `Alt+D, P` to push

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
│   └── scanner.ts            # BFS directory scanner
├── providers/
│   ├── repoTreeProvider.ts   # Repo tree in sidebar
│   ├── favoritesTreeProvider.ts
│   ├── changedFilesProvider.ts
│   ├── gitContentProvider.ts # TextDocumentContentProvider for diff URIs
│   └── fileSearchProvider.ts # QuickPick file search
├── commands/
│   ├── scan.ts               # Scan/rescan
│   ├── stage.ts              # Stage/unstage
│   ├── commit.ts             # Commit (single + bulk)
│   ├── push.ts               # Push (single + bulk)
│   ├── aiCommit.ts           # Claude CLI AI commit
│   ├── openClaude.ts         # Open Claude Code terminal
│   ├── favorites.ts          # Toggle favorites
│   ├── fileSearch.ts         # Browse files + switch repo
│   └── terminal.ts           # Open terminal at path
├── services/
│   ├── repoManager.ts        # Central state management
│   ├── fileWatcher.ts        # Per-repo filesystem watcher
│   └── statusBar.ts          # Status bar items
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
```

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API, esbuild
- **Git**: `child_process.execFile` (no shell=true, no gitpython)
- **Webview**: React 19, Vite, react-diff-view
- **No backend server** — everything runs in-process via the VS Code extension host

## Related

- [Diffchestrator Web](../diffchestrator/) — standalone web UI version with Python/FastAPI backend and embedded xterm.js terminals
