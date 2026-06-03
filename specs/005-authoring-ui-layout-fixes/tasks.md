# Tasks: Authoring UI Layout Fidelity Fixes

**Input**: Design documents from `specs/005-authoring-ui-layout-fixes/`

**Available docs**: plan.md, spec.md, research.md, data-model.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = hide diagram / expand edit, US2 = right-edge alignment, US3 = overall parity
- No test tasks — visual comparison is the acceptance gate (quickstart.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Body-class injection and override stylesheet scaffold — required by all three user stories

- [x] T001 Add inline body-class injection script to `apps/authoring-ui-vscode/app/index.html` — insert `<script>if(typeof acquireVsCodeApi!=='undefined'){document.body.classList.add('vscode-webview');}</script>` immediately before `</head>` so the class is present before any CSS applies
- [x] T002 Create `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss` as an empty file with a comment block header identifying it as the VS Code webview layout override stylesheet
- [x] T003 Add `<link rel="stylesheet" href="styles/vscode-overrides.css">` to `apps/authoring-ui-vscode/app/index.html` inside the `<head>` after all other stylesheet links so overrides take effect last

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core body/container resets that affect all layout defects — must be in place before story-specific rules

**⚠️ CRITICAL**: All three user stories depend on the body padding reset below

- [x] T004 Add body/container reset rules to `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss`:
  ```scss
  /* VS Code webview body reset — removes default 8px/20px webview padding */
  .vscode-webview body {
    padding: 0 !important;
    margin: 0 !important;
    box-sizing: border-box;
  }
  .vscode-webview *,
  .vscode-webview *::before,
  .vscode-webview *::after {
    box-sizing: inherit;
  }
  .vscode-webview .sca-container {
    width: 100%;
    box-sizing: border-box;
  }
  ```
- [x] T005 Build the authoring-ui app to verify `vscode-overrides.css` is generated in `.tmp/styles/` — run `grunt sass` (or equivalent) inside `apps/authoring-ui-vscode/` and confirm no compilation errors

**Checkpoint**: Override stylesheet compiles successfully — story implementations can now begin

---

## Phase 3: User Story 1 — Hide Diagram / Expand Edit Column (Priority: P1) 🎯 MVP

**Goal**: When the user clicks "Hide all concept models", the diagram disappears and the edit column expands to fill 100% of the panel width

**Independent Test**: Click "Hide all concept models" button in button-nav → diagram disappears → edit column fills panel edge-to-edge (no right gap, no left gap)

- [x] T006 [US1] Add button-nav top offset fix to `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss`:
  ```scss
  /* button-nav: top: 64px assumes browser chrome; webview has no chrome */
  .vscode-webview .button-nav {
    top: 0px;
  }
  ```
- [x] T007 [US1] Add edit-no-model full-width expansion rules to `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss`:
  ```scss
  /* edit-no-model: pull-right float prevents 100% fill in webview */
  .vscode-webview .edit-no-model > div[ng-class],
  .vscode-webview .edit-no-model > .pull-right {
    float: none !important;
    width: 100% !important;
    padding: 0;
  }
  ```
- [ ] T008 [US1] Verify in VS Code Extension Development Host (F5): click "Hide all concept models" in button-nav → confirm edit column fills full panel width per Test 3 in `specs/005-authoring-ui-layout-fixes/quickstart.md`

**Checkpoint**: US1 complete — diagram hide/expand works in webview

---

## Phase 4: User Story 2 — Edit Column Right-Edge Alignment (Priority: P1)

**Goal**: The editing column (grey background) extends flush to the right panel edge at all widths

**Independent Test**: With default view visible, inspect right edge of grey edit column at 600px, 900px, and 1200px panel widths — zero whitespace gap in all cases

- [x] T009 [US2] Add modelsConceptsView pull-right override to `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss`:
  ```scss
  /* modelsConceptsView pull-right + Bootstrap col leaves right gap in webview */
  .vscode-webview .modelScrollBox.pull-right {
    float: none !important;
    width: 100% !important;
  }
  .vscode-webview .row.no-gutter {
    width: 100%;
  }
  ```
- [ ] T010 [US2] Verify in VS Code Extension Development Host: resize panel to 600px, 900px, 1200px — confirm grey edit column reaches right edge with zero gap per Test 2 in `specs/005-authoring-ui-layout-fixes/quickstart.md`

**Checkpoint**: US2 complete — right-edge alignment fixed

---

## Phase 5: User Story 3 — Overall Display Parity with Original Web App (Priority: P2)

**Goal**: Side-by-side comparison with original browser app shows no visible layout discrepancies in header, editing columns, or side panels

**Independent Test**: Open original IHTSDO app in browser at 900px width alongside VS Code panel at same width — all 3 primary layout regions match visually

- [ ] T011 [US3] Conduct side-by-side visual audit: open original web app at 900px and VS Code panel at 900px — note any remaining discrepancies beyond button-nav offset and right-edge gap (document in a comment at bottom of `vscode-overrides.scss`)
- [x] T012 [US3] For each discrepancy found in T011, add a targeted `.vscode-webview`-scoped CSS rule to `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss` — limit to layout/spacing differences only (not colour or typography changes)
- [ ] T013 [US3] Verify per Test 5 in `specs/005-authoring-ui-layout-fixes/quickstart.md`: create a concept, edit a field, save — confirm all authoring controls work correctly in all layout states after CSS overrides are applied

**Checkpoint**: US3 complete — visual parity confirmed, no functional regressions

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T014 [P] Run `npm run build-all` from repo root — confirm full build passes with new SCSS file included
- [ ] T015 [P] Verify tab-switch state preservation per Test 4 in `specs/005-authoring-ui-layout-fixes/quickstart.md`: hide diagram → switch tab → return → diagram still hidden
- [x] T016 Add completion comment block to `apps/authoring-ui-vscode/app/styles/vscode-overrides.scss` listing each override rule with the bug it fixes and its root cause (reference research.md findings)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001, T002, T003 must run in order (T002 before T003)
- **Foundational (Phase 2)**: Depends on T002 (file must exist before writing rules)
- **US1 (Phase 3)**: Depends on Phase 2 complete (body reset must be in place)
- **US2 (Phase 4)**: Depends on Phase 2 complete; can run in parallel with US1
- **US3 (Phase 5)**: Depends on US1 + US2 both verified
- **Polish (Phase 6)**: T014 and T015 can run in parallel after US3; T016 last

### User Story Dependencies

- **US1 (P1)**: Foundational resets + button-nav fix + edit-no-model fix
- **US2 (P1)**: Foundational resets + modelScrollBox/row fix — independent of US1
- **US3 (P2)**: Requires US1 + US2 complete (visual audit needs both fixes in place)

---

## Parallel Example: US1 + US2 (after Phase 2)

```bash
# Once Phase 2 checkpoint passes:
Developer A: T006 → T007 → T008  (US1: diagram toggle)
Developer B: T009 → T010          (US2: right-edge alignment)
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T005)
3. Complete Phase 3: US1 (T006–T008)
4. **STOP and VALIDATE**: Confirm diagram toggle works and edit column fills width

### Full Delivery

1. Setup + Foundational → stylesheet scaffolded and compiling
2. US1 → diagram toggle works in webview (MVP)
3. US2 → right-edge gap fixed (can parallel with US1)
4. US3 → visual audit + parity confirmed
5. Polish → full build passes, tab-switch verified

---

## Notes

- All CSS rules MUST be scoped to `.vscode-webview` — never bare selectors that would affect standard browser execution
- T008, T010, T013, T015 are manual verification steps requiring VS Code Extension Development Host (F5)
- `vscode-overrides.scss` is the single deliverable source file — keep all rules in one place for easy upstream merge review
- Bootstrap `col-md-*` classes are not removed from HTML — only CSS float/width overrides applied in webview mode
