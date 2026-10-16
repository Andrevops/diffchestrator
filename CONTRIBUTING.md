# Contributing to Diffchestrator

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Andrevops/diffchestrator.git
cd diffchestrator

# Use the Node version from .nvmrc (CI uses the same file)
nvm use

# Install dependencies
npm ci
npm ci --prefix webview-ui

# Build
make build        # Full build (extension + webviews)
make compile      # Extension only (fast)
make watch        # Watch mode for development

# Debug
# Press F5 in VS Code to launch Extension Development Host
```

## Project Structure

- `src/` — Extension source (TypeScript, esbuild bundled)
- `src/commands/` — Command handlers (one file per feature area)
- `src/providers/` — Tree data providers for sidebar views
- `src/services/` — Core services (repo manager, file watcher, status bar)
- `src/git/` — Git CLI wrapper and directory scanner
- `src/utils/` — Shared utilities (time, paths, shell escaping, disposables)
- `src/views/` — Webview panels: multi-repo diff, dashboard, and search
- `src/test-setup/` — `vscode` module stub used by unit tests
- `webview-ui/` — React webviews, three separate Vite builds:
  - `src/App.tsx` — multi-repo diff view (react-diff-view) → `dist/webview/`
  - `src/dashboard/` — dashboard → `dist/webview-dashboard/`
  - `src/search/` — full-text search panel → `dist/webview-search/`
- `scripts/` — Release automation (`release.mjs`, `releaseLib.mjs`, Open VSX packaging, release notes)

## Conventions

### Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
perf: performance improvement
chore: maintenance / housekeeping
docs: documentation only
test: adding or updating tests
ci: CI/CD changes
refactor: code change that neither fixes nor adds
```

The release script auto-detects the bump type from commit subjects and bodies:
- `feat:` = minor bump
- `fix:` / `perf:` / anything else = patch bump
- `type!:` / `type(scope)!:` or a `BREAKING CHANGE:` footer = major bump

### Code Style

- TypeScript `strict`. esbuild only strips types, so run `npm run typecheck` (CI does too)
- `npm run lint`: ESLint with a small high-signal rule set (floating/misused promises, unused vars). The rules are warn-only for now, and only errors fail CI
- `@types/vscode` is pinned to match `engines.vscode`. Don't use newer VS Code APIs without raising both
- Use `repoManager.git` (shared singleton) instead of `new GitExecutor()`
- All commands registered via `CMD` constants in `src/constants.ts`
- All config keys via `CONFIG` constants
- Error handling: always show user-facing messages via `vscode.window.show*Message`

### Commands

When adding a new command:

1. Add the command ID to `CMD` in `src/constants.ts`
2. Register the handler in `src/extension.ts` or a command module
3. Declare the command in `package.json` under `contributes.commands`
4. Add menu entries if needed under `contributes.menus`
5. Add a keybinding if appropriate (use `Alt+D` chord prefix)

### Testing

We use the Node.js native test runner:

```bash
npm test
```

Tests are co-located with the code they cover. The runner picks up `src/**/*.test.ts` (any folder under `src/`, e.g. `src/git/`, `src/services/`, `src/commands/`, `src/utils/`) and `scripts/**/*.test.mjs`. The `vscode` module is stubbed by `src/test-setup/`. Focus on logic that doesn't need a running VS Code.

## Pull Requests

1. Fork the repo and create a feature branch
2. Make your changes with conventional commit messages
3. Run `npm run typecheck`, `npm test`, `npm run lint`, and `make build`
4. Submit a PR with a clear description of what changed and why

CI (`.github/workflows/ci.yml`) runs the same checks plus packaging on every PR and push to `main`.

## Release Process

Maintainers run, from a clean `main` that is in sync with `origin/main`:

```bash
make release                          # preflight → bump → typecheck/test/build/package → commit + tag
git push --atomic origin main vX.Y.Z  # triggers the release workflow
```

If any check fails, `release.mjs` restores `package.json`, `package-lock.json`, and `CHANGELOG.md`, and nothing is committed or tagged.

The release workflow (`.github/workflows/publish.yml`) has two jobs:

- **build** (read-only token, no secrets): checks that the tag equals the `package.json` version, then runs typecheck and tests and builds both `.vsix` files (Marketplace + Open VSX), checksums, and release notes extracted from `CHANGELOG.md`.
- **publish** (runs in the `release` environment, with `contents: write`, `id-token: write`, and `attestations: write`): signs the checksums, attests build provenance, creates the GitHub Release, and publishes the exact CI-built files to Open VSX and, when `VSCE_PAT` is set, to the VS Code Marketplace.

### One-time GitHub setup (maintainers)

These settings live in GitHub, not in the repo, and must be configured by hand:

1. **Settings → Environments → `release`**: add required reviewers. Under deployment branches and tags, allow only tags matching `v*`.
2. **Settings → Rules → Rulesets**: add a tag ruleset for `v*` that restricts creation, update, and deletion to maintainers.
3. **Secrets** on the `release` environment (preferred) or the repo: `SIGNING_KEY`, `OVSX_PAT`, and `VSCE_PAT`. The Marketplace publish step is skipped until `VSCE_PAT` exists.
4. Optional: protect `main` and require the `CI` workflow's check to pass.
