# Diffchestrator — Claude Code Instructions

VS Code extension for multi-repo Git orchestration. Publisher: `andrevops-com` (Marketplace) / `andrevops` (Open VSX).

## Build Commands

```bash
make build              # Full build (webview + dashboard + extension)
make compile            # Extension only (fast, for dev)
make package            # Build + package .vsix
make install            # Install latest Marketplace .vsix locally
make clean              # Remove build artifacts
```

Dashboard webview only:
```bash
cd webview-ui && npm run build:dashboard
```

## Release Workflow

```bash
make release            # Auto-detect bump from conventional commits, build, package
make release-patch      # Force patch bump
make release-minor      # Force minor bump
make release-major      # Force major bump
git push && git push --tags    # Triggers CI (GitHub Actions)
```

The release script: bumps version, updates CHANGELOG.md, commits, tags, builds two `.vsix` files (Marketplace + Open VSX). CI creates GitHub Release and auto-publishes to Open VSX.

## Publishing

```bash
make publish            # Publish to both VS Code Marketplace and Open VSX
make publish-marketplace  # Marketplace only
make publish-openvsx      # Open VSX only
```

## Project Structure

- `src/extension.ts` — activation entrypoint, all command registrations
- `src/constants.ts` — `CMD`, `CONFIG`, `CTX` constants. ALL new commands/config MUST go here
- `src/types.ts` — shared TypeScript interfaces
- `src/git/gitExecutor.ts` — git CLI wrapper with caching and deduplication
- `src/git/scanner.ts` — BFS directory scanner
- `src/services/repoManager.ts` — central state, MRU, events, refresh logic
- `src/views/dashboardWebviewPanel.ts` — dashboard webview with message protocol
- `src/views/diffWebviewPanel.ts` — multi-repo diff webview
- `src/commands/` — command handlers (one file per feature)
- `src/providers/` — tree data providers for sidebar views
- `webview-ui/src/dashboard/` — React dashboard (separate Vite build → `dist/webview-dashboard/`)
- `webview-ui/src/App.tsx` — React diff viewer (Vite build → `dist/webview/`)

## Conventions

- **Commands**: add to `CMD` in constants.ts → register in extension.ts → declare in package.json `contributes.commands`
- **Config**: add to `CONFIG` in constants.ts → declare in package.json `contributes.configuration`
- **Keybindings**: `Alt+D` chord prefix for all shortcuts
- **Commit messages**: conventional commits (`feat:`, `fix:`, `perf:`, `chore:`, `docs:`, `ci:`)
- **Git executor**: use `repoManager.git` (shared singleton), never `new GitExecutor()`
- **Dashboard messages**: extension ↔ webview via `postMessage`/`onDidReceiveMessage`
- **No external dependencies**: extension uses only VS Code API + Node built-ins

## Testing

```bash
npm test    # Node.js native test runner (*.test.ts in src/utils/)
```

## Dashboard Architecture

Two-phase data fetching:
1. **Phase 1 (instant)**: Sync Overview + Branch Map from cached `repoManager.allRepos` — no git calls
2. **Phase 2 (batched)**: Heatmap + Session Summary + Activity — git calls batched at 10 concurrent

4 tabs: Dashboard | Activity | Settings | Shortcuts

Message protocol: webview sends `{ type, ...payload }`, panel handles in `_handleMessage` switch/case.

## Important Notes

- `make install` excludes `*-openvsx.vsix` files (installs Marketplace build only)
- Dashboard and diff webview are separate Vite builds with separate configs
- `RepoTreeProvider` implements `Disposable` — must be pushed to `context.subscriptions`
- GitExecutor has metadata cache (30s TTL) for `getRemoteUrl`, `stashCount`, `lastCommitDate`
- Health scores computed in Phase 1: `100 - changesPenalty - syncPenalty - stashPenalty`
