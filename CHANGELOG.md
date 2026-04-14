# Changelog

All notable changes to Diffchestrator are documented here. Generated from conventional commits.

## 0.73.1

### Bug Fixes
- Fall back to statSync when Dirent reports unknown type on 9p/drvfs

## 0.73.0

### Features
- Claude continue fallback + claudenew terminal kind for fresh sessions
- Sync VS Code workspace with selected repository
- Sync VS Code workspace with selected repository

### Bug Fixes
- Detect .git on 9p/drvfs mounts where statSync reports wrong type
- Use user's default shell for alias detection (fixes yolo on macOS/zsh)
- Atomic workspace folder swap to prevent double extension host reload
- Use additive workspace folder sync to prevent extension host reloads

### Other
- Add collaboration section and fix stale Claudenew references in README
- Document macOS support for claude-sandbox integration
- Remove syncWorkspace feature (causes unavoidable extension host reloads)
- Add collaboration section crediting @giankpetrov contributions

## 0.72.2

### Other
- Document macOS support for claude-sandbox integration

## 0.72.1

### Bug Fixes
- Use user's default shell for alias detection (fixes yolo on macOS/zsh)

## 0.72.0

### Features
- Claude continue fallback + claudenew terminal kind for fresh sessions

## 0.71.3

### Other
- Remove syncWorkspace feature (causes unavoidable extension host reloads)

## 0.71.2

### Bug Fixes
- Atomic workspace folder swap to prevent double extension host reload

## 0.71.1

### Bug Fixes
- Use additive workspace folder sync to prevent extension host reloads

## 0.71.0

### Features
- Sync VS Code workspace with selected repository
- Sync VS Code workspace with selected repository

### Other
- Add collaboration section crediting @giankpetrov contributions

## 0.70.2

### Other
- Add Andrevops ecosystem section with integration map

## 0.70.1

### Bug Fixes
- Ensure Alt+D chord shortcuts work when terminal is focused

## 0.70.0

### Features
- Animate individual SVG elements — cascading node pulses, breathing branches

### Bug Fixes
- Restore terminal focus after repo switch and match terminal kind across repos
- Regenerate animated icon with transparent background

### Other
- Add animated icon to README header

## 0.69.2

### Bug Fixes
- Rebind cross-root repo search from Alt+D Alt+F to Alt+D Alt+R

## 0.69.1

### Bug Fixes
- Register directory entries when opening terminals from non-repo directories

## 0.69.0

### Features
- Add directory entries to Active Repos with full terminal lifecycle

## 0.68.6

### Bug Fixes
- Prevent sidebar focus steal when switching repos from other extension tabs
- Prevent sidebar focus steal when switching repos from other extension tabs

## 0.68.4

### Other
- Add claude-sandbox repo links for yolo/yolonew setup

## 0.68.3

### Bug Fixes
- Skip auto-terminal when repo already has any terminals open

### Other
- Document cross-root search, auto-terminals, force push, amend, sync all, stash drop

## 0.68.2

### Bug Fixes
- Check untracked terminals before auto-opening new ones

## 0.68.1

### Bug Fixes
- Skip auto-terminal open when terminal already exists for repo

## 0.68.0

### Features
- Add autoTerminals setting with dashboard checkboxes
- Add cross-root repo search (Alt+D, Alt+F) spanning all configured roots

## 0.67.2

### Bug Fixes
- Switch scan root when navigating to terminal in different root

## 0.67.1

### Bug Fixes
- Prevent findRepoForTerminal from overwriting occupied tracking slots

## 0.67.0

### Features
- Offer pull or force-push when push is rejected by remote
- Add Sync All command — fetch, pull behind, push ahead in one action
- Add commit amend command (Alt+D, Shift+M) with message pre-fill
- Add force push command (Alt+D, Shift+P) with --force-with-lease
- Add stash drop — QuickPick + dashboard Drop button

## 0.66.5

### Bug Fixes
- Suppress entire terminal change handler during navigate/cycle commands

## 0.66.4

