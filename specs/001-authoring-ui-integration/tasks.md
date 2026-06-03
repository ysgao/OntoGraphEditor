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

- [ ] T001 Configure workspace directory layout and initialization settings in package.json
- [ ] T002 Configure monorepo packaging build scripts in package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure setup

- [ ] T003 Configure linting and build checks at workspace root in package.json

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Integrate Forked Angular UI into Project Structure (Priority: P1) 🎯 MVP

**Goal**: Integrate the clinical terminology interface into the codebase under `apps/authoring-ui-vscode` and ensure it builds.

**Independent Test**: Build the Angular app in `apps/authoring-ui-vscode` and verify compilation assets exist in the target distribution.

### Implementation for User Story 1

- [ ] T004 [P] [US1] Fork and place client Angular codebase in apps/authoring-ui-vscode/package.json
- [ ] T005 [US1] Configure Angular builder output directories in apps/authoring-ui-vscode/angular.json

**Checkpoint**: At this point, User Story 1 should be fully functional and buildable independently

---

## Phase 4: User Story 2 - VS Code Routing & Service Adaptation (Priority: P1)

**Goal**: Adapt the Angular router and create the VsCodeService communication wrapper for webview execution.

**Independent Test**: Verify Angular router navigates using hash paths and messages route via `VsCodeService`.

### Implementation for User Story 2

- [ ] T006 [US2] Implement HashLocationStrategy routing in apps/authoring-ui-vscode/src/app/app-routing.module.ts
- [ ] T007 [P] [US2] Implement VsCodeService messaging provider in apps/authoring-ui-vscode/src/app/core/services/vscode.service.ts

**Checkpoint**: At this point, User Stories 1 and 2 should work independently

---

## Phase 5: User Story 3 - Unified Workspace Packaging and Script Compilation (Priority: P2)

**Goal**: Create unified command at root to build both extension and client applications.

**Independent Test**: Run root build script and verify both components compile.

### Implementation for User Story 3

- [ ] T008 [US3] Define client build script in package.json
- [ ] T009 [US3] Define extension compile script in package.json
- [ ] T010 [US3] Define build-all unified compile script in package.json

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T011 Verify build compilation output formats and test execution via F5 launch in package.json

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
