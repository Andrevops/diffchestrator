# Diffchestrator — Claude Code Instructions

VS Code extension for multi-repo Git orchestration. Publisher: `andrevops-com` (Marketplace) / `andrevops` (Open VSX).

## Build Commands

```bash
make build              # Full build (webview + dashboard + extension)
make compile            # Extension only (fast, for dev)
make package            # Build + package .vsix
make install            # Install the Marketplace .vsix for the package.json version
make typecheck          # tsc (extension + webview-ui)
make lint               # ESLint
make test               # Unit tests
make clean              # Remove build artifacts
```

Webviews only (diff + dashboard + search, one multi-entry Vite build):
```bash
cd webview-ui && npm run build
```

## Release Workflow

```bash
make release            # Auto-detect bump from conventional commits, verify, package, commit + tag
make release-patch      # Force patch bump
make release-minor      # Force minor bump
make release-major      # Force major bump
git push --atomic origin main vX.Y.Z   # Triggers the release workflow
```

The release script: preflight (clean tree, on main, in sync with origin, tag absent) → bump package.json/lock + CHANGELOG.md → typecheck, test, build, package both `.vsix` (Marketplace + Open VSX) → commit + tag last. Files are restored on failure. Pure logic lives in `scripts/releaseLib.mjs` (tested).

CI: `.github/workflows/ci.yml` runs on PRs and pushes to main. `.github/workflows/publish.yml` runs on `v*` tags in two jobs. The read-only build job builds and packages. The publish job runs in the `release` environment and signs, attests, creates the GitHub Release, and publishes the CI-built `.vsix` to Open VSX, and to the Marketplace when `VSCE_PAT` is set. Release notes come from CHANGELOG.md. All actions are SHA-pinned (Dependabot keeps them current).

## Publishing

Normally CI publishes. These are manual fallbacks, and they pick the `.vsix` matching the package.json version:

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
- `src/views/searchWebviewPanel.ts` — full-text search panel for the selected repo
- `src/commands/` — command handlers (one file per feature)
- `src/providers/` — tree data providers for sidebar views
- `webview-ui/src/dashboard/` — React dashboard
- `webview-ui/src/search/` — React search panel
- `webview-ui/src/App.tsx` — React diff viewer (Vite build → `dist/webview/`)

## Conventions

- **Commands**: add to `CMD` in constants.ts → register in extension.ts → declare in package.json `contributes.commands`
- **Config**: add to `CONFIG` in constants.ts → declare in package.json `contributes.configuration`
- **Keybindings**: `Alt+D` chord prefix for all shortcuts
- **Commit messages**: conventional commits (`feat:`, `fix:`, `perf:`, `chore:`, `docs:`, `ci:`)
- **Git executor**: use `repoManager.git` (shared singleton), never `new GitExecutor()`
- **Dashboard messages**: extension ↔ webview via `postMessage`/`onDidReceiveMessage`
- **No external dependencies**: extension uses only VS Code API + Node built-ins
- **Terminal icons**: use `terminalIcon(kind)` from `commands/terminal.ts` for all `createTerminal` calls — terminal names are bare repo names (no prefixes), icons distinguish type
- **Terminal tracking**: icon-only terminals rely on the `repoTerminals` map, not name patterns. `buildPatterns` only matches legacy prefixed names for backward compat

## Testing

```bash
npm test            # Node.js native test runner: src/**/*.test.ts + scripts/**/*.test.mjs
npm run typecheck   # tsc for extension + webview-ui (esbuild does not typecheck)
npm run lint        # ESLint, high-signal rules, warn-only (errors fail CI)
```

Tests live next to the code they cover anywhere under `src/` (git/, services/, commands/, utils/, …). The `vscode` module is stubbed via `src/test-setup/`. `@types/vscode` is pinned to `engines.vscode` (~1.95). Don't use newer APIs without raising both.

## Dashboard Architecture

Two-phase data fetching:
1. **Phase 1 (instant)**: Sync Overview + Branch Map from cached `repoManager.allRepos` — no git calls
2. **Phase 2 (batched)**: Heatmap + Session Summary + Activity — git calls batched at 10 concurrent

4 tabs: Dashboard | Activity | Settings | Shortcuts

Message protocol: webview sends `{ type, ...payload }`, panel handles in `_handleMessage` switch/case.

## Important Notes

- `make install` installs `diffchestrator-<package.json version>.vsix` (Marketplace build only)
- Diff, dashboard, and search webviews are entries of one Vite build (`webview-ui/vite.config.ts`) → `dist/webview/` with a shared `vendor.js` React chunk; panels render HTML from `manifest.json` via `src/views/webviewHtml.ts` (nonce'd module scripts, no inline styles)
- `RepoTreeProvider` implements `Disposable` — must be pushed to `context.subscriptions`
- GitExecutor has metadata cache (30s TTL) for `getRemoteUrl`, `stashCount`, `lastCommitDate`
- Health scores computed in Phase 1: `100 - changesPenalty - syncPenalty - stashPenalty`
