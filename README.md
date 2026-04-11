<p align="center">
  <img src="resources/icons/icon-animated.gif" alt="Diffchestrator" width="128" />
</p>

# Diffchestrator — VS Code Extension

> **Built for Claude Code.** Multi-repo Git orchestration designed as a companion to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's CLI for agentic coding. Stage, review, and commit across repos without leaving VS Code, then hand off to Claude for AI-powered commits, code reviews, and multi-repo workflows.

## Why Diffchestrator?

Claude Code works best when you can see what it changed, across every repo it touched. Diffchestrator gives you that visibility: a sidebar tree of all your repos, real-time change tracking, one-click diffs, and direct terminal integration with `claude`. No context switching, no manual `git status` in twelve terminals.

## Diffchestrator vs Multi-Root Workspaces

VS Code's multi-root workspaces let you group repos into a `.code-workspace` file for unified file browsing and search. Diffchestrator takes a different approach:

| | Multi-Root Workspaces | Diffchestrator |
|---|---|---|
| **Setup** | Manually add each repo to a `.code-workspace` file | Auto-discovers all repos under a root directory |
| **View** | File explorer with folders side-by-side | Git-first tree sorted by changes, with branch, ahead/behind, stash counts, and tags |
| **Scale** | Gets unwieldy beyond ~10 repos | Designed for 20–100+ repos with changed-only filter and tag-based filtering |
| **Switching** | Static set of repos | Switch between project groups instantly (`Alt+D, Shift+S`) |
| **Focus** | Navigate and edit code | Orchestrate git operations — stage, commit, push, search, and review across repos |
| **AI** | No built-in integration | Per-repo Claude Code terminals, AI commits, multi-repo Claude sessions |
| **Cross-repo ops** | Manual per-repo git | Bulk commit/push, git grep across repos, branch cleanup, activity log |

They're complementary — you can use Diffchestrator inside a multi-root workspace. A workspace says "here are my repos." Diffchestrator says "here's what changed, where, and lets you act on it."

## Team Orchestration with Claude Code

Diffchestrator shines when multiple Claude Code agents work across repos simultaneously — whether you're running parallel agents on an epic, reviewing a multi-service change, or just keeping tabs on what Claude touched while you were away.

### Parallel Agent Workflows

When you spawn multiple Claude Code sessions (one per repo or per story), Diffchestrator gives you a single pane of glass:

- **Per-repo terminal tracking** — each repo tracks its own Claude, Claudenew, Yolo, Yolonew, and shell terminals independently. The Active Repos view shows which terminals are running where
- **Auto-switch terminal** — clicking a repo in the sidebar or dashboard auto-surfaces that repo's Claude terminal
- **Smart notifications** — get notified when Claude commits or modifies files. Notifications queue while VS Code is unfocused and show a grouped summary on refocus, with "Push" and "Show Terminal" quick actions

### Multi-Repo Claude Sessions

For changes that span multiple repos (e.g., API contract changes across backend + frontend):

- **Open Claude Code** (`Alt+D, L`) — launches `claude -c` to continue the previous session. With multiple repos selected, it launches `claude --add-dir` for each selected repo
- **Claude Review All** — opens Claude with `--add-dir` for every repo with uncommitted changes plus a review prompt. Available from the dashboard header
- **Multi-repo diff webview** — aggregated diffs across selected repos with per-file stage/unstage controls and "Ask Claude" button per diff hunk

### Dashboard as Mission Control

The dashboard (`Alt+D, V`) is designed for orchestration visibility:

- **Session Summary** — every commit since VS Code session start, grouped by repo. Works regardless of where the commit happened (VS Code terminal, external CLI, or a Claude agent running in another window)
- **Activity Log** — cross-repo commit timeline with repo/author filters. See what every agent produced, sorted by time
- **Sync Overview** — at a glance: which repos have changes, which are ahead/behind, which need attention. Bulk pull/push from one place
- **Change Heatmap** — instantly spot which repos are "hot" (active changes) vs stale

### Typical Orchestration Workflow

