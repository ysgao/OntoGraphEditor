# Tasks: OntoGraph-lite Graph Panel & IPC Bridge

**Input**: Design documents from `specs/002-graph-panel-ipc-bridge/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Repos in scope**:
- `extension/` — OntoGraph Editor VS Code extension
- `apps/OntoGraph-lite/` — companion extension (git submodule)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contracts in place and submodule compile-verified before any story work begins.

- [x] T001 Add `ontograph.focusEntity` to `contributes.commands` in `apps/OntoGraph-lite/package.json` (command exists in code at line 363 of `src/extension.ts` but is missing from manifest — add `{ "command": "ontograph.focusEntity", "title": "OntoGraph: Focus Entity by IRI" }`)
- [x] T002 Create `extension/src/ipcMessages.ts` — copy from `specs/002-graph-panel-ipc-bridge/contracts/ipc-messages.ts`: exports `ConceptFocusMessage`, `GraphNodeSelectMessage`, `IpcMessage`, `isConceptFocus()`, `isGraphNodeSelect()`
- [x] T003 [P] Type-check OntoGraph Editor extension: run `npm run compile` in `extension/` — must pass with zero errors
- [x] T004 [P] Type-check OntoGraph-lite submodule: run `npm run compile` in `apps/OntoGraph-lite/` — must pass with zero errors

**Checkpoint**: Contracts defined, both extensions compile clean — user story work can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extension dependency declaration and the IPC type file must exist before any command wiring.

**⚠️ CRITICAL**: No story work can begin until T002 (ipcMessages.ts) is complete.

- [x] T005 Add `"extensionDependencies": ["ysgao.ontograph-lite"]` to `extension/package.json` — place at top-level alongside `"engines"` field
- [x] T006 Add `import { IpcMessage, isConceptFocus, isGraphNodeSelect } from './ipcMessages';` to `extension/src/extension.ts` (top of file, after existing imports)
- [x] T007 Add `import { IpcMessage } from './ipcMessages';` to `extension/src/authoringPanel.ts` (top of file, after existing imports)

**Checkpoint**: Dependency declared, IPC types imported in both files — ready for story implementation.

---

## Phase 3: User Story 1 — Open OntoGraph-lite Alongside Authoring Workbench (Priority: P1) 🎯 MVP

**Goal**: `ontographEditor.openGraph` command opens OntoGraph-lite's graph panel.

**Independent Test**: With OntoGraph-lite installed, run the extension (F5), invoke "OntoGraph: Open Visualization Display" from command palette — OntoGraph-lite graph panel opens. No authoring panel needed.

### Implementation for User Story 1

- [x] T008 [US1] Register `ontographEditor.openGraph` command in `extension/src/extension.ts` `activate()` function — body: `vscode.commands.executeCommand('ontograph.openGraph').then(undefined, () => { vscode.window.showWarningMessage('OntoGraph: OntoGraph-lite is not installed or not activated.'); })`
- [x] T009 [US1] Verify `ontographEditor.openGraph` is already in `extension/package.json` `contributes.commands` (it is — confirms the manifest entry and handler are aligned; no change needed if present)

**Checkpoint**: User Story 1 complete — "Open Visualization Display" command works independently.

---

## Phase 4: User Story 2 — Concept Focus: Authoring drives All OntoGraph-lite Views (Priority: P1)

**Goal**: `CONCEPT_FOCUS` from authoring panel → Entity Editor shown + tree view revealed + graph panel updated (if open).

**Independent Test**: With both extensions active and an OWL ontology loaded, call `vscode.commands.executeCommand('ontographEditor.ipcRoute', { command: 'CONCEPT_FOCUS', payload: { id: '404684003', label: 'Clinical finding' } })` in the debug console — OntoGraph-lite's Entity Editor and tree view update to that entity.

### Implementation for User Story 2

- [x] T010 [US2] Add `static postMessage(msg: IpcMessage): void` to `extension/src/authoringPanel.ts` — guard: `if (!AuthoringPanel.instance) return;` — body: `AuthoringPanel.instance.panel.webview.postMessage(msg)`
- [x] T011 [US2] Add `suppressNextSelection` boolean flag at the top of the `activate()` closure in `apps/OntoGraph-lite/src/extension.ts` (line ~50, before `function onEntitySelected`): `let suppressNextSelection = false;`
- [x] T012 [US2] Patch `ontograph.focusEntity` command handler in `apps/OntoGraph-lite/src/extension.ts` (line ~363) — after `revealInTreeView(iri, entityType)`, add: set `suppressNextSelection = true` BEFORE calling `revealInTreeView`, then after, call `updateGraphPanel(activeModel, iri, preferredLang)` to update graph if open. Import `updateGraphPanel` from `./commands/openVisualization` (already imported via `openGraphView` import chain — verify and add if not present)
- [x] T013 [US2] Register `ontographEditor.ipcRoute` command in `extension/src/extension.ts` `activate()` — handle `CONCEPT_FOCUS` branch: extract `msg.payload.id` as `sctid`, build IRI as `` `http://snomed.info/id/${sctid}` ``, call `vscode.commands.executeCommand('ontograph.focusEntity', { iri, fromIpc: true }).then(undefined, () => {})` (silent error swallow when OntoGraph-lite absent)
- [x] T014 [US2] Add `extractSctid(iri: string): string | undefined` helper function in `apps/OntoGraph-lite/src/extension.ts` (after `entityTypeForIri`): `const match = /\/id\/(\d+)$/.exec(iri); return match?.[1];`