### Bug Fixes
- Suppress terminal auto-switch during cycle and navigate commands

## 0.66.3

### Bug Fixes
- Don't override terminal choice when user clicks a terminal tab

## 0.66.2

### Bug Fixes
- Adopt icon-only terminals on demand in getAlive fallback

## 0.66.1

### Bug Fixes
- Adopt existing terminals on activation via icon-based kind inference

## 0.66.0

### Features
- Add stash timestamps and branch count to dashboard
- Detect and display merge/rebase/cherry-pick state in tree views

### Performance
- Deduplicate dashboard git calls, add concurrency limiter, extract resolveRepoPath

## 0.65.2

### Other
- Document terminal icons, management shortcuts, and tracking conventions

## 0.65.1

### Bug Fixes
- Prevent cross-type terminal collisions with icon-only names

## 0.65.0

### Features
- Remove terminal name prefixes — icons now identify type

## 0.64.0

### Features
- Add distinct icons per terminal type (sparkle/flame/zap/terminal)

### Bug Fixes
- Remove dangling issue reference

### Other
- Document split terminal navigation limitation

## 0.63.9

### Bug Fixes
- Cache group edge terminals to eliminate flicker on wrap-around

## 0.63.8

### Bug Fixes
- Track visited panes to correctly detect group wrap-around

## 0.63.7

### Bug Fixes
- Use event-based terminal change detection for reliable split navigation

## 0.63.6

### Bug Fixes
- Traverse split panes within groups before moving to next group

## 0.63.5

### Bug Fixes
- Navigate all terminals including split panes via terminal.show()

## 0.63.4

### Bug Fixes
- Use VS Code native terminal navigation for correct split/group order

## 0.63.3

### Bug Fixes
- Navigate all terminals not just tracked ones

## 0.63.2

### Bug Fixes
- Match terminal navigation order to VS Code panel order

## 0.63.1

### Bug Fixes
- Adopt untracked terminals before cross-repo navigation

## 0.63.0

### Features
- Add cross-repo terminal navigation (Alt+D, ↑/↓)

## 0.62.1

### Bug Fixes
- Rebind close terminal to Alt+D, Alt+K

## 0.62.0

### Features
- Add close terminal command (Alt+D, Alt+J)

## 0.61.0

### Features
- Add cycle terminal command (Alt+D, J)

### Other
- Add release signing verification instructions to README

## 0.60.0

### Features
- Add ED25519 release signing and build provenance attestation

## 0.59.1

### Bug Fixes
- Use interactive shell for yolo alias detection

## 0.59.0

### Features
- Show claude-sandbox setup link when yolo alias is missing

## 0.58.0

### Features
- Add yolonew command with Alt+D, Alt+Y shortcut

### Other
- Add yolonew to README shortcuts, features, and context menus
- Add tests for git ref validation edge cases

## 0.57.0

### Features
- Add yolonew command with Alt+D, Alt+Y shortcut

## 0.56.12

### Bug Fixes
- Validate terminal tracking map results against current root before trusting

## 0.56.11

### Bug Fixes
- Use BFS scanner for cross-root terminal matching instead of shallow readdirSync

## 0.56.10

### Bug Fixes
- Use directory-name inclusion for cross-root terminal matching, await viewDiff

## 0.56.9

### Bug Fixes
- Probe scanRoots for cross-root terminal matching instead of requiring prior scan

## 0.56.8

### Bug Fixes
- Switch root when terminal focus moves to a repo in another scan root

## 0.56.7

### Bug Fixes
- Guard status cache against stale in-flight writes

### Other
- Remove status bar items, surface summary in sidebar

## 0.56.6

### Other
- Fix dashboard tab count, add stashes/settings/pinned docs, update architecture tree

## 0.56.5

### Bug Fixes
- Bump CI Node.js to 22 for --experimental-strip-types test support

## 0.56.4

### Other
- Type-safe webview messages, eliminate as-any casts, remove dead types, add CI tests, tab URI helper

## 0.56.3

### Bug Fixes
- Activate() returns stub API when git missing, add git timeout, fix require imports, hoist regex, catch startup errors

