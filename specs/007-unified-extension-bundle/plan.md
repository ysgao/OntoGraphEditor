# Implementation Plan: Unified VSIX Extension Bundle

**Branch**: `007-unified-extension-bundle` | **Date**: Friday, June 5, 2026 | **Spec**: [specs/007-unified-extension-bundle/spec.md](spec.md)

**Input**: Feature specification from `specs/007-unified-extension-bundle/spec.md`

## Summary

This feature will consolidate `ontograph-lite` and `authoring-ui-vscode` into a single VS Code extension. Currently, the `ontograph-editor-extension` acts as a wrapper that installs `ontograph-lite` as a separate VSIX. We will refactor the build process to bundle both webview UIs into a single VSIX, share the Node.js extension host logic, and unify the `package.json` contributions.

## Technical Context

**Language/Version**: TypeScript / Node.js 18+

**Primary Dependencies**: `vscode` API, `esbuild` for bundling.

**Storage**: VS Code `ExtensionContext.secrets` for IMS cookies.

**Testing**: VS Code Extension Tests (Mocha).

**Target Platform**: VS Code Desktop (Extension Host).

**Project Type**: VS Code Extension.

**Performance Goals**: VSIX size under 50MB; extension activation under 1s.

**Constraints**: Must respect `asWebviewUri` for resource loading; IPC-only communication for webviews.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Decoupled UI Core**: PASS. `ontograph-lite` and `authoring-ui-vscode` are submodules.
- **II. IPC-Only Communication**: PASS. Current extension uses a `LocalProxy` and IPC messages.
- **III. Webview Path Safety**: PASS. Both UIs are designed for webview environments.
- **IV. Test-First Integration**: PASS. We will define contracts for unified IPC.

## Project Structure

### Documentation (this feature)

```text
specs/007-unified-extension-bundle/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
extension/
├── package.json         # Unified manifest
├── esbuild.mjs          # Unified build script
└── src/
    ├── extension.ts     # Unified entry point
    ├── authoring/       # Logic for Authoring UI (from submodule)
    └── graph/           # Logic for OntoGraph-lite (from submodule)

apps/
├── authoring-ui-vscode/ # Submodule (Frontend assets)
└── OntoGraph-lite/      # Submodule (Frontend assets)
```

**Structure Decision**: We will keep the `extension/` directory as the primary host. The `apps/` submodules will be built independently, and their `dist` outputs will be copied/bundled into the `extension/dist` directory.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |

## Phase 0: Outline & Research

1. **Submodule Build Orchestration**: Research how to trigger builds for both submodules from the root `package.json` and ensure their outputs are correctly placed for the extension bundle.
2. **Unified Entry Point**: Determine the best way to merge `ontograph-lite`'s extension host logic into the main `extension.ts`.
3. **Webview Resource Mapping**: Research path mapping for two distinct webview applications to ensure `asWebviewUri` resolves correctly for both.

## Phase 1: Design & Contracts

1. **Unified package.json**: Merge `contributes` sections from both apps.
2. **Unified Build Script**: Update `esbuild.mjs` to bundle assets from both `apps/`.
3. **IPC Message Registry**: Create a shared contract for all messages between host and either webview.
