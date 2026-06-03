# Quickstart: Extension Packaging and Publishing

**Feature**: 003-extension-publish

---

## Package VSIX Locally

```bash
# 1. Build all assets
npm run build-all

# 2. Package the VSIX (from repo root)
npm run package:vsix

# Output: extension/ontograph-editor-extension-1.0.0.vsix
```

## Install VSIX Manually

```bash
code --install-extension extension/ontograph-editor-extension-1.0.0.vsix
```

Or in VS Code: Extensions view → `···` → "Install from VSIX…"

## Publish to Marketplace (Manual)

```bash
# Requires VSCE_PAT environment variable set to your Azure DevOps PAT
cd extension
npx vsce publish --pat $VSCE_PAT
```

## Automated Release via CI

Push a version tag to trigger the GitHub Actions release pipeline:

```bash
# Bump version in extension/package.json first
npm version patch --prefix extension   # or minor / major

# Tag and push
git tag v1.0.0
git push origin v1.0.0
```

The pipeline builds, tests, packages, and publishes automatically. The VSIX artifact is attached to the GitHub Actions run.

## Verify JRE Detection Locally

Activate the extension in the Extension Development Host (F5). If no JRE is detected, a notification appears immediately after activation. Suppress to test happy path:

```bash
# Temporarily remove java from PATH to test error case
PATH=$(echo $PATH | tr ':' '\n' | grep -v java | tr '\n' ':') code --extensionDevelopmentPath=.
```

## Prerequisites

- `VSCE_PAT` — Azure DevOps Personal Access Token scoped to Marketplace publish
- GitHub repository secret `VSCE_PAT` configured for CI pipeline
- `ysgao.ontograph-lite` must be published before running `extensionDependencies` auto-install tests
