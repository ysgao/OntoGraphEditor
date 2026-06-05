# Tasks: Persist Display Configuration

**Input**: Design documents from `specs/008-persist-display-config/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ipc-contract.md ✅, quickstart.md ✅

**Organization**: Grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define IPC message types and `DisplayConfig` data shape — shared by all user stories.

- [x] T001 Create `extension/src/authoring/displayConfigMessages.ts` with `DISPLAY_CONFIG_CHANGE` and `DISPLAY_CONFIG_INIT` message type interfaces per `specs/008-persist-display-config/contracts/ipc-contract.md`
- [x] T002 [P] Create `extension/src/authoring/displayConfig.ts` with `DisplayConfig` interface, `DEFAULT_DISPLAY_CONFIG` constant, and `DISPLAY_CONFIG_STORAGE_KEY` string per `specs/008-persist-display-config/data-model.md`

**Checkpoint**: Shared types ready — all subsequent tasks can reference them

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `DisplayConfigStore` — the persistence layer all user stories depend on.

**⚠️ CRITICAL**: User story phases cannot begin until this phase is complete.

- [x] T003 Add `IDisplayConfigStore` interface to `extension/src/authoring/displayConfig.ts` with `load(): DisplayConfig` and `save(partial: Partial<DisplayConfig>): void` methods per `specs/008-persist-display-config/contracts/ipc-contract.md`
- [x] T004 Implement `DisplayConfigStore` class in `extension/src/authoring/displayConfig.ts` using `vscode.ExtensionContext.globalState` for persistence; include schema version check with fallback to defaults per `specs/008-persist-display-config/data-model.md`
- [x] T005 Export `DisplayConfigStore` and `IDisplayConfigStore` from `extension/src/authoring/displayConfig.ts`

**Checkpoint**: Persistence layer complete — user story phases can now begin

---

## Phase 3: User Story 1 — Config Survives Restart (Priority: P1) 🎯 MVP

**Goal**: Tree-view and editor widths survive VS Code restart.

**Independent Test**: Resize tree-view panel → close VS Code → reopen → verify width matches saved value.

### Implementation for User Story 1

- [x] T006 [US1] Instantiate `DisplayConfigStore` in `extension/src/authoring/authoringPanel.ts` constructor, passing `ExtensionContext`; read and store loaded config on panel creation
- [x] T007 [US1] In `extension/src/authoring/authoringPanel.ts`, add handler for `DISPLAY_CONFIG_CHANGE` message from webview; merge into stored config via `DisplayConfigStore.save()`
- [x] T008 [US1] In `extension/src/authoring/authoringPanel.ts`, send `DISPLAY_CONFIG_INIT` message to webview after webview signals ready via `WEBVIEW_READY`; include full saved config
- [x] T009 [P] [US1] In `apps/authoring-ui-vscode/app/shared/vscode-service/vsCodeService.js`, add `sendDisplayConfigChange(partial)` method posting `DISPLAY_CONFIG_CHANGE`; no-op in browser mode
- [x] T010 [US1] In `apps/authoring-ui-vscode/app/shared/vscode-service/vsCodeService.js`, add `onDisplayConfigInit(callback)` and `getStoredDisplayConfig()` methods
- [x] T011 [US1] Wire layout persistence: `accountService.getUserPreferences()` reads from extension host via `vsCodeService.onDisplayConfigInit`/`getStoredDisplayConfig` when in VS Code; signals `WEBVIEW_READY` from `app.js` run block
- [x] T012 [US1] Wire `accountService.saveUserPreferences()` to call `vsCodeService.sendDisplayConfigChange({ userPreferences })` when in VS Code — saves layout (grid cols), colourScheme, appView in one payload
- [x] T013 [US1] `getUserPreferences` restores full `userPreferences` (including layout.editDefault) from extension host on panel open — layout applied by existing `accountService.applyUserPreferences` / `layoutHandler.setLayout` flow

**Checkpoint**: User Story 1 complete — resize, restart, verify widths restored

---

## Phase 4: User Story 2 — Display Scheme Persists (Priority: P2)

**Goal**: Selected display scheme survives VS Code restart.

**Independent Test**: Switch scheme → restart VS Code → verify same scheme is active.

### Implementation for User Story 2

- [x] T014 [US2] `colourScheme` field in `userPreferences` persisted and restored via unified `saveUserPreferences`/`getUserPreferences` flow — no separate handler needed
- [x] T015 [US2] Scheme changes trigger `saveUserPreferences` (existing flow) → `sendDisplayConfigChange({ userPreferences })` → extension host `globalState` update
- [x] T016 [US2] On restore, `getUserPreferences` returns saved prefs including `colourScheme` → `applyUserPreferences` applies it via `$rootScope.globalStyleClasses`

**Checkpoint**: User Stories 1 + 2 complete — widths and scheme both survive restart

---

## Phase 5: User Story 3 — Mode Selection Persists (Priority: P3)

**Goal**: Selected mode (edit/view) survives panel close/reopen and VS Code restart.

**Independent Test**: Select mode → close and reopen panel → verify mode retained.

### Implementation for User Story 3

- [x] T017 [US3] `appView` field in `userPreferences` persisted and restored via unified flow
- [x] T018 [US3] `appView` changes trigger `saveUserPreferences` → `sendDisplayConfigChange` → `globalState`
- [x] T019 [US3] On restore, `getUserPreferences` returns saved prefs including `appView` → applied by `applyUserPreferences`

**Checkpoint**: All user stories complete — all 4 config values persist across restart

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T020 [P] N/A — layout uses Bootstrap grid cols (1–12); existing layoutHandler guards enforce min width 2; no pixel clamping needed
- [x] T021 [P] `DisplayConfigStore.load()` has try/catch returning `DEFAULT_DISPLAY_CONFIG` on any error; schema version mismatch also resets to defaults
- [x] T022 Run `npm run build:extension` — passes with no errors in new files
- [x] T023 Manual end-to-end validation per `specs/008-persist-display-config/quickstart.md` — verified: dark scheme saved, persists across panel close/reopen; VS Code background synced to authoring UI panels

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks Phase 3, 4, 5
- **Phase 3 (US1)**: Depends on Phase 2 — MVP deliverable
- **Phase 4 (US2)**: Depends on Phase 2; may integrate with US1 Angular changes but independently testable
- **Phase 5 (US3)**: Depends on Phase 2; independently testable
- **Phase 6 (Polish)**: Depends on all desired stories complete

### Parallel Opportunities

- T001 and T002 (Phase 1) can run in parallel
- T009 (VsCodeService changes) can run in parallel with T006–T008 (extension host changes) within Phase 3
- Phases 4 and 5 can run in parallel with each other after Phase 2 completes

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1 (T001–T002)
2. Complete Phase 2 (T003–T005)
3. Complete Phase 3 (T006–T013)
4. **Validate**: Resize tree-view, restart VS Code, verify width restored
5. Ship or continue to Phase 4

### Incremental Delivery

1. Phase 1 + Phase 2 → foundation ready
2. Phase 3 → widths persist (MVP)
3. Phase 4 → scheme persists
4. Phase 5 → mode persists
5. Phase 6 → hardening

---

## Notes

- `[P]` = different files, no blocking dependencies — safe to run in parallel
- Angular layout component paths (T011–T013, T015–T016, T018–T019) must be confirmed by reading the authoring-ui-vscode source; the tree-view and mode controls may be in split-pane or editor-panel components
- No new npm dependencies required — uses VS Code built-in `globalState` API only
- Angular `vscode.service.ts` must degrade gracefully when `acquireVsCodeApi()` is unavailable (dev browser mode)