## 0.56.2

### Other
- Fix enum compatibility, add stash validation, flag injection, and cache tests (42 pass)

## 0.56.1

### Bug Fixes
- Security hardening — repoPath validation, stash index validation, cache TTL cleanup, update concurrency guard

## 0.56.0

### Features
- Stash overview, diff stat preview, and diffStatSummary/fileCount git methods

### Other
- Add make release and publish targets to CLAUDE.md
- Add CLAUDE.md with project instructions for Claude Code sessions

## 0.55.1

### Performance
- Optimize repository sorting in switchRepo command

## 0.55.0

### Features
- Pinned repos, health scores, activity export, settings tab, onboarding wizard

## 0.54.2

### Performance
- Deep optimization — metadata caching, combined git calls, memory leak fix, batch size increase, debounce guards

## 0.54.1

### Other
- Add Team Orchestration with Claude Code section

## 0.54.0

### Features
- Dashboard UX overhaul — search, overflow menus, status dots, collapsible sections, keyboard nav, activity filters, skeleton loading, header toolbar

## 0.53.1

### Other
- Update dashboard documentation with full command center features

## 0.53.0

### Features
- Full command center — switch root, tags, review, snapshots, branch switch, discard, history, remote URL, copy info

## 0.52.0

### Features
- Dashboard command center — scan, bulk push, branch cleanup, stash column, activity log tab

## 0.51.2

### Other
- Move shortcuts to separate tab in dashboard

## 0.51.1

### Bug Fixes
- Use 'where' instead of 'which' for CLI detection on Windows

## 0.51.0

### Features
- Dashboard action buttons (push, fetch, claude, terminal) and keyboard shortcut reference

## 0.50.1

### Other
- Rewrite Getting Started with first-time setup guide, update dashboard docs

## 0.50.0

### Features
- Pull outdated repos from dashboard — bulk and per-repo buttons

## 0.49.1

### Bug Fixes
- Heatmap uses class-based heat levels instead of inline opacity for readability
- Dashboard openRepo switches terminal to selected repo
- Dashboard openRepo only selects repo instead of opening diff, prevents tab closure

### Other
- Remove tracked tsbuildinfo file
- Gitignore tsbuildinfo files

## 0.49.0

### Features
- Add dashboard webview with sync overview, branch map, heatmap, and session summary

## 0.48.7

### Bug Fixes
- Only validate docker and claude for yolo — yolo itself is a shell alias

## 0.48.6

### Other
- Add Diffchestrator vs Multi-Root Workspaces comparison

## 0.48.5

### Bug Fixes
- Capitalize changelog entries in release script and CI workflow

## 0.48.4

### Bug Fixes
- validate yolo command exists before launching, show install link

### Other
- add extension API section, fix Ctrl+D references, update architecture tree

## 0.48.3

### Other
- update README and CHANGELOG for v0.46–0.48, fix make install to exclude openvsx builds

## 0.48.2

### Other
- enable auto-publish to Open VSX on tag push

## 0.48.1

### Other
- dual-publish to VS Code Marketplace and Open VSX

## 0.48.0

### Features
- dual-publish to VS Code Marketplace and Open VSX (release script + CI workflow)

## 0.47.0

### Features
- reveal repo in system file explorer with Alt+D, O

## 0.46.0

### Features
- expose public API for sibling extensions (getCurrentRoot, getSelectedRepo, onDidChangeSelection)

## 0.45.4

### Bug Fixes
- set swap target in scan() before clearing selection

## 0.45.3

### Bug Fixes
- make swap command explicitly sequential — root, repo, terminal, diff

## 0.45.2

### Bug Fixes
- force UI refresh after swap to update Active Repos view

## 0.45.1

### Bug Fixes
- swap repo now toggles correctly between two positions across roots

## 0.45.0

### Features
- swap to previous repo across roots with Alt+D, Backspace

## 0.44.1

### Bug Fixes
- invalidate status cache on every refresh to keep badge and file list fresh

