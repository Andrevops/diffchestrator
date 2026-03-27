# Changelog

All notable changes to Diffchestrator are documented here. Generated from conventional commits.

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
