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
│       ├── sessionFile.ts   # Writes ~/.ontograph-editor/session.json for cli/ discovery
│       └── httpJson.ts      # Shared raw-http/https JSON request helper
├── esbuild.mjs              # Bundle config; also bundles cli/dist into dist/cli/
└── package.json             # Extension manifest + contributes

cli/                         # Headless CLI (global command `authoring-cli`, see below)
├── src/
│   ├── index.ts             # Entry point, arg parsing, command registry/dispatch
│   ├── session.ts           # Reads ~/.ontograph-editor/session.json
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

Actual location in the AngularJS 1.x app: `app/shared/vscode-service/vsCodeService.js` (see `apps/authoring-ui-vscode/CLAUDE.md` for the full dual-mode writeup — the contract file above predates the real implementation and doesn't match its path).

Must gracefully degrade when `acquireVsCodeApi()` is unavailable (standalone browser dev mode — log warning, no crash).

## Headless CLI (`authoring-cli`)

`cli/` is a standalone npm workspace, exposed as the global command `authoring-cli`. It lets an AI model (e.g. Claude Code) perform authoring actions against the same task branch a human has open in the Authoring Workbench, reusing the extension's IMS session cookie. Run `authoring-cli` with no arguments for the full, current command list with usage strings — it's the source of truth over any list duplicated here. Broadly: concept lifecycle (`create-concept`, `get-concept`, `search-concepts`, `delete-concept` — delete only when never versioned, mirroring `terminologyServerService.js`'s own `deleteConcept()`), description/relationship/axiom edits (`add-description`, `update-description`, `set-case-significance`, `set-acceptability`, `add-relationship`, `update-axiom`/`update-gci-axiom`, `set-definition-status`, `inactivate-concept`, `delete-description`/`delete-axiom`/`delete-gci-axiom` — deletes and in-place updates are all guarded on `effectiveTime` being null, since a versioned/released component must not be mutated), task-level operations (`classify`, `validate-task`, `review-concepts`), and confirmation/inspection tools (`current-task` — confirms the CLI's auto-detected task context matches what's open in the UI, via the same live session state the extension already tracks; `validate-concept` — read-only check of a concept's current saved state against Snowstorm's pre-save validation rules, without saving anything). **This is a different tool from `apps/OntoGraph-lite`'s own `ontograph` CLI (package `@ysgao/ontograph-cli`)** — no shared name, code, or purpose.

**Save-time validation, surfaced to both the CLI and the webview:** every concept-mutating action requests Snowstorm's `?validate=true` on its PUT/POST (`extension/src/shared/actions/updateConcept.ts`'s `fetchAndUpdateConcept`, `createConcept.ts`), the same flag the interactive editor's save flow uses. Any `validationResults` in the response are (a) printed by the CLI on success, not just on failure (`cli/src/validationOutput.ts`'s `printValidationResults`), and (b) pushed into the live Authoring panel if one is open, via `AuthoringPanel.postMessage` (`extension/src/shared/actions/validationBroadcast.ts`, a new `VALIDATION_RESULTS` `IpcMessage` variant) — see `apps/authoring-ui-vscode/CLAUDE.md`'s `VALIDATION_RESULTS` section for the Angular-side handling. `validate-concept` gets the same messages without triggering a save, but deliberately does not push to the webview (a read-only check shouldn't overwrite what a human might be seeing that reflects their own unsaved edits).

**Installation is automatic, not a dev workflow step:** `cli/`'s TypeScript source is never shipped to end users — only `apps/*` submodule content and the extension's own compiled bundle reach a packaged install. `extension/esbuild.mjs`'s post-build step copies `cli/dist/` plus a trimmed, dependency-free `package.json` (name/version/`bin` only — no `devDependencies`) into `extension/dist/cli/`; `extension/src/shared/cliInstaller.ts`'s `ensureAuthoringCliLinked()` installs it on extension activation, comparing the bundled version against `context.globalState` so it only reinstalls after an actual version change (not on every activation). This is deliberate: shipping only the compiled artifact (never the editable source) prevents users from hand-modifying the CLI and drifting out of sync with whatever extension version they're running — the source of truth stays in the repo, what ships is a build artifact.

