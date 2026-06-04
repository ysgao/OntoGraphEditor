# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OntoGraph Editor** is a VS Code extension that embeds two Angular/web frontends as webview panels:
- **AuthoringUI** (`apps/authoring-ui-vscode/`) — fork of `IHTSDO/authoring-ui`, clinical SNOMED CT terminology editor
- **OntoGraph-lite** (`apps/OntoGraph-lite/`) — ontology graph visualization

The extension host (`extension/`) brokers all communication between the two sandboxed webview panels via `postMessage`.

## Commands

From repo root:

```bash
npm run build-all        # Build Angular client then extension bundle
npm run build:client     # Angular prod build only (apps/authoring-ui-vscode)
npm run build:extension  # esbuild extension bundle only
npm run lint             # ESLint on extension/src
npm run test             # Extension tests (Karma/Jest per project)
npm run package:vsix     # Package extension as .vsix (runs build-all first via vscode:prepublish)
```
```
npm run build-all && npm run package:vsix
```


From `extension/`:

```bash
npm run compile   # tsc type-check
npm run watch     # tsc watch mode
npm run build     # esbuild bundle (dev)
npm run package   # esbuild bundle (minified, for publish)
```

**Debug**: Open repo root in VS Code → Run & Debug → `Launch Extension` (F5). A second `[Extension Development Host]` window opens. Trigger `OntoGraph: Open Editing Workbench` to verify webview loads.

**Packaging**: Run `npm run package:vsix` from repo root. Output: `extension/dist/ontograph-editor-extension-{version}.vsix`. Install via VS Code "Install from VSIX…" or publish with `vsce publish --pat $VSCE_PAT` from `extension/`. Set `VSCE_PAT` GitHub secret for CI auto-publish on version tags (`git tag v1.0.0 && git push origin v1.0.0`).

## Architecture

### Repository Layout

```
extension/
├── src/
│   ├── extension.ts         # Activation, command registration, IPC routing
│   ├── authoringPanel.ts    # WebviewPanel for authoring-ui-vscode
│   └── graphPanel.ts        # WebviewPanel for OntoGraph-lite
├── esbuild.mjs              # Bundle config
└── package.json             # Extension manifest + contributes

apps/
├── authoring-ui-vscode/     # Git submodule: fork of IHTSDO/authoring-ui
└── OntoGraph-lite/          # Git submodule: graph visualization app

specs/
└── 001-authoring-ui-integration/   # Active feature spec, plan, tasks
```

### IPC Bridge Pattern

Both frontends run in isolated V8 sandbox processes. Communication flows:

```
AuthoringPanel  ←→  extension.ts (IPC router)  ←→  GraphPanel
     ↕                                                    ↕
postMessage JSON                                  postMessage JSON
```

Two event types cross the bridge:
- `CONCEPT_FOCUS` — authoring → graph: `{ command, payload: { id, label } }`
- `GRAPH_NODE_SELECT` — graph → authoring: `{ command, payload: { id } }`

### Webview Panel Requirements

Both panel classes (`authoringPanel.ts`, `graphPanel.ts`) must:
- Set `retainContextWhenHidden: true` to preserve state across tab switches
- Rewrite all Angular asset URLs using `webview.asWebviewUri()` — Angular outputs relative paths that are invalid in the webview sandbox
- Route via `HashLocationStrategy` (`useHash: true`) — HTML5 `pushState` routing does not work in webviews

### VsCodeService (Angular side)

Contract: `specs/001-authoring-ui-integration/contracts/vscode-service-interface.ts`

Location in Angular app: `src/app/core/services/vscode.service.ts`

Must gracefully degrade when `acquireVsCodeApi()` is unavailable (standalone browser dev mode — log warning, no crash).

## Active Feature

<!-- SPECKIT START -->
Feature `005-authoring-ui-layout-fixes` is in progress on branch `005-authoring-ui-layout-fixes`. Specs and plan are in `specs/005-authoring-ui-layout-fixes/`. Goal: fix three CSS layout defects in the Angular authoring UI when rendered in VS Code webview: (1) button-nav `top: 64px` offset wrong for webview (fix → `top: 0`), (2) edit column right-edge gap caused by VS Code webview body padding (fix → reset body padding + override `pull-right` to `float: none; width: 100%`), (3) `edit-no-model` view (diagram hidden) not expanding to full width in webview (fix → same as #2). All changes in a new `app/styles/vscode-overrides.scss` scoped to `.vscode-webview` body class (injected via inline script in `index.html` when `acquireVsCodeApi` is available). No Angular controller or template logic changes. See `specs/005-authoring-ui-layout-fixes/plan.md`.
<!-- SPECKIT END -->

## Syncing Submodules

Full runbook: `docs/maintenance/upstream-sync.md`

Quick reference:

```bash
# 1. Sync authoring-ui-vscode with upstream IHTSDO changes
cd apps/authoring-ui-vscode
git fetch upstream
../../scripts/check-upstream-conflicts.sh upstream/master   # verify no customization-scope conflicts
git merge upstream/master   # VsCodeService customizations stay intact
cd ../..

# 2. Sync OntoGraph-lite (default branch is 'main')
cd apps/OntoGraph-lite
git fetch origin && git merge origin/main
cd ../..

# 3. Verify unified build
npm run build-all
```

## Requirements

- Node.js 18+, npm
- JRE 21+ (OntoGraph reasoning backend, verified at extension runtime)
- VS Code 1.80+
