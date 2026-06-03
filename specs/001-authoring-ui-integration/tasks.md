# Tasks: Angular Authoring UI Integration and Packaging

**Input**: Design documents from `/specs/001-authoring-ui-integration/`

**Prerequisites**: plan.md (required), spec.md (required)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic workspace setup

- [X] T001 Configure root package.json with unified build scripts (client, extension, build-all)
- [X] T012 Register ontographEditor.openAuthoring command in extension/package.json
- [X] T018 [P] Verify IHTSDO/authoring-ui framework version (Angular 2+ vs AngularJS 1.x); confirm HashLocationStrategy API applies; document finding in research.md before Phase 4 work begins

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure setup

- [X] T003 Configure linting and build checks at workspace root in package.json

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Integrate Forked Angular UI into Project Structure (Priority: P1) 🎯 MVP

**Goal**: Integrate the clinical terminology interface into the codebase under `apps/authoring-ui-vscode` and ensure it builds.

**Independent Test**: Build the Angular app in `apps/authoring-ui-vscode` and verify compilation assets exist in the target distribution.

### Implementation for User Story 1

- [X] T004 [P] [US1] Fork and place client Angular codebase at apps/authoring-ui-vscode/ (submodule from ysgao/authoring-ui fork of IHTSDO/authoring-ui)
- [X] T005 [US1] Configure Angular builder output directories — AngularJS/Grunt outputs to dist/ by default; build:client updated to use npx grunt build
- [X] T016 [US1] Implement extension/src/authoringPanel.ts: createWebviewPanel, retainContextWhenHidden: true, webview.asWebviewUri HTML asset rewrite engine (FR-005, SC-002)

**Checkpoint**: At this point, User Story 1 should be fully functional and buildable independently

---

## Phase 4: User Story 2 - VS Code Routing & Service Adaptation (Priority: P1)

**Goal**: Adapt the Angular router and create the VsCodeService communication wrapper for webview execution.

**Independent Test**: Verify Angular router navigates using hash paths and messages route via `VsCodeService`.

### Implementation for User Story 2

- [X] T006 [US2] HashLocationStrategy N/A — AngularJS 1.x uses hash routing by default; no routing changes required
- [X] T014 [US2] Hash-fallback route N/A — covered by AngularJS ngRoute default hash behavior
- [X] T007 [P] [US2] Implement vsCodeService AngularJS factory in apps/authoring-ui-vscode/app/shared/vscode-service/vsCodeService.js; registered in index.html
- [X] T013 [US2] Browser-standalone fallback implemented in vsCodeService.js (graceful no-op when acquireVsCodeApi unavailable)

**Checkpoint**: At this point, User Stories 1 and 2 should work independently

---

## Phase 5: User Story 3 - Unified Workspace Packaging and Script Compilation (Priority: P2)

**Goal**: Create unified command at root to build both extension and client applications.

**Independent Test**: Run root build script and verify both components compile.

### Implementation for User Story 3

- [X] T015 [SC-001] Verify build-all completion time is < 3 minutes — measured 37s total (client 35s + extension 2s). node-sass replaced with sass (dart) to support Node 22.

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T011 Verify build compilation output formats and test execution via F5 launch — .vscode/launch.json and tasks.json created; extension/dist/extension.js confirmed built by esbuild

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### Parallel Opportunities

- Tasks marked `[P]` can run in parallel where their prerequisites are met.

---

## Parallel Example: User Story 2

```bash
# Implement the messaging provider independently of the routing config:
Task: "Implement VsCodeService messaging provider in apps/authoring-ui-vscode/src/app/core/services/vscode.service.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Verify compiled assets build successfully.