Installation does **not** use `npm link` — that resolves whatever Node/npm the extension host process sees, which routinely differs from the user's actual terminal Node/npm (nvm/volta-managed installs, custom npm prefixes, or a VS Code fork bundling its own Node), so the link can "succeed" while landing in a global bin dir the user's terminal never sees. Instead, `extension/src/shared/cliPathConfig.ts` hand-writes a shim to a fixed, version-independent location — `~/.ontograph-editor/bin/authoring-cli` (`.cmd` on Windows) — that execs `node` if it's on the user's PATH, or falls back to the IDE's own bundled Electron runtime (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) if not, so the CLI works even with zero Node installed system-wide (the target users are clinical terminologists, not developers). It then gets `~/.ontograph-editor/bin` onto PATH itself, rustup/cargo-style: one canonical `~/.ontograph-editor/env.sh`/`env.fish`, sourced via a marker-guarded (`# >>> ontograph authoring-cli >>>`) one-liner idempotently upserted into `~/.zshrc`/`~/.bash_profile`/`~/.bashrc`/`~/.profile` (and a `conf.d` drop-in for fish, only if `~/.config/fish` already exists) on Unix, or the user-level (`HKCU`, no admin) `Path` registry value via a generated PowerShell script on Windows (deliberately not `setx`, which silently truncates PATH values over ~1024 chars). A **new terminal window** is required after first setup — no OS re-reads PATH into an already-running shell, the same constraint nvm/rustup/homebrew all share. Manual fallback/troubleshooting: **OntoGraph: Set Up authoring-cli Command** (forces a rewrite of the shim and PATH setup).

**How it connects:** the extension host runs `ControlServer` (`extension/src/shared/controlServer.ts`), a token-authed local HTTP server, and writes its address/token plus the currently-open task to `~/.ontograph-editor/session.json` (`sessionFile.ts`) on activation and on every `TASK_CONTEXT_CHANGED` message. `cli/` reads that file, calls `ControlServer` directly, and prints the result — no VS Code API access needed from the CLI process itself. Each action is its own module under `extension/src/shared/actions/`, sharing `resolveTaskContext()`/`resolveDefaultModuleId()` (`actions/taskContext.ts`) — `controlServer.ts` itself is just the HTTP route table.

**Deliberate design decision — headless over correctness-by-reuse:** `ControlServer` builds the Snowstorm concept payload itself (module resolution, branch-root derivation, axiom shape) rather than delegating the actual REST call to the already-open, already-authenticated Authoring webview (which would reuse the Angular app's own tested `terminologyServerService.js`/`componentAuthoringUtil.js` logic for free). Delegating to the webview was rejected because it would require the Authoring Workbench panel to be open for the CLI to work at all — unacceptable for unattended/AI-driven use. The accepted cost: `ControlServer`'s payload logic is a hand-maintained parallel of the Angular app's real implementation and has already drifted from it twice (missing `axiomId`/`moduleId` on the axiom; hardcoded international module instead of the project's real extension module). **When adding new `authoring-cli` actions, cross-check the equivalent logic in `apps/authoring-ui-vscode/app/shared/terminology-server-service/terminologyServerService.js`, `component-authoring-util/componentAuthoringUtil.js`, and `metadata-service/metadataService.js` rather than assuming the existing pattern generalizes.**

**Extension-aware description acceptability:** `actions/dialectMetadata.ts` ports the dialect-relevant subset of `metadataService.js`'s `setExtensionMetadata()`/`getDialectsForModuleId()`/`getReadOnlyDialectsForModuleId()` and `componentAuthoringUtil.js`'s `getNewAcceptabilityMap()`/`getNewFsn()`, parsing the same `metadata` object `resolveDefaultModuleId()` already fetches (`fetchProjectMetadata()` in `taskContext.ts`, shared/cached across both). `createConcept.ts`'s `makeDescription()` and `updateConcept.ts`'s `addDescription` build their default acceptabilityMap from this — International Edition still gets en-us/en-gb both Preferred, but an extension project with its own `requiredLanguageRefset.*` now gets that extension's real dialects (and, matching `getNewFsn`'s special case, an FSN on an extension not using international language refsets gets en-us-only Preferred with no en-gb key). `updateConcept.ts`'s `setAcceptability` deliberately keeps its explicit `us`/`gb` parameters as-is — those name the two specific international dialects by design (mirroring the labeled US/GB buttons in `conceptEdit.js`'s `toggleAcceptability()`), not a "default" the caller left unspecified, so there's no dialect metadata to resolve there. See `dialectMetadata.test.ts` for coverage of the parsing/derivation logic in isolation.

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
../../scripts/check-upstream-conflicts.sh upstream/master   # verify no customization-scope conflicts (see PROTECTED_PATHS in the script for the current list)
git merge upstream/master   # VS Code customizations stay intact
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