**Checkpoint**: User Story 2 complete — CONCEPT_FOCUS from authoring panel updates all OntoGraph-lite views. Verify no echo loop by confirming `suppressNextSelection` prevents immediate GRAPH_NODE_SELECT back.

---

## Phase 5: User Story 3 — Entity Selection: Any OntoGraph-lite View drives Authoring Context (Priority: P1)

**Goal**: Selecting any entity in any OntoGraph-lite view → `GRAPH_NODE_SELECT` → authoring panel navigates to concept.

**Independent Test**: With both extensions active, select a class in any OntoGraph-lite tree view — confirm authoring panel receives `GRAPH_NODE_SELECT` by adding a temporary `console.log` in `ontographEditor.ipcRoute`'s `isGraphNodeSelect` branch, or by verifying the authoring panel navigates to the concept.

### Implementation for User Story 3

- [x] T015 [US3] Patch `onEntitySelected` in `apps/OntoGraph-lite/src/extension.ts` (line ~51) — add after existing body: check `if (suppressNextSelection) { suppressNextSelection = false; return; }` at the top of the function, then dispatch: `vscode.commands.executeCommand('ontographEditor.ipcRoute', { command: 'GRAPH_NODE_SELECT', payload: { id: extractSctid(iri) ?? iri } }).then(undefined, () => {})` — this covers all 6 tree view selections in one place
- [x] T016 [US3] Patch `nodeClicked` handler in `apps/OntoGraph-lite/src/commands/openVisualization.ts` (line ~57, replacing `// Nothing for now — could reveal in tree`) — add: `const sctid = /\/id\/(\d+)$/.exec(msg.iri)?.[1]; const id = sctid ?? msg.iri; vscode.commands.executeCommand('ontographEditor.ipcRoute', { command: 'GRAPH_NODE_SELECT', payload: { id } }).then(undefined, () => {})`
- [x] T017 [US3] Complete `ontographEditor.ipcRoute` in `extension/src/extension.ts` — add `isGraphNodeSelect(msg)` branch: `AuthoringPanel.postMessage(msg as IpcMessage)` (adds GRAPH_NODE_SELECT handling alongside the CONCEPT_FOCUS branch from T013)
- [x] T018 [P] [US3] Investigate Entity Editor webview message protocol in `apps/OntoGraph-lite/src/views/` — check `EntityEditorPanel` or equivalent for outbound entity navigation messages (e.g., clicking a related class in axiom view); if found, wire to `ontographEditor.ipcRoute` dispatch in the same file; if no user-navigation event exists, document in `specs/002-graph-panel-ipc-bridge/research.md` as deferred

**Checkpoint**: User Story 3 complete — all tree view selections and graph node clicks drive the authoring panel. Verify no infinite loop by selecting an entity in authoring → confirming OntoGraph-lite updates → confirming authoring panel does NOT receive a second update.

---

## Phase 6: User Story 4 — Unified Command Registration (Priority: P2)