## 0.44.0

### Features
- persist selection per root when switching scan roots

## 0.43.1

### Bug Fixes
- clear multi-selection when switching scan roots

## 0.43.0

### Features
- yolo command sends all selected repo paths in multi-select mode

### Other
- add comprehensive coverage and error handling for DisposableStore
- expand coverage for dirname utility
- 🧪 Add edge case tests for timeAgo
- add edge case tests for timeAgoShort function

## 0.42.7

### Bug Fixes
- restore selectedRepoPaths getter removed by PR #20, delete stray benchmark.ts
- invalidate status cache after stage/unstage/commit
- remove -- from git show that broke diff view

### Other
- add logging to changedFilesProvider diff URIs
- add logging to git content provider for diff investigation
- remove unused selectedRepoPaths method
- Add more comprehensive tests for dirname function
- Remove unused diffUntracked method from GitExecutor
- add tests for DisposableStore
- Add test for timeAgo function

## 0.42.6

### Bug Fixes
- invalidate status cache after stage/unstage/commit

## 0.42.5

### Bug Fixes
- remove -- from git show that broke diff view

## 0.42.4

### Other
- add logging to changedFilesProvider diff URIs

## 0.42.3

### Other
- add logging to git content provider for diff investigation

## 0.42.2

### Bug Fixes
- show proper diff for unstaged files instead of all-green

## 0.42.1

### Bug Fixes
- show all untracked files instead of collapsing directories

## 0.42.0

### Features
- change keyboard chord prefix from Ctrl+D to Alt+D

## 0.41.0

### Features
- optimize bulk commit with Promise.all batched concurrency

### Bug Fixes
- smart push on notifications, select/deselect all active repos

### Performance
- Batch close tabs in repo refresh and selection to improve performance

### Other
- add test for timeAgoShort in src/utils/time.ts
- validate git refs, harden branch commands, cache hot paths
- ⚡ Optimize _getTerminalKinds with lazy caching
- update README with undo commit, single fetch, snapshot shortcuts, git detection

## 0.40.1

### Other
- validate git refs, harden branch commands, cache hot paths
- update README with undo commit, single fetch, snapshot shortcuts, git detection

## 0.40.0

### Features
- git detection, undo commit, single fetch, snapshot shortcuts, contributing guide

### Other
- exclude pnpm-lock, .jules, and test dirs from vsix

## 0.39.2

### Performance
- optimize active repos resolution in file watcher and repo manager

### Other
- 🧪 Add test for resolveFileItem
- Optimize allMatches array construction in file search
- 🧪 test(paths): add edge cases for basename function
- ⚡ perf: optimize active repos resolution in file watcher
- 🛡️ Sentinel: [CRITICAL] Fix terminal command injection
- ⚡ Optimize bulkCommit to process repositories concurrently
- add unit tests for paths utility
- comprehensive README update with all v0.39 features

## 0.39.1

### Bug Fixes
- clone snapshots config before mutating on delete

## 0.39.0

### Features
- show tag indicators on repos and active filter in view title

## 0.38.0

### Features
- add Ctrl+D shortcuts for branch cleanup and tag filter

## 0.37.0

### Features
- add Ctrl+D, K shortcut for keyboard cheatsheet

## 0.36.0

### Features
- 8 new features — auto-push, copy info, shortcuts, activity log, and more

### Other
- remove toast test file
- verify commit toast actions

## 0.35.1

### Bug Fixes
- remove "View Changes" from commit notifications

## 0.35.0

### Features
- open terminal at scan root path

## 0.34.0

### Features
- persist current root across reloads

## 0.33.0

### Features
- show current root name in Active Repos view description

## 0.32.0

### Features
- show current root name in Repositories view description

### Other
- remove diff test file
- diff auto-close
- add file for diff refresh test

## 0.31.4

### Bug Fixes
- auto-close stale diff tabs when repo becomes clean after commit

### Other
- verify diff refresh after CLI commit
- add diff refresh test file

## 0.31.3

### Bug Fixes
- refresh stale diff viewer after CLI commits

