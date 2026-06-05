# Implementation Plan: Persist Display Configuration

**Branch**: `008-persist-display-config` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-persist-display-config/spec.md`

## Summary

Persist the authoring-ui-vscode display configuration (tree-view width, editor width, display scheme, mode) across VS Code restarts using VS Code's `ExtensionContext.globalState`. The Angular webview reports layout changes to the extension host via the existing IPC bridge; the host writes to persistent storage and replays saved values on panel activation.

## Technical Context

**Language/Version**: TypeScript 5.x (extension host); TypeScript/Angular (webview)

**Primary Dependencies**: VS Code Extension API (`ExtensionContext.globalState`), existing IPC bridge (`postMessage`), Angular authoring-ui-vscode

**Storage**: `vscode.ExtensionContext.globalState` — VS Code built-in key-value store, survives restarts, scoped per user

**Testing**: Jest (extension unit tests already in repo)

**Target Platform**: VS Code 1.80+ desktop

**Project Type**: VS Code extension + Angular webview

**Performance Goals**: Config saved within 500 ms of change; restored before first webview paint

**Constraints**: No new network calls; no new npm dependencies; offline-capable; per-user config scope

**Scale/Scope**: 4 config keys — tree-view width, editor width, display scheme, mode

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Decoupled UI Core | ✅ Pass | Angular app sends events via IPC; extension host owns persistence |
| II. IPC-Only Communication | ✅ Pass | Config changes travel via existing `postMessage` bridge |
| III. Webview Path Safety | ✅ Pass | No new asset paths introduced |
| IV. Test-First Integration | ✅ Pass | `IDisplayConfigStore` interface defined in contracts before implementation |

## Project Structure

### Documentation (this feature)

```text
specs/008-persist-display-config/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
extension/src/authoring/
├── authoringPanel.ts          # existing — add config save/restore logic
├── displayConfig.ts           # NEW — DisplayConfigStore (globalState wrapper)
└── displayConfigMessages.ts   # NEW — IPC message types for config sync

apps/authoring-ui-vscode/src/app/core/services/
└── vscode.service.ts          # existing — add config-change event emitters

apps/authoring-ui-vscode/src/app/
└── [layout components]        # existing — wire resize/scheme/mode events to VsCodeService
```

**Structure Decision**: Single-project extension pattern. New files added to existing `extension/src/authoring/` module. Angular side changes confined to `vscode.service.ts` and existing layout components.
