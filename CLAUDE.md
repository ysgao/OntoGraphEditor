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
```

From `extension/`:

```bash
npm run compile   # tsc type-check
npm run watch     # tsc watch mode
npm run build     # esbuild bundle (dev)
npm run package   # esbuild bundle (minified, for publish)
```

**Debug**: Open repo root in VS Code → Run & Debug → `Launch Extension` (F5). A second `[Extension Development Host]` window opens. Trigger `OntoGraph: Open Editing Workbench` to verify webview loads.

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
Feature `002-graph-panel-ipc-bridge` is in progress on branch `002-graph-panel-ipc-bridge`. Specs and plan are in `specs/002-graph-panel-ipc-bridge/`. Architecture: **companion extension pattern** — OntoGraph-lite (`ysgao.ontograph-lite`) is declared as `extensionDependencies`; IPC bridge uses VS Code commands (`ontographEditor.ipcRoute` ↔ `ontograph.focusEntity`). Key changes: (1) patch `extension.ts` to register `openGraph` + `ipcRoute` commands, (2) patch `authoringPanel.ts` to add `static postMessage()`, (3) two small patches to OntoGraph-lite submodule (`apps/OntoGraph-lite/`). No new `graphPanel.ts` — OntoGraph-lite owns its own panel. See `specs/002-graph-panel-ipc-bridge/plan.md`.
<!-- SPECKIT END -->

## Syncing Submodules

```bash
# Sync authoring-ui-vscode with upstream IHTSDO changes
cd apps/authoring-ui-vscode
git fetch upstream
git merge upstream/master   # VsCodeService customizations stay intact

# Sync OntoGraph-lite
cd apps/OntoGraph-lite
git fetch origin && git merge origin/master
```

## Requirements

- Node.js 18+, npm
- JRE 21+ (OntoGraph reasoning backend, verified at extension runtime)
- VS Code 1.80+
