# Implementation Plan: Double-Click to Open Concept Model

**Branch**: `006-double-click-open-model` | **Date**: 2026-06-04 | **Spec**: [specs/006-double-click-open-model/spec.md](./spec.md)

**Input**: Feature specification from `specs/006-double-click-open-model/spec.md`

## Summary

The goal is to modify the hierarchy tree interaction so that single-clicking an entity only focuses/selects it, while double-clicking is required to open the concept model in the authoring workbench. This prevents unwanted workbench updates during hierarchy browsing.

## Technical Context

**Language/Version**: JavaScript (AngularJS 1.4.14)

**Primary Dependencies**: 
- `angular-ui-tree` (for hierarchy rendering)
- `angular-strap` (UI components)

**Project Type**: VS Code Webview Frontend (Legacy AngularJS)

**Performance Goals**: 
- Click detection delay < 300ms.
- Smooth highlight transition on single-click.

**Constraints**:
- Must work within the existing `$timeout`-based click/double-click detection logic in `taxonomyTree.js`.
- Must not break existing drag-and-drop functionality.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Decoupled UI Core | PASS | Modifying code in `apps/authoring-ui-vscode`. |
| II. IPC-Only Communication | PASS | Changes are internal to the UI (Angular events); no direct backend calls. |
| III. Webview Path Safety | PASS | No changes to resource paths or routing. |
| IV. Test-First Integration | N/A | This is a purely internal UI behavior change; manual UI verification is primary. |

## Project Structure

### Documentation (this feature)

```text
specs/006-double-click-open-model/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (Entity: Focus State)
└── quickstart.md        # Phase 1 output (How to test manually)
```

### Source Code (relevant files)

```text
apps/authoring-ui-vscode/app/
├── shared/
│   ├── taxonomy-tree/
│   │   ├── taxonomyTree.js      # Main interaction logic (clickNode)
│   │   └── taxonomyTree.html    # Template (ng-click, highlight class)
│   └── taxonomy/
│       └── taxonomy.js          # Parent controller (viewTaxonomy listener)
└── components/
    └── edit/
        └── edit.js              # Workbench controller (editConcept listener)
```

**Structure Decision**: We will focus modifications on `taxonomyTree.js` and `taxonomyTree.html` to decouple selection from model opening.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Manual double-click detection | Existing code uses `$timeout` because AngularJS 1.x `ng-click` and `ng-dblclick` conflict. | Using `ng-dblclick` would require significant refactoring of the tree template and might conflict with `ui-tree` selection. |
