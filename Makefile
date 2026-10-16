.PHONY: build compile watch typecheck lint test package release release-patch release-minor release-major install publish publish-marketplace publish-openvsx clean

# .vsix files are selected by the version in package.json, never by mtime,
# so stale packages from older releases can't be installed or published.
VERSION       := $(shell node -p "require('./package.json').version")
VSIX          := diffchestrator-$(VERSION).vsix
VSIX_OPENVSX  := diffchestrator-$(VERSION)-openvsx.vsix

# Build everything (webview + extension)
build:
	npm run build

# Compile extension only (no webview)
compile:
	npm run compile

# Watch mode for development
watch:
	npm run watch

# Typecheck extension + webview
typecheck:
	npm run typecheck

# Lint extension sources
lint:
	npm run lint

# Unit tests
test:
	npm test

# Build and package .vsix
package:
	npm run package

# Auto-detect bump from conventional commits, verify, package, then commit + tag
release:
	npm run release

# Force bump types
release-patch:
	npm run release:patch

release-minor:
	npm run release:minor

release-major:
	npm run release:major

# Install the Marketplace .vsix for the current package.json version
install:
	@test -f "$(VSIX)" || { echo "$(VSIX) not found. Run 'make package' first."; exit 1; }
	@echo "Installing $(VSIX)"
	code --install-extension "$(VSIX)" --force

# Publish to VS Code Marketplace (normally done by CI on tag push)
publish-marketplace:
	@test -f "$(VSIX)" || { echo "$(VSIX) not found. Run 'make release' first."; exit 1; }
	@echo "Publishing $(VSIX) to VS Code Marketplace"
	npx --no-install vsce publish --no-dependencies --packagePath "$(VSIX)"

# Publish to Open VSX (normally done by CI on tag push; reads OVSX_PAT from env)
publish-openvsx:
	@test -f "$(VSIX_OPENVSX)" || { echo "$(VSIX_OPENVSX) not found. Run 'make release' first."; exit 1; }
	@echo "Publishing $(VSIX_OPENVSX) to Open VSX"
	npx --no-install ovsx publish --packagePath "$(VSIX_OPENVSX)"

# Publish to both registries
publish: publish-marketplace publish-openvsx

# Remove build artifacts
clean:
	rm -rf dist/ diffchestrator-*.vsix
