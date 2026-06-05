# Research: Persist Display Configuration

**Date**: 2026-06-05

## Decision 1: Storage Mechanism

**Decision**: Use `ExtensionContext.globalState`

**Rationale**: Built into VS Code API — no extra dependencies. Persists across restarts. Scoped per-user (not per-workspace, which suits layout preferences). Keys are arbitrary strings; values are JSON-serializable. `globalState.setKeysForSync()` optionally syncs via Settings Sync — future enhancement.

**Alternatives considered**:
- `workspaceState` — resets per workspace, wrong scope for layout preferences
- Custom JSON file in `globalStorageUri` — more control but more code; overkill for 4 keys
- `vscode.workspace.getConfiguration()` — designed for user-editable settings, not programmatic state; would pollute `settings.json`

## Decision 2: Config Change Notification (Angular → Extension Host)

**Decision**: New IPC message types `DISPLAY_CONFIG_CHANGE` (webview → host) and `DISPLAY_CONFIG_INIT` (host → webview)

**Rationale**: Consistent with existing `CONCEPT_FOCUS` / `GRAPH_NODE_SELECT` pattern already in `ipcMessages.ts`. No new mechanisms needed.

**Alternatives considered**:
- Polling from host: adds complexity, no benefit
- Direct DOM inspection by host: impossible in sandboxed webview

## Decision 3: When to Send Config Changes from Angular

**Decision**: Debounced on resize end (~300 ms), immediate on scheme/mode change

**Rationale**: Resize events fire continuously; debounce avoids flooding the extension host. Scheme/mode are discrete selections — immediate save appropriate.

**Alternatives considered**:
- Save only on panel close: unreliable (panel can be killed without lifecycle event)
- Save on every resize event: unnecessary IPC traffic

## Decision 4: Config Restoration Timing

**Decision**: Extension host sends `DISPLAY_CONFIG_INIT` to webview immediately after webview signals ready (`WEBVIEW_READY` message or equivalent)

**Rationale**: Ensures config is applied before user sees layout, avoiding flash of default layout.

**Alternatives considered**:
- Embed config in initial HTML via `getWebviewContent()`: coupling; harder to test
- Webview polls for config: unnecessary complexity
