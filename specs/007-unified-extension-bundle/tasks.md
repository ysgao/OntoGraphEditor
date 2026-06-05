# Tasks: Unified VSIX Extension Bundle

**Input**: Design documents from `specs/007-unified-extension-bundle/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Update root `package.json` with `build-all` and submodule install scripts
- [x] T002 Update `extension/package.json` with placeholders for merged contributions
- [x] T003 [P] Create `extension/src/graph/` and `extension/src/authoring/` directories for host logic

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure for the unified build and extension host

- [x] T004 [P] Refactor `extension/esbuild.mjs` to support multi-target bundling (extension, workers, webviews)
- [x] T005 [P] Implement `extension/src/graph/activateGraph.ts` (skeleton to receive merged logic)
- [x] T006 [P] Implement `extension/src/authoring/activateAuthoring.ts` (to host existing AuthoringPanel logic)
- [x] T007 Update `extension/src/extension.ts` to call `activateGraph` and `activateAuthoring`

**Checkpoint**: Foundation ready - unified build system and entry point established. [X]

---

## Phase 3: User Story 1 - Unified Tooling Installation (Priority: P1) 🎯 MVP

**Goal**: Install a single VSIX that provides both OntoGraph and Authoring UI.

**Independent Test**: Install the VSIX and verify both sets of commands/views are visible.

### Implementation for User Story 1

- [x] T008 [P] [US1] Merge all `contributes` (commands, views, configuration) from `apps/OntoGraph-lite/package.json` into `extension/package.json`
- [x] T009 [US1] Port extension host logic from `apps/OntoGraph-lite/src/extension.ts` to `extension/src/graph/activateGraph.ts`
- [x] T010 [P] [US1] Port `AuthoringPanel` initialization to `extension/src/authoring/activateAuthoring.ts`
- [x] T011 [US1] Update `extension/src/extension.ts` to coordinate IPC between both applications via `ontographEditor.ipcRoute`
- [x] T012 [US1] Update `extension/esbuild.mjs` to bundle all webview scripts from `apps/OntoGraph-lite/webview-src/` into `extension/dist/`
- [x] T013 [US1] Update `extension/esbuild.mjs` to copy built assets from `apps/authoring-ui-vscode/dist/` to `extension/dist/authoring/`

**Checkpoint**: User Story 1 complete - a single VSIX now contains and launches both applications. [X]

---

## Phase 4: User Story 2 - Shared Resource Efficiency (Priority: P2)

**Goal**: Reduce VSIX size and runtime overhead by sharing dependencies.

**Independent Test**: Verify VSIX size and ensure only one extension host process is running.

### Implementation for User Story 2

- [x] T014 [P] [US2] Audit and deduplicate `node_modules` in `extension/package.json` for shared core dependencies
- [x] T015 [US2] Update `extension/esbuild.mjs` to share common chunks between webview bundles if possible
- [x] T016 [US2] Refactor `extension/src/localProxy.ts` to be shared between both applications if applicable

**Checkpoint**: User Story 2 complete - resource usage optimized. [X]

---

## Phase 5: User Story 3 - Streamlined Developer Workflow (Priority: P3)

**Goal**: Simplify development with automated submodule management.

**Independent Test**: Run a single command to update submodules and build the entire project.

### Implementation for User Story 3

- [x] T017 [P] [US3] Create `scripts/sync-submodules.sh` to automate recursive updates and dependency installation
- [x] T018 [US3] Add validation step to build process to check for submodule presence and correct versions
- [x] T019 [P] [US3] Update `README.md` and `quickstart.md` with the new unified build workflow

**Checkpoint**: All user stories complete - developer experience streamlined. [X]

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalizing the bundle and ensuring quality

- [x] T020 [P] Comprehensive VSIX verification: test all commands and views in a fresh VS Code instance
- [x] T021 [P] Verify `asWebviewUri` resolutions for all webview resources in `dist/`
- [x] T022 Documentation: update `GEMINI.md` with new project structure and commands
- [x] T023 Performance: verify activation time and VSIX package size targets

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Must complete T001 before others.
- **Foundational (Phase 2)**: Depends on Phase 1 completion.
- **User Story 1 (Phase 3)**: Depends on Phase 2. This is the **MVP**.
- **User Stories 2 & 3 (Phases 4-5)**: Depend on Phase 3 completion. Can be done in parallel.
- **Polish (Phase 6)**: Final step.

### Parallel Opportunities

- T004, T005, T006 can run in parallel.
- T008 and T010 can run in parallel (different areas of focus).
- T014, T017, T019 are independent.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Focus on the core merge: `package.json` and `extension.ts`.
2. Ensure both UIs can launch independently from the same extension.
3. Validate basic IPC (e.g., clicking a node in graph focuses it in authoring).

### Incremental Delivery

1. Setup + Foundation -> Build system ready.
2. User Story 1 -> Feature parity in single VSIX (MVP).
3. User Story 2 -> Optimization.
4. User Story 3 -> Maintenance automation.
