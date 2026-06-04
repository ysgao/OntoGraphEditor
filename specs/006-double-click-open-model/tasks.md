# Tasks: Double-Click to Open Concept Model

**Input**: Design documents from `specs/006-double-click-open-model/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Verify project build state with `npm run build:client` in apps/authoring-ui-vscode

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure required before user story implementation

*No foundational tasks required as this is a modification of existing component logic.*

---

## Phase 3: User Story 1 - Precise Model Access (Priority: P1) 🎯 MVP

**Goal**: Change the model-opening trigger to double-click and allow selection via single-click.

**Independent Test**: Single-click a node highlights it but doesn't open the model. Double-click opens the model.

### Implementation for User Story 1

- [x] T002 [US1] Add `selectedNodeId` to directive scope and initialize in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`
- [x] T003 [US1] Update `clickNode` logic to set `selectedNodeId` on single-click in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`
- [x] T004 [US1] Move `editConcept` broadcast from single-click timeout to double-click handler in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`
- [x] T005 [US1] Update highlight CSS class condition to include `selectedNodeId` in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.html`

**Checkpoint**: User Story 1 functional - single-click selects, double-click opens.

---

## Phase 4: User Story 2 - Focus Retention (Priority: P2)

**Goal**: Ensure workbench model remains visible during hierarchy browsing and selection.

**Independent Test**: Open a model, click other tree nodes; the open model in the workbench stays unchanged.

### Implementation for User Story 2

- [x] T006 [US2] Update `selectedNodeId` when an external `editConcept` event is received to keep selection in sync in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`
- [x] T007 [US2] Ensure `viewTaxonomy` on double-click still correctly navigates the tree in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`

**Checkpoint**: User Story 2 functional - focus is retained in workbench during tree navigation.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [x] T008 [P] Verify that Drag & Drop functionality is unaffected by the new click logic in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.html`
- [x] T009 [P] Perform full manual validation using `specs/006-double-click-open-model/quickstart.md`
- [x] T010 [P] Clean up any debug logs or unused variables in `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately.
- **User Story 1 (Phase 3)**: Depends on Phase 1.
- **User Story 2 (Phase 4)**: Depends on Phase 3 completion for consistent state handling.
- **Polish (Phase 5)**: Depends on all user stories being complete.

### Parallel Opportunities

- T008, T009, and T010 can be performed in parallel during the final polish phase.
- T002 and T005 could potentially be started in parallel as they touch different files (JS vs HTML).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Implement T002-T005 to get the basic double-click behavior working.
2. Validate that single-click no longer opens models.
3. Verify double-click correctly triggers model load.

### Incremental Delivery

1. Foundation: Verify build.
2. Increment 1: US1 (Double-click to open).
3. Increment 2: US2 (Sync selection with external events).
4. Final: Polish and manual QA.
