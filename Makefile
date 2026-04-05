.PHONY: build compile watch package release release-patch release-minor release-major install publish publish-marketplace publish-openvsx clean

# Build everything (webview + extension)
build:
	npm run build

# Compile extension only (no webview)
compile:
	npm run compile

# Watch mode for development
watch:
	npm run watch

# Build and package .vsix
package:
	npm run package

# Auto-detect bump from conventional commits, build, and package
release:
	npm run release

# Force bump types
release-patch:
	npm run release:patch

release-minor:
	npm run release:minor

release-major:
	npm run release:major

# Install the latest Marketplace .vsix locally (excludes openvsx builds)
install:
	@vsix=$$(ls -t diffchestrator-*.vsix 2>/dev/null | grep -v openvsx | head -1); \
	if [ -z "$$vsix" ]; then echo "No .vsix found. Run 'make package' first."; exit 1; fi; \
	echo "Installing $$vsix"; \
	code --install-extension "$$vsix" --force

# Publish to VS Code Marketplace
publish-marketplace:
	@vsix=$$(ls -t diffchestrator-*[0-9].vsix 2>/dev/null | grep -v openvsx | head -1); \
	if [ -z "$$vsix" ]; then echo "No marketplace .vsix found. Run 'make release' first."; exit 1; fi; \
	echo "Publishing $$vsix to VS Code Marketplace"; \
	npx @vscode/vsce publish --packagePath "$$vsix"

# Publish to Open VSX
publish-openvsx:
	@vsix=$$(ls -t diffchestrator-*-openvsx.vsix 2>/dev/null | head -1); \
	if [ -z "$$vsix" ]; then echo "No Open VSX .vsix found. Run 'make release' first."; exit 1; fi; \
	echo "Publishing $$vsix to Open VSX"; \
	npx ovsx publish "$$vsix"

# Publish to both registries
publish: publish-marketplace publish-openvsx

# Remove build artifacts
clean:
	rm -rf dist/ diffchestrator-*.vsix
