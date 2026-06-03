# Implementation Plan: Angular Authoring UI Integration and Packaging

**Branch**: `001-authoring-ui-integration` | **Date**: 2026-06-03 | **Spec**: [specs/001-authoring-ui-integration/spec.md](file:///Users/yoga/OntoGraphEditor/specs/001-authoring-ui-integration/spec.md)

**Input**: Feature specification from [spec.md](file:///Users/yoga/OntoGraphEditor/specs/001-authoring-ui-integration/spec.md)

## Summary

The goal of this feature is to integrate the Angular-based clinical terminology authoring interface (a fork of `IHTSDO/authoring-ui`) into the extension workspace under `apps/authoring-ui-vscode`. This involves setting up the workspace directory structure, configuring root-level package build scripts (`build-all`), implementing the communication service wrapper (`VsCodeService`), and adapting Angular's router to use `HashLocationStrategy` to function within the VS Code Webview sandbox.

## Technical Context

**Language/Version**: TypeScript 4.x / 5.x, Angular 12+ (matching the forked `authoring-ui`)

**Primary Dependencies**: VS Code Extension Host API (`vscode`), Angular router, webpack/angular-cli

**Storage**: None (handled via IPC by the VS Code extension host)

**Testing**: npm run test / Jest / Karma (as standard for Angular/VS Code extension)

**Target Platform**: VS Code extension webview host runtime (V8 sandbox)

**Project Type**: VS Code Extension & Angular web application

**Performance Goals**: Assets compiled in < 3 mins, webview renders immediately

**Constraints**: Webview sandbox restrictions, relative URL resolutions

**Scale/Scope**: Unified build configuration and directory structure for submodules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

* Core Principles Met: Yes (TDD principles apply to custom services, library-first separation preserved by keeping frontend in `apps/`).
* Design Alignment: Yes (follows the spec layout map).

## Project Structure

### Documentation (this feature)

```text
specs/001-authoring-ui-integration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── contracts/           # Phase 1 output (/speckit-plan command)
    └── vscode-service-interface.ts
```

### Source Code (repository root)

```text
apps/
└── authoring-ui-vscode/         # Submodule fork of IHTSDO/authoring-ui

extension/                       # Main VS Code Extension Bundle (TypeScript)
├── src/
│   ├── extension.ts
│   └── authoringPanel.ts
├── package.json
└── tsconfig.json

package.json                     # Root configuration orchestrating workspaces/builds
```

**Structure Decision**: Option 2 (Web application structure with decoupled backend/extension and frontend folder directories).

## Complexity Tracking

*No violations.*

## Proposed Changes

We will introduce workspace-level script entries and Angular configuration files.

### 1. Workspace Configuration

#### [MODIFY] [package.json](file:///Users/yoga/OntoGraphEditor/package.json)
Configure the root packaging environment to bind the workspace and define the unified build scripts.

```json
{
  "name": "ontograph-editor-root",
  "version": "1.0.0",
  "scripts": {
    "build:extension": "cd extension && npm run compile",
    "build:client": "cd apps/authoring-ui-vscode && npm run build -- --prod",
    "build-all": "npm run build:client && npm run build:extension"
  }
}
```

### 2. Angular client routing changes

#### [MODIFY] [app-routing.module.ts](file:///Users/yoga/OntoGraphEditor/apps/authoring-ui-vscode/src/app/app-routing.module.ts)
Ensure routing setup uses `useHash: true` to prevent URL resolution failures.

```typescript
@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
```

## Verification Plan

### Automated Tests
* Run `npm run build-all` and verify exit code is 0.

### Manual Verification
* Deploy the extension locally using F5, open the Editing workbench tab, and verify that the Angular app loads and navigation updates the hash fragment correctly (e.g. `#/concepts`).
