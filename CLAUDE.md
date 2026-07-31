# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OntoGraph Editor** is a VS Code extension that embeds two Angular/web frontends as webview panels:
- **AuthoringUI** (`apps/authoring-ui-vscode/`) — fork of `IHTSDO/authoring-ui`, clinical SNOMED CT terminology editor
- **OntoGraph-lite** (`apps/OntoGraph-lite/`) — fork of `ysgao/OntoGraph-lite`, ontology graph visualization

The extension host (`extension/`) brokers all communication between the two sandboxed webview panels via `postMessage`.

A third component, `cli/` (global command `authoring-cli`), lets an AI model perform authoring actions (e.g. `create-concept`) headlessly against whatever task a human has open in the Authoring workbench — see [Headless CLI](#headless-cli-authoring-cli) below. It is unrelated to `apps/OntoGraph-lite`'s own `ontograph` CLI.

## Commands

From repo root:

```bash
npm run build-all        # Build Angular client then extension bundle
npm run build:client     # Angular prod build only (apps/authoring-ui-vscode)
npm run build:extension  # esbuild extension bundle only
npm run build:cli        # tsc build for cli/ (not part of build-all/package:vsix — separate tool)
npm run package:vsix     # Full package: validate + build Angular + bundle extension (minified) + vsce pack
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
│   ├── authoring/
│   │   ├── authoringPanel.ts      # WebviewPanel for authoring-ui-vscode
│   │   └── activateAuthoring.ts   # Commands, cookie auth, starts ControlServer
│   ├── graph/graphPanel.ts        # WebviewPanel for OntoGraph-lite
│   └── shared/
│       ├── localProxy.ts    # CORS/cookie relay for the webview's XHR calls
│       ├── controlServer.ts # Token-authed local API for cli/ — route table only
│       ├── actions/         # One module per authoring-cli action (see Headless CLI)
│       ├── cliInstaller.ts  # Auto `npm link`s the bundled cli/ on activation
│       ├── sessionState.ts  # In-memory signed-in/current-task state
│       ├── sessionFile.ts   # Writes ~/.ontograph/session.json for cli/ discovery
│       └── httpJson.ts      # Shared raw-http/https JSON request helper
├── esbuild.mjs              # Bundle config; also bundles cli/dist into dist/cli/
└── package.json             # Extension manifest + contributes

cli/                         # Headless CLI (global command `authoring-cli`, see below)
├── src/
│   ├── index.ts             # Entry point, arg parsing, command registry/dispatch
│   ├── session.ts           # Reads ~/.ontograph/session.json
│   ├── client.ts            # HTTP client for ControlServer
│   └── commands/            # One file per action (createConcept, searchConcepts, classify, ...)
└── package.json

apps/
├── authoring-ui-vscode/     # Git submodule: fork of IHTSDO/authoring-ui
└── OntoGraph-lite/          # Git submodule: fork of ysgao/OntoGraph-lite

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

Two event types cross the panel-to-panel bridge (routed via `ontographEditor.ipcRoute` in `extension.ts`):
- `CONCEPT_FOCUS` — authoring → graph: `{ command, payload: { id, label } }`
- `GRAPH_NODE_SELECT` — graph → authoring: `{ command, payload: { id } }`

A third type is host-internal only (handled in `authoringPanel.ts`'s `handleMessage`, never forwarded to `ipcRoute`):
- `TASK_CONTEXT_CHANGED` — authoring webview → extension host: `{ command, payload: { projectKey, taskKey, branchPath } | null }`, sent whenever the human opens or leaves a task. Updates `sessionState.ts` and triggers a `sessionFile.ts` rewrite — this is how the headless CLI (`cli/`) learns which task is currently open.

### Webview Panel Requirements

Both panel classes (`authoringPanel.ts`, `graphPanel.ts`) must:
- Set `retainContextWhenHidden: true` to preserve state across tab switches
- Rewrite all Angular asset URLs using `webview.asWebviewUri()` — Angular outputs relative paths that are invalid in the webview sandbox
- Route via `HashLocationStrategy` (`useHash: true`) — HTML5 `pushState` routing does not work in webviews

Two gotchas that follow from the above (see `apps/authoring-ui-vscode/CLAUDE.md` for the full writeup):
- Because `<base href>` must point at the webview's own asset root, it diverges from the webview's real document address — so a plain `<a href="#/...">` hash link silently fails to navigate (browser treats it as cross-document nav, not same-page). The Angular side must intercept these clicks and drive routing through its own router API instead of relying on native href resolution.
- Backend endpoints injected into the webview config need a proxy allowlist: only endpoints called via XHR should be rewritten to the local CORS proxy — endpoints used to build externally-opened links (help/docs pages, companion apps) must keep their real, unproxied value, or the local proxy silently turns them into dead `localhost:<port>/...` URLs.

### VsCodeService (Angular side)

Contract: `specs/001-authoring-ui-integration/contracts/vscode-service-interface.ts`

Location in Angular app: `src/app/core/services/vscode.service.ts`

Must gracefully degrade when `acquireVsCodeApi()` is unavailable (standalone browser dev mode — log warning, no crash).

## Headless CLI (`authoring-cli`)

`cli/` is a standalone npm workspace, exposed as the global command `authoring-cli`. It lets an AI model (e.g. Claude Code) perform authoring actions — concept create/get/search/update (description, relationship, definition status, inactivate), plus classify/validate — against the same task branch a human has open in the Authoring Workbench, reusing the extension's IMS session cookie. **This is a different tool from `apps/OntoGraph-lite`'s own `ontograph` CLI (package `@ysgao/ontograph-cli`)** — no shared name, code, or purpose.

**Installation is automatic, not a dev workflow step:** `cli/`'s TypeScript source is never shipped to end users — only `apps/*` submodule content and the extension's own compiled bundle reach a packaged install. `extension/esbuild.mjs`'s post-build step copies `cli/dist/` plus a trimmed, dependency-free `package.json` (name/version/`bin` only — no `devDependencies`) into `extension/dist/cli/`; `extension/src/shared/cliInstaller.ts`'s `ensureAuthoringCliLinked()` runs `npm link` against that bundled copy on extension activation, comparing the bundled version against `context.globalState` so it only re-links after an actual version change (not on every activation). This is deliberate: shipping only the compiled artifact (never the editable source) prevents users from hand-modifying the CLI and drifting out of sync with whatever extension version they're running — the source of truth stays in the repo, what ships is a build artifact, and re-linking on every version bump keeps the global command automatically current. Manual fallback/troubleshooting: **OntoGraph: Set Up authoring-cli Command**, or `cd <extension install dir>/dist/cli && npm link`. During development (this repo, not an installed extension), `cli/`'s own `npm run build && npm link` still works the same way it always has.

**How it connects:** the extension host runs `ControlServer` (`extension/src/shared/controlServer.ts`), a token-authed local HTTP server, and writes its address/token plus the currently-open task to `~/.ontograph/session.json` (`sessionFile.ts`) on activation and on every `TASK_CONTEXT_CHANGED` message. `cli/` reads that file, calls `ControlServer` directly, and prints the result — no VS Code API access needed from the CLI process itself. Each action is its own module under `extension/src/shared/actions/`, sharing `resolveTaskContext()`/`resolveDefaultModuleId()` (`actions/taskContext.ts`) — `controlServer.ts` itself is just the HTTP route table.

**Deliberate design decision — headless over correctness-by-reuse:** `ControlServer` builds the Snowstorm concept payload itself (module resolution, branch-root derivation, axiom shape) rather than delegating the actual REST call to the already-open, already-authenticated Authoring webview (which would reuse the Angular app's own tested `terminologyServerService.js`/`componentAuthoringUtil.js` logic for free). Delegating to the webview was rejected because it would require the Authoring Workbench panel to be open for the CLI to work at all — unacceptable for unattended/AI-driven use. The accepted cost: `ControlServer`'s payload logic is a hand-maintained parallel of the Angular app's real implementation and has already drifted from it twice (missing `axiomId`/`moduleId` on the axiom; hardcoded international module instead of the project's real extension module). **When adding new `authoring-cli` actions, cross-check the equivalent logic in `apps/authoring-ui-vscode/app/shared/terminology-server-service/terminologyServerService.js`, `component-authoring-util/componentAuthoringUtil.js`, and `metadata-service/metadataService.js` rather than assuming the existing pattern generalizes.**

**Classification/validation status in the webview:** `scaService.js`'s STOMP/WebSocket connection to authoring-services is skipped entirely in VS Code mode (webview sandbox limitation), so real-time job-completion notifications never arrive there. `edit.js`'s `pollClassificationStatusInVsCode()` works around this with an HTTP poll (gated to VS Code mode only), calling `scaService.clearClassificationStatusCacheForTask()` before each check — `authoring-services` caches `latestClassificationJson`, so skipping the cache-evict call reads back a permanently stale "RUNNING" status even after the job finishes.

## Active Feature

<!-- SPECKIT START -->
Feature `010-pull-upstream-merge` is in progress on branch `010-pull-upstream-merge`. Specs and plan are in `specs/010-pull-upstream-merge/`. Goal: fast-forward the `apps/OntoGraph-lite` fork (`ysgao/OntoGraph-lite-vscode`) to incorporate 35 upstream commits from `ysgao/OntoGraph-lite` (features 015–023: entity creation, navigation history, unsaved-changes guard, Manchester sort, OntoGraph CLI). Fork is a strict ancestor of upstream — merge is conflict-free. After merge, bump the submodule pointer in the parent repo and verify `npm run build-all` passes. See `specs/010-pull-upstream-merge/plan.md`.
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

# 2. Sync OntoGraph-lite fork with upstream ysgao/OntoGraph-lite
# origin = ysgao/OntoGraph-lite-vscode (fork), upstream = ysgao/OntoGraph-lite
cd apps/OntoGraph-lite
git fetch upstream
git merge upstream/main   # fork VS Code customizations stay intact
cd ../..

# 3. Verify unified build
npm run build-all
```

## Requirements

- Node.js 18+, npm
- JRE 21+ (OntoGraph reasoning backend, verified at extension runtime)
- VS Code 1.80+
