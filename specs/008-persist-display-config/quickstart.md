# Quickstart: Persist Display Configuration

**Date**: 2026-06-05

## What This Feature Does

Saves tree-view width, editor width, display scheme, and mode selection in the authoring-ui-vscode panel to VS Code's persistent storage. Settings survive restarts and are restored automatically when the panel opens.

## Key Files to Touch

| File | Change |
|------|--------|
| `extension/src/authoring/displayConfig.ts` | **NEW** — `DisplayConfigStore` wrapping `globalState` |
| `extension/src/authoring/displayConfigMessages.ts` | **NEW** — `DISPLAY_CONFIG_CHANGE` / `DISPLAY_CONFIG_INIT` types |
| `extension/src/authoring/authoringPanel.ts` | Wire `DisplayConfigStore`; handle incoming messages; send init |
| `apps/authoring-ui-vscode/src/app/core/services/vscode.service.ts` | Add `sendDisplayConfigChange()` method |
| Layout component(s) in authoring-ui-vscode | Call `vscode.service.sendDisplayConfigChange()` on resize/scheme/mode change |

## Flow

1. Panel opens → host reads `globalState` → sends `DISPLAY_CONFIG_INIT` to webview
2. Webview applies saved widths, scheme, mode
3. User resizes → Angular debounces 300 ms → sends `DISPLAY_CONFIG_CHANGE` to host
4. Host merges partial update → writes to `globalState`

## Test

```bash
# Build and launch extension
npm run build-all
# F5 in VS Code to open Extension Development Host
# Open authoring panel, resize tree-view, change scheme
# Close and reopen VS Code
# Verify layout is restored
```