## 0.31.2

### Bug Fixes
- distinguish local-only repos from real fetch failures

## 0.31.1

### Bug Fixes
- log fetch/pull errors per repo with Show Log action

## 0.31.0

### Features
- 8 new features — fetch all, commit prefixes, health badges, and more

### Other
- remove unused clearSelectedRepo method

## 0.30.0

### Features
- queue notifications when unfocused, show grouped summary on refocus

## 0.29.3

### Bug Fixes
- clear selected repo when switching scan roots

## 0.29.2

### Bug Fixes
- handle non-string argument in switchRoot command

## 0.29.1

### Other
- cleanup dead code, update docs, auto-changelog, commit shortcut

## 0.29.0

### Features
- Allow launching CLIs (Terminal, Claude Code, Yolo) from directory nodes in the Repositories tree

## 0.28.0

### Features
- Dynamic star icon for favorites toggle (filled when visible, empty when hidden)

## 0.27.0

### Features
- Toggle favorites visibility in Active Repos via star button in title bar

## 0.26.0 — 0.26.4

### Features
- Simplify sidebar from 5 sections to 3 (merge Favorites into Active Repos, move Scan Roots to dropdown)
- Add `Ctrl+D, Shift+S` shortcut for quick scan root switching

### Bug Fixes
- Prevent MRU re-sort during repo cycling (fixes cycle bouncing between 2 repos)
- Cycle through all opened repos including favorites
- Fix missing path import causing cycle command error

## 0.25.0

### Features
- Add Scan Roots sidebar view for quick root switching

## 0.24.0 — 0.24.2

### Performance
- Singleton GitExecutor — replace 11 instances with shared `repoManager.git`
- Request deduplication — concurrent `status()` calls share one Promise
- Replace `**/*` file watcher with `.git`-specific `fs.watch` (~95% less noise)
- Event coalescing — batch rapid repo-change events into one tick
- Auto-suppress file watcher after explicit `refreshRepo()` to avoid double refresh
- Status bar debounce (150ms) to consolidate rapid updates
- Add `withProgress` to scan and `refreshAll` for large repo counts
- Increase status cache TTL from 500ms to 1000ms
- Cap `lastOpenFile` Map at 20 entries with LRU eviction
- Add activation events to defer extension load until sidebar is opened

### Other
- Singleton output channel — create once on activation, reuse in commit/push/pull
- Replace AI commit blind `setTimeout` with `fs.watch` on `.git` directory
- Add logging to silent catch blocks
- Extract shared `timeAgo`/`timeAgoShort` utility
- Move tooltip refresh from repo changes to user selection only
- Make `workspaceAutoScan._containsGitRepo` fully async

## 0.23.0 — 0.23.4

### Features
- Validate CLI dependencies (claude, docker) before launching terminals
- Filter active repos and terminals by scan root
- Filter favorites by active scan root

### Bug Fixes
- Prevent favoriting repos outside current scan root
- Fetch full git history for changelog generation
- Allow toggling favorites from favorites view
- Include sidebar icon in vsix package

## 0.22.0

### Features
- Filter favorites by active scan root

## 0.21.0

### Features
- Discard untracked files via `git clean -f`
- Show discard button on untracked files in changed files view
- Add Makefile for build, package, release, and install shortcuts

## 0.20.7 and earlier

### Features
- Initial release with multi-repo Git orchestration
- Claude Code integration (AI Commit, Open Claude Code, Yolo)
- Active Repos with terminal tracking and MRU cycling
- Repository discovery with BFS scanning
- Diff viewing with native VS Code diff editor and auto-advance
- Git operations (stage, unstage, commit, push, pull, discard)
- Branch and stash management
- Search across repos with git grep
- Inline blame annotations
- File watcher with auto-refresh
- Status bar with repo summary
- Multi-repo diff webview with react-diff-view

### CI/CD
- GitHub Actions workflow for building and releasing
- Grouped changelog generation for GitHub Releases
- Marketplace publishing preparation (icon, keywords, badges, LICENSE)