**Goal**: Both commands discoverable in VS Code command palette with clear titles.

**Independent Test**: Open command palette (`Cmd+Shift+P`), type "OntoGraph" — both "OntoGraph: Open Editing Workbench" and "OntoGraph: Open Visualization Display" appear.

### Implementation for User Story 4

- [x] T019 [US4] Verify `ontographEditor.openGraph` title in `extension/package.json` `contributes.commands` reads "OntoGraph: Open Visualization Display" — update if different
- [x] T020 [US4] Verify `ontographEditor.openAuthoring` title reads "OntoGraph: Open Editing Workbench" — update if different

**Checkpoint**: User Story 4 complete — both commands surface cleanly in the command palette.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T021 [P] Run `npm run compile` in `extension/` — zero TypeScript errors
- [x] T022 [P] Run `npm run compile` in `apps/OntoGraph-lite/` — zero TypeScript errors
- [x] T023 F5 debug session — verify all acceptance criteria: (1) openGraph opens OntoGraph-lite panel, (2) CONCEPT_FOCUS updates tree + Entity Editor, (3) tree selection drives authoring panel, (4) graph node click drives authoring panel, (5) no echo loop
- [x] T024 [P] Update `specs/002-graph-panel-ipc-bridge/research.md` — document final `extractSctid` regex pattern and loop prevention flag name for future reference

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on T002 (ipcMessages.ts) — blocks all command wiring
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 2; T012 depends on T011 (flag must exist before patch)
- **Phase 5 (US3)**: Depends on T011 (suppressNextSelection flag) and T013 (ipcRoute registered)
- **Phase 6 (US4)**: Can run in parallel with Phases 3–5 (manifest-only changes)
- **Phase 7 (Polish)**: Depends on all story phases complete

### User Story Dependencies

- **US1**: Depends on Phase 2 — independently testable
- **US2**: Depends on Phase 2 + T010 (postMessage on AuthoringPanel)
- **US3**: Depends on T011 (flag) + T013 (ipcRoute) — both from US2 phase
- **US4**: Independent of other stories (manifest verification only)

### Within Each User Story

- T011 (flag) MUST precede T012 (focusEntity patch) and T015 (onEntitySelected patch)
- T013 (ipcRoute CONCEPT_FOCUS branch) MUST precede T017 (ipcRoute GRAPH_NODE_SELECT branch) — same function, sequential additions
- T002 (ipcMessages.ts) MUST precede T006 and T007 (imports)

---

## Parallel Opportunities

### Phase 1 (after T002)
```
T003 — compile extension/
T004 — compile apps/OntoGraph-lite/
```

### Phase 4 (US2) — after T011
```
T010 — authoringPanel.ts (postMessage method)
T012 — OntoGraph-lite extension.ts (focusEntity patch)   [requires T011]
T014 — OntoGraph-lite extension.ts (extractSctid helper)  [same file as T012 — sequence carefully]
```

### Phase 7 (Polish)
```
T021 — compile extension/
T022 — compile apps/OntoGraph-lite/
T024 — research.md update
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: T001–T004
2. Complete Phase 2: T005–T007
3. Complete Phase 3: T008–T009
4. **STOP and VALIDATE**: "Open Visualization Display" command opens OntoGraph-lite
5. Proceed to US2/US3 for full IPC bridge

### Full Bridge Delivery

1. Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
2. US2 and US3 are tightly coupled (share `suppressNextSelection` flag and `ipcRoute` command) — implement sequentially
3. US4 (manifest verification) can be done at any point in parallel

---

## Notes

- `suppressNextSelection` flag MUST be in the same closure scope as `onEntitySelected` in `apps/OntoGraph-lite/src/extension.ts`
- `updateGraphPanel` is already exported from `apps/OntoGraph-lite/src/commands/openVisualization.ts` — import it in `focusEntity` handler (T012)
- `extractSctid` helper (T014) must be defined BEFORE `onEntitySelected` (T015) references it
- All `vscode.commands.executeCommand('ontographEditor.ipcRoute', ...)` calls from OntoGraph-lite MUST use `.then(undefined, () => {})` — OntoGraph Editor may not be installed
- Entity Editor wiring (T018) is exploratory — may result in a deferred task if no outbound selection events exist