1. Open Diffchestrator dashboard (`Alt+D, V`)
2. **Fetch All** to see which repos are behind
3. **Pull outdated** to bring everything up to date
4. Spawn Claude Code sessions from the dashboard (per-repo `◇` button) or sidebar
5. Monitor progress via Session Summary and terminal indicators
6. Review changes across repos — click each repo to see its diffs, or use Claude Review All
7. Stage, commit, and push from the dashboard or sidebar
8. Use the Activity Log tab to see the full cross-repo timeline of what was done

### Works with External Agents

Diffchestrator doesn't require Claude to run inside VS Code. The file watcher monitors `.git/` directories for changes regardless of source. If you have Claude Code running in an external terminal, a CI pipeline pushing commits, or a teammate making changes — the dashboard picks it all up via `git log`.

## Features

### Claude Code Integration
- **AI Commit** — runs `claude --permission-mode acceptEdits` in the repo's terminal for real-time output (`Alt+D, C`)
- **Open Claude Code** — launches `claude -c` to continue the previous session, or `claude --add-dir` for multiple selected repos (`Alt+D, L`)
- **Open Claude Code (New Session)** — launches `claude` to start a fresh session (`Alt+D, Alt+L`)
- **Yolo** — opens terminal and runs the `yolo` alias from [claude-sandbox](https://github.com/aeanez/claude-sandbox) (`Alt+D, Y`)
- **Yolonew** — opens terminal and runs the `yolonew` alias from [claude-sandbox](https://github.com/aeanez/claude-sandbox) (`Alt+D, Alt+Y`)
- **Claude Multi-Repo Review** — opens Claude with `--add-dir` for all repos with changes and a review prompt
- **Ask Claude** button per diff hunk in the multi-repo diff webview
- **Per-repo terminal tracking** — each repo tracks its own Claude, Claudenew, Yolo, Yolonew, and shell terminals independently. Switching repos auto-switches the terminal panel to the correct session
- **Terminal icons** — each terminal type has a distinct colored icon: ✨ Claude (yellow), ➕ Claudenew (yellow), 🔥 Yolo (red), ⚡ Yolonew (cyan), 📟 Shell (default). Terminal tabs show only the repo name — icons identify the type
- **Terminal reuse** — `Alt+D, L`, `Alt+D, Alt+L`, `Alt+D, Y`, and `Alt+D, Alt+Y` reuse existing sessions instead of spawning new ones
- **CLI validation** — checks that `claude` and `docker` are installed before launching terminals

### Active Repos & Workspace Switching
- **Active Repos view** — unified sidebar section showing favorites (star icons) + recent repos (MRU, up to 10) with live terminal status indicators
- **Toggle favorites** — star button in Active Repos title bar shows/hides favorites (filled star = visible, empty star = hidden). Hidden favorites that are active/recent remain visible as their non-favorite role
- **Persisted across reloads** — active repos, selection, and current scan root survive VS Code restarts
- **Cycle repos** — `Alt+D, Tab` cycles through all opened repos including favorites, switching the changed files view, terminal, and diff editor in one keystroke
- **Close active repos** — `Alt+D, Q` closes current (and its terminals if auto-terminals is configured), `Alt+D, Shift+Q` picks which to close, `Alt+D, Shift+Tab` closes all
- **Auto-terminals** — configure terminal types to auto-open when switching repos (Shell, Claude, Claudenew, Yolo, Yolonew). Configurable via Dashboard Settings tab checkboxes. Closing a repo also closes its terminals when enabled
- **Terminal indicators** — each repo shows which terminal types are running (Claude, Claudenew, Yolo, Yolonew, Shell) via icon badges
- **Auto-switch terminal** — clicking a repo in Active Repos or Repositories auto-surfaces that repo's terminal (priority: Claude > Claudenew > Yolo > Yolonew > Shell)
- **Cycle terminal** — `Alt+D, J` rotates through all alive terminals for the current repo (Claude → Claudenew → Yolo → Yolonew → Shell)
- **Navigate terminals** — `Alt+D, ↑/↓` moves between terminal tabs across repos, auto-selecting the target repo. For split panes within the same tab, use `Alt+D, J` to cycle between them (VS Code doesn't expose terminal group structure to extensions, so combined navigation is best-effort)
- **Terminal tab sync** — clicking a terminal tab (Claude, Yolo, shell) auto-selects the repo in the sidebar, opens its changed files, and adds it to Active Repos if not already there
- **Auto-add on terminal open** — opening a terminal, Claude Code, or Yolo session for a repo automatically adds it to Active Repos
- **Smart notifications** — notifies when Claude commits or modifies files. Queues notifications when VS Code is unfocused and shows a grouped summary on refocus. Commit notifications offer "Push" and "Show Terminal" actions
- **Workspace snapshots** — save/load named profiles of your root, favorites, and recent repos

### Repository Discovery & Organization
- **Auto-scan** a root directory to discover all git repos (BFS, configurable depth)
- **Switch scan root** — `Alt+D, Shift+S` quick pick dropdown to switch between configured roots; also available as a button in the Repositories title bar
- **Root name in view titles** — Active Repos and Repositories views show the current root name
- **Auto-scan workspace folders** on startup if no roots configured, and when new folders are added
- **Skip directories** like `node_modules`, `.terraform`, `vendor`, `build`, etc. (configurable)
- **Changed-only filter** — toggle to show only repos with uncommitted changes (`Alt+D, D`)
- **Changed repos sort first** in the tree for quick access
- **Progress indication** — shows scanning/refreshing progress in the status bar for large repo counts
- **Repo tags** — tag repos with labels (e.g., `frontend`, `infra`, `shared`), then filter the tree by tag with `Alt+D, I`. Tags appear as `#tag` in repo descriptions
- **Bulk fetch** — fetch all repos at once from the Repositories title bar; distinguishes local-only repos from real failures
- **Bulk pull** — pull all repos that are behind remote with confirmation
- **Auto-fetch on scan** — optionally run `git fetch` during scan for accurate ahead/behind counts

### Sidebar Views (3 sections)
- **Active Repos** — favorites (yellow/blue stars) + recently opened repos with terminal status, active repo highlighted in blue. Pin repos with `Alt+D, E`
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
- **Navigate changed files** — `Alt+D, N` / `Shift+N` or ↑↓ buttons in editor title bar to browse files without staging
- **Auto-advance on stage** — staging a file automatically opens the next pending file's diff, enabling a review-then-stage workflow
- **Works from sidebar and editor title bar** — both stage buttons advance to the next file
- **Auto-close stale diffs** — switching to a repo with no changes closes the previous repo's diff; committing a repo's last change auto-closes the diff tab
- **Auto-refresh diffs** — diff content refreshes after CLI commits (no stale content)
- **Context restore** — switching back to a repo reopens the last file you were viewing (changes take priority over remembered files)
- **Multi-repo diff webview** — aggregated diffs across multiple selected repos with react-diff-view
- Per-file stage/unstage controls in the diff view
- **Inline blame** — GitLens-style current-line blame showing author, date, and commit message (`Alt+D, G` to toggle)

### Git Operations
- **Stage / Unstage** individual files or all files (inline buttons + context menu + editor title bar)
- **Discard changes** — revert a single file, delete an untracked file, or discard all changes with confirmation dialog
- **Commit** with conventional commit prefix picker (feat/fix/chore/refactor/docs/test/ci) (`Alt+D, M`)
- **Amend last commit** (`Alt+D, Shift+M`) — edit the last commit message with pre-filled content
- **Undo last commit** (`Alt+D, Z`) — soft reset keeping changes staged, with confirmation showing the commit message
- **Auto-push after commit** — optionally push immediately after a successful commit
- **Push** with progress notification (`Alt+D, P`)
- **Force push** (`Alt+D, Shift+P`) — uses `--force-with-lease` with modal confirmation
- **Pull** with progress notification (`Alt+D, U`)
- **Pull-before-push reminder** — when push is rejected by remote, offers "Pull" or "Force Push" quick actions
- **Sync All** — fetch all repos, pull those behind, push those ahead — one button in the Dashboard
- **Fetch** — single-repo fetch via right-click context menu, or bulk fetch all from title bar
- **Bulk commit/push** across multiple selected repos
- **Copy repo info** — right-click to copy path, branch, remote URL, or name to clipboard
- **Open remote URL** — right-click to open the repo's GitHub/GitLab page in browser (auto-converts `git@` SSH URLs to HTTPS)
- **Reveal in file explorer** — open the repo folder in your system file manager (`Alt+D, O`)
- **Swap repo** — jump back to the previous repo across roots (`Alt+D, Backspace`)
- **Git detection** — shows error with install link if git isn't available on PATH

### Branch & Stash Management
- **Branch Switcher** (`Alt+D, B`) — QuickPick listing all local branches with current branch marked, plus "Create new branch..." option
- **Branch Cleanup** (`Alt+D, X`) — find merged branches across all repos and delete them in bulk
- **Stash Management** (`Alt+D, A`) — stash push (with message), list stashes, pop latest, apply specific stash, drop stash, view stash diffs. Dashboard shows relative timestamps per stash
- **Commit History** (`Alt+D, H`) — QuickPick showing last 15 commits, select to view full diff in editor
- **Cross-repo Activity Log** — recent commits across ALL repos sorted by date

### Search & Navigation
- **Search in Repo** (`Alt+D, /`) — live git grep QuickPick scoped to the selected repo, opens file at matched line
- **Search Active Repos** (`Alt+D, .`) — git grep across all recent/active repos with `[repo-name]` badges
- **Search All Repos** (`Alt+D, Shift+/`) — git grep across every scanned repo
- Selecting a search result from a different repo auto-switches to it (terminal, changed files, everything)
- **Browse Files** (`Alt+D, F`) — QuickPick with all files in a repo via `git ls-files`, instant filtering
- **Switch Repo** (`Alt+D, R`) — QuickPick sorted by changes, current repo first
- **Switch Repo All Roots** (`Alt+D, Alt+R`) — QuickPick listing ALL repos across all configured scan roots, with cross-root switching
- **Open in New Window** (`Alt+D, W`) — opens the selected repo in a new VS Code window for full native search

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

### Dashboard (`Alt+D, V`)
A full command center with four tabs. Also available from the Repositories title bar. Auto-refreshes every 2 seconds when repos change.

**Dashboard tab** — five sections:
- **Sync Overview** — table with ahead/behind/changes/stashes/health scores, color-coded rows, sortable columns, repo search filter, keyboard navigation. Per-repo actions: pull, push, AI commit, discard, switch branch, commit history, open in browser, copy info, terminal, Claude Code (overflow menu). Pinned repos sort to top. Bulk actions: Fetch All, Pull N outdated, Push N ahead
- **Branch Map** — repos grouped by main vs feature branches, with pills per branch name. Branch Cleanup button to find and delete merged branches
- **Change Heatmap** — tile grid with heat levels (hot/warm/mild/stale/quiet) based on changes + days since last commit
- **Session Summary** — commits since VS Code session start, grouped by repo (works with external CLIs too)
- **Stashes** — per-repo stash list with Apply/Pop actions (shown when repos have stashes)

Header actions: Switch Root, Filter by Tag, Claude Review All, Save/Load Snapshot, Scan, Refresh

**Activity tab** — cross-repo commit timeline sorted by date, grouped by day. Filter by repo or author. Export as markdown (clipboard or file).

**Settings tab** — configure scan roots, depth, skip dirs, display preferences, Claude permission mode, auto-push — all without editing JSON.

**Shortcuts tab** — full keyboard shortcut reference with all `Alt+D` chords.

### Status Bar
- **Left**: repo count + total changes (click to open sidebar)
- **Right**: active repo name + branch + changes with prominent background (click to switch repo)

### Extension API

Diffchestrator exposes a public API for sibling extensions (e.g., Epic Lens):

```typescript
interface DiffchestratorApi {
  getCurrentRoot(): string | undefined;
  getSelectedRepo(): string | undefined;
  onDidChangeSelection: vscode.Event<void>;
}
```

Consume it from another extension:

```typescript
const diffchestrator = vscode.extensions.getExtension("andrevops-com.diffchestrator");
const api = diffchestrator?.exports as DiffchestratorApi;
api?.onDidChangeSelection(() => {
  console.log("Selection changed:", api.getSelectedRepo());
});
```

## Keyboard Shortcuts

All shortcuts use **Alt+D** as a chord prefix — press `Alt+D`, release, then press the key:

| Chord | Action |
|-------|--------|
| `Alt+D, Tab` | Cycle through recent active repos |
| `Alt+D, Shift+Tab` | Close all active repos |
| `Alt+D, Q` | Close current active repo |
| `Alt+D, Shift+Q` | Pick which active repo to close |
| `Alt+D, N` | Next changed file |
| `Alt+D, Shift+N` | Previous changed file |
| `Alt+D, M` | Commit with message (conventional prefix picker) |
| `Alt+D, C` | AI Commit (Claude) |
| `Alt+D, L` | Open Claude Code (continues session) |
| `Alt+D, Alt+L` | Open Claude Code (new session) |
| `Alt+D, Y` | Yolo (Claude Sandbox) |
| `Alt+D, Alt+Y` | Yolonew (Claude Sandbox) |
| `Alt+D, S` | Scan for repositories |
| `Alt+D, Shift+S` | Switch scan root |
| `Alt+D, Shift+T` | Open terminal at scan root |
| `Alt+D, T` | Open terminal at repo |
| `Alt+D, J` | Cycle terminal (rotate through alive terminals) |
| `Alt+D, Alt+K` | Close terminal (active or pick) |
| `Alt+D, ↓` | Next terminal (across all repos) |
| `Alt+D, ↑` | Previous terminal (across all repos) |
| `Alt+D, R` | Switch active repo |
| `Alt+D, Alt+R` | Switch repo (all roots) |
| `Alt+D, F` | Browse files in repo |
| `Alt+D, P` | Push |
| `Alt+D, Shift+P` | Force push (--force-with-lease) |
| `Alt+D, Shift+M` | Amend last commit |
| `Alt+D, U` | Pull |
| `Alt+D, D` | Toggle changed-only filter |
| `Alt+D, H` | Commit history |
| `Alt+D, B` | Switch branch |
| `Alt+D, A` | Stash management |
| `Alt+D, G` | Toggle inline blame |
| `Alt+D, E` | Favorite current repo |
| `Alt+D, /` | Search in repo (git grep) |
| `Alt+D, .` | Search active repos |
| `Alt+D, Shift+/` | Search all repos |
| `Alt+D, W` | Open repo in new VS Code window |
| `Alt+D, K` | Show keyboard shortcut cheatsheet |
| `Alt+D, X` | Clean up merged branches |
| `Alt+D, I` | Filter repos by tag |
| `Alt+D, Z` | Undo last commit (soft reset) |
| `Alt+D, Shift+B` | Save workspace snapshot |
| `Alt+D, Shift+L` | Load workspace snapshot |
| `Alt+D, Backspace` | Swap to previous repo (across roots) |
| `Alt+D, O` | Reveal repo in system file explorer |
| `Alt+D, V` | Open Dashboard |

> On macOS, use `Option+D` as the chord prefix.

## Context Menu Actions

Right-click a **repository** in the tree:

- View Diff / Commit / Push / Pull / Fetch / AI Commit / Undo Commit
- Commit History / Switch Branch / Stash Management
- Browse Files / Open Repo in New Window
- Open Terminal / Open Claude Code / Yolo / Yolonew
- Copy Repo Info / Open Remote in Browser / Set Tags / Reveal in File Explorer
- Toggle Favorite / Select (for multi-repo operations)

Right-click a **directory** in the tree:

- Open Terminal / Open Claude Code / Yolo / Yolonew (launches with cwd set to the directory)
- Reveal in File Explorer
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
| `diffchestrator.autoPushAfterCommit` | `false` | Auto-push after successful commit via `Alt+D, M` |
| `diffchestrator.favorites` | `[]` | Persisted favorite paths (managed by extension) |
| `diffchestrator.repoTags` | `{}` | Repo tags for filtering (managed by extension) |
| `diffchestrator.snapshots` | `{}` | Workspace snapshots (managed by extension) |
| `diffchestrator.pinnedRepos` | `[]` | Pinned repo paths in Dashboard Sync Overview (managed by extension) |
| `diffchestrator.autoTerminals` | `[]` | Terminal types to auto-open on repo switch (`shell`, `claude`, `claudenew`, `yolo`, `yolonew`). Closing a repo also closes its terminals |

## Getting Started

### Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=andrevops-com.diffchestrator), [Open VSX](https://open-vsx.org/extension/andrevops/diffchestrator), or build locally with `make package && make install`.

### First-Time Setup

1. **Add scan roots** — tell Diffchestrator where your repos live. Open VS Code settings (`Ctrl+,`) and add one or more root directories:
   ```json
   {
     "diffchestrator.scanRoots": ["/home/user/projects"]
   }
   ```
   You can add multiple roots (e.g., work projects + personal projects). Switch between them with `Alt+D, Shift+S`.

   > **Tip:** If you skip this step, Diffchestrator auto-detects repos in your open workspace folders.

2. **Scan** — press `Alt+D, S` or open the Diffchestrator sidebar (click the icon in the Activity Bar). Repos populate automatically on startup if `scanOnStartup` is enabled (default: `true`).

3. **Select a repo** — click any repo in the **Repositories** view. The **Changed Files** panel shows its staged/unstaged/untracked files. Click a file to open the native diff editor.

4. **Optional: Enable fetch on scan** — for accurate ahead/behind counts, enable auto-fetch:
   ```json
   {
     "diffchestrator.fetchOnScan": true
   }
   ```
   This runs `git fetch` for each repo during scan. Disable if you have many repos or slow network.

5. **Optional: Configure Claude Code** — if you use Claude Code, the default permission mode for AI commits is `acceptEdits`. Change it in settings:
   ```json
   {
     "diffchestrator.claudePermissionMode": "acceptEdits"
   }
   ```
   Options: `default`, `acceptEdits`, `full`.

6. **Optional: Install claude-sandbox** — the Yolo and Yolonew commands (`Alt+D, Y` / `Alt+D, Alt+Y`) require [claude-sandbox](https://github.com/aeanez/claude-sandbox), which provides Docker-based sandboxed Claude Code sessions. Supported on Linux/WSL and macOS. Install it and source the aliases in your shell to enable these features.

### Quick Tour

| Action | Shortcut |
|--------|----------|
| Scan repos | `Alt+D, S` |
| Switch repo | `Alt+D, R` |
| View changed files + diff | Click a repo |
| AI commit with Claude | `Alt+D, C` |
| Open Claude Code | `Alt+D, L` |
| Commit with message | `Alt+D, M` |
| Push | `Alt+D, P` |
| Open Dashboard | `Alt+D, V` |
| Show all shortcuts | `Alt+D, K` |

## Release

```bash
make release          # Auto-detect bump from conventional commits
make release-patch    # Force patch bump
make release-minor    # Force minor bump
make release-major    # Force major bump
make install          # Install latest .vsix locally
make publish          # Publish to both VS Code Marketplace and Open VSX
make publish-marketplace  # Publish to VS Code Marketplace only
make publish-openvsx      # Publish to Open VSX only
make clean            # Remove build artifacts
```

The release script reads commit messages since the last `v*` tag, picks the semver bump (`feat:` = minor, `fix:` = patch, `BREAKING CHANGE` = major), updates CHANGELOG.md, commits the version bump, tags, builds, and packages two `.vsix` files:
- `diffchestrator-X.Y.Z.vsix` — VS Code Marketplace (publisher: `andrevops-com`)
- `diffchestrator-X.Y.Z-openvsx.vsix` — Open VSX Registry (publisher: `andrevops`)

Pushing a `v*` tag to GitHub triggers CI to create a GitHub Release with both files and auto-publish to Open VSX.

### Verify Release Integrity

Every GitHub Release includes `checksums.txt` (SHA-256) and `checksums.txt.sig` (ED25519 signature), plus [GitHub build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).

```sh
# Verify build provenance
gh attestation verify diffchestrator-*.vsix --repo Andrevops/diffchestrator

# Verify checksum signature
curl -fsSL https://raw.githubusercontent.com/Andrevops/diffchestrator/main/public_key.pem -o public_key.pem
xxd -r -p checksums.txt.sig | openssl pkeyutl -verify -pubin -inkey public_key.pem -rawin -in checksums.txt -sigfile /dev/stdin
```

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
│   ├── diffWebviewPanel.ts   # Multi-repo diff webview
│   └── dashboardWebviewPanel.ts # Dashboard webview (sync, branches, heatmap, session)
└── utils/
    ├── time.ts              # Shared timeAgo / timeAgoShort utilities
    ├── paths.ts             # Path manipulation (basename, dirname)
    ├── shell.ts             # Terminal argument escaping
    ├── fileItem.ts          # File item resolution
    └── disposable.ts        # DisposableStore helper

webview-ui/                   # React apps (diff + dashboard)
├── src/
│   ├── App.tsx               # Diff viewer with react-diff-view
│   ├── vscode.ts             # VS Code API wrapper
│   └── dashboard/            # Dashboard webview
│       ├── DashboardApp.tsx   # Main dashboard with tabs
│       ├── SyncOverview.tsx   # Sync table with actions
│       ├── BranchMap.tsx      # Branch grouping
│       ├── ChangeHeatmap.tsx  # Activity heatmap
│       ├── SessionSummary.tsx # Session commits
│       ├── StashOverview.tsx  # Stash management
│       ├── ActivityLog.tsx    # Activity tab with filters
│       ├── SettingsPanel.tsx  # Settings tab
│       └── ShortcutRef.tsx    # Shortcuts tab
├── vite.config.ts             # Builds diff webview → dist/webview/
└── vite.dashboard.config.ts   # Builds dashboard → dist/webview-dashboard/

scripts/
└── release.mjs               # Auto-detect semver bump + changelog + commit + tag + dual build (Marketplace + Open VSX)
```

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API, esbuild
- **Git**: `child_process.execFile` (no shell=true)
- **Webview**: React 19, Vite, react-diff-view
- **AI**: Claude Code CLI integration
- **CI/CD**: GitHub Actions with ED25519 release signing and build provenance attestation
- **No backend server** — everything runs in-process via the VS Code extension host

## Andrevops Ecosystem

Diffchestrator is the hub of the [Andrevops](https://github.com/Andrevops) tool suite. It exposes a public API that sibling extensions consume, and integrates directly with the CLI tools.

```
                 ┌──────────────────┐
                 │  Diffchestrator  │
                 │   (public API)   │
                 └──┬──────┬─────┬──┘
        consumes    │      │     │   yolo / yolonew
       ┌────────────┘      │     └──────────┐
       ▼                   ▼                 ▼
┌────────────┐     ┌─────────────┐   ┌────────────────┐
│  Makestro  │     │  Epic-Lens  │   │ claude-sandbox │
│ (Makefile  │     │ (Jira/MR    │   │ (sandboxed     │
│  runner)   │     │  tracking)  │   │  Claude Code)  │
└────────────┘     └─────────────┘   └───────┬────────┘
                                        sessions
                                             ▼
                                     ┌──────────────┐
                                     │ claude-stats  │
                                     │ (analytics)   │
                                     └──────────────┘
```

| Tool | Integration | How |
|------|-------------|-----|
| [Makestro](https://github.com/Andrevops/Makestro) | Consumes `DiffchestratorApi` | Auto-discovers Makefiles from the selected repo — no config needed |
| [Epic-Lens](https://github.com/Andrevops/Epic-Lens) | Consumes `DiffchestratorApi` | Filters Jira epics and MRs by the currently selected repo |
| [claude-sandbox](https://github.com/Andrevops/claude-sandbox) | `yolo` / `yolonew` commands | Launches sandboxed Claude Code sessions per-repo via `Alt+D, Y` (Linux/WSL and macOS) |
| [claude-stats](https://github.com/Andrevops/claude-stats) | Complementary | Analyzes session data generated by Claude Code / claude-sandbox workflows |

### Public API

Diffchestrator exports an API that any VS Code extension can consume:

```typescript
interface DiffchestratorApi {
  getCurrentRoot(): string | undefined;
  getSelectedRepo(): string | undefined;
  onDidChangeSelection: vscode.Event<void>;
}
```

## Collaboration

### [@giankpetrov](https://github.com/giankpetrov)

Hardened the codebase with security-focused tests and performance improvements. Added path traversal prevention tests for GitExecutor, git ref validation tests that caught a `stash@{N}` bug, and improved DisposableStore error resilience. Also optimized `switchRepo` sorting from O(N^2) to O(1) lookups — ~590x faster on large repo sets.
