# Tasks: Extension Packaging and Marketplace Publication

**Input**: Design documents from `specs/003-extension-publish/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/jre-detector-interface.ts ✅

**Tests**: Not explicitly requested in spec. Checklist steps serve as acceptance validation.

**Organization**: Tasks grouped by user story. US2 (VSIX packaging) and US3 (JRE detection) can be implemented independently. US4 (CI/CD) depends on US2 completion. US1 companion action can be implemented in parallel with US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: User story from spec.md (US1–US4)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install tooling and create placeholder assets required before any packaging or code task can proceed

- [x] T001 Add `"@vscode/vsce": "^3.0.0"` to `devDependencies` in `extension/package.json`
- [x] T002 Create `extension/assets/` directory and add a 128×128 PNG placeholder as `extension/assets/icon.png`

---

## Phase 2: User Story 2 — Developer Produces Distributable VSIX (Priority: P1) 🎯 MVP

**Goal**: A single `npm run package:vsix` command from the repo root produces a self-contained `.vsix` file containing all required runtime assets.

**Independent Test**: Run `npm run build:extension` then `npm run package:vsix` from repo root. Verify `extension/dist/ontograph-editor-extension-1.0.0.vsix` is produced and its file size is under 50 MB. Install the VSIX via VS Code "Install from VSIX…" on a clean instance and verify both `OntoGraph: Open Editing Workbench` and `OntoGraph: Open Visualization Display` commands are registered.

- [x] T003 [US2] Update `extension/package.json`: set `"version": "1.0.0"`, add `"description": "Unified SNOMED CT ontology authoring and visualization environment for VS Code — pairs the AuthoringUI editing workbench with OntoGraph-lite graph visualization."`, set `"categories": ["Education", "Other"]`, set `"icon": "assets/icon.png"`, add `"repository": { "type": "git", "url": "<actual GitHub remote URL>" }`
- [x] T004 [P] [US2] Add `"package:vsix": "vsce package --out dist/"` to `scripts` in `extension/package.json`
- [x] T005 [P] [US2] Add `"package:vsix": "npm run package:vsix --prefix extension"` to `scripts` in root `package.json`
- [x] T006 [US2] Create `extension/.vscodeignore` excluding: workspace root `../` paths (apps, specs, node_modules, .git, .claude, .vscode, .github, markdown files), extension src/out/node_modules, TypeScript source and source maps, test files, build config
- [x] T007 [US2] Run `npm run build:extension` to confirm `extension/dist/extension.js` exists, then run `npm run package:vsix` from repo root and verify `.vsix` produced in `extension/dist/` with file size under 50 MB

**Checkpoint**: VSIX produced and installs cleanly — User Story 2 independently complete

---

## Phase 3: User Story 3 — Runtime Dependency Validation at Activation (Priority: P2)

**Goal**: Extension detects JRE 21+ at activation and shows an actionable error notification if missing or incompatible.

**Independent Test**: Activate the extension in the Extension Development Host (F5) with no JRE on PATH. Verify `vscode.window.showErrorMessage` notification appears within 3 seconds with "Install Java" action button. Activate with JRE 21+ present — verify no notification.

- [x] T008 [US3] Create `extension/src/jreDetector.ts` implementing the `IJreDetector` contract from `specs/003-extension-publish/contracts/jre-detector-interface.ts`: `detect()` calls `child_process.spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 3000 })`, parses major version from stderr using regex `/version "(\d+)/`, handles ENOENT (not found), timeout, and unexpected output gracefully — returns `JreDetectionResult` and never throws
- [x] T009 [US3] Modify `extension/src/extension.ts` `activate()`: import `JreDetector` from `./jreDetector` and `MINIMUM_JRE_MAJOR`, `JRE_DOWNLOAD_URL` from the contract; call `new JreDetector().detect()` at the start of `activate()`; if `!result.compatible`, call `vscode.window.showErrorMessage(message, 'Install Java')` where message is `"OntoGraph Editor requires Java 21 or later."` (not found) or `"OntoGraph Editor requires Java 21+. Found Java ${result.major}."` (incompatible); on button click open `vscode.Uri.parse(JRE_DOWNLOAD_URL)` via `vscode.env.openExternal`

**Checkpoint**: JRE detection fires at activation — error notification visible within 3s when JRE absent or below v21

---

## Phase 4: User Story 1 — Companion Extension Install Action (Priority: P1)

**Goal**: When OntoGraph-lite is not installed and the user invokes "Open Visualization Display", the warning notification offers a one-click "Install OntoGraph-lite" button.

**Independent Test**: Uninstall `ysgao.ontograph-lite`. Invoke `ontographEditor.openGraph`. Verify the warning notification shows with an "Install OntoGraph-lite" button. Click the button — VS Code Marketplace install flow opens for `ysgao.ontograph-lite`.

- [x] T010 [US1] Modify the `ontographEditor.openGraph` error handler in `extension/src/extension.ts`: change the `.then(undefined, () => { vscode.window.showWarningMessage(...) })` callback to call `vscode.window.showWarningMessage('OntoGraph: OntoGraph-lite is not installed or not activated.', 'Install OntoGraph-lite').then(selection => { if (selection === 'Install OntoGraph-lite') { vscode.commands.executeCommand('workbench.extensions.installExtension', 'ysgao.ontograph-lite'); } })`

**Checkpoint**: Warning with "Install OntoGraph-lite" action appears when companion is absent

---

## Phase 5: User Story 4 — Automated Release Pipeline (Priority: P3)

**Goal**: Pushing a version tag triggers a GitHub Actions pipeline that builds, tests, packages, and publishes the extension to the VS Code Marketplace automatically.

**Independent Test**: Push a `v1.0.0` tag to the repository. Verify the GitHub Actions workflow runs all stages (checkout, build Angular, build extension, test, package, publish) without error. Confirm the new version appears on the VS Code Marketplace listing.

- [x] T011 [US4] Create `.github/workflows/release.yml` with trigger `on: push: tags: ['v*.*.*']` and a single `release` job on `ubuntu-latest` containing steps: `actions/checkout@v4` (with: submodules: recursive), `actions/setup-node@v4` (with: node-version: '18', cache: 'npm'), `npm ci`, `npm ci --prefix extension`, `npm run build:client`, `npm run build:extension`, `npm test`, `HaaLeo/publish-vscode-extension@v1` (with: pat: `${{ secrets.VSCE_PAT }}`, registryUrl: `https://marketplace.visualstudio.com`, packagePath: `extension`)

**Checkpoint**: Tag push triggers pipeline end-to-end — marketplace listing updated automatically

---

## Phase 6: Polish and Cross-Cutting Concerns

**Purpose**: Final validation and any size/cleanup adjustments after all user stories complete

- [x] T012 [P] Verify final `.vsix` file size is under 50 MB; if over, audit `extension/.vscodeignore` for additional large paths (e.g., `apps/OntoGraph-lite/ontologies/**`) and add exclusions
- [ ] T013 [P] Replace placeholder `extension/assets/icon.png` with a final-quality 128×128 PNG icon before public release
- [x] T014 Verify `extension/package.json` `"repository"` field matches the actual GitHub remote URL (`git remote get-url origin`)
- [x] T015 Run quickstart.md end-to-end: package VSIX locally, install on clean VS Code instance, verify both commands and JRE notification behave as specified

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US2)**: Depends on Phase 1 (needs `@vscode/vsce` devDep and icon asset)
- **Phase 3 (US3)**: Depends on Phase 1 only — can run in parallel with Phase 2
- **Phase 4 (US1)**: Depends on Phase 1 only — can run in parallel with Phase 2 and 3
- **Phase 5 (US4)**: Depends on Phase 2 (needs working VSIX packaging before CI publishes)
- **Phase 6 (Polish)**: Depends on Phases 2–5 all complete

### User Story Dependencies

- **US2 (P1 — VSIX packaging)**: Phase 1 complete. No dependency on other stories.
- **US3 (P2 — JRE detection)**: Phase 1 complete. Fully independent of US2.
- **US1 (P1 — Companion action)**: Phase 1 complete. Only touches `extension.ts` — independent of US2/US3.
- **US4 (P3 — CI/CD)**: Requires US2 packaging to work. Pipeline publishes the VSIX.

### Within Each Phase

- T004 and T005 (scripts) are parallel — different files
- T008 (jreDetector.ts) must complete before T009 (extension.ts modification)
- T010 (openGraph modification) is independent of T008/T009 — different handler in same file but no shared state

### Parallel Opportunities

After Phase 1 completes:
- **Thread A**: T003 → T004+T005 (parallel) → T006 → T007 (US2 VSIX pipeline)
- **Thread B**: T008 → T009 (US3 JRE detection)
- **Thread C**: T010 (US1 companion action, single task)

---

## Parallel Example: After Phase 1

```
# Thread A — VSIX packaging (US2):
T003: Update extension/package.json metadata
T004+T005: Add package:vsix scripts to extension and root package.json (parallel)
T006: Create extension/.vscodeignore
T007: Validate VSIX build produces file under 50 MB

# Thread B — JRE detection (US3):
T008: Create extension/src/jreDetector.ts
T009: Modify extension/src/extension.ts activate()

# Thread C — Companion action (US1):
T010: Modify extension/src/extension.ts openGraph handler
```

---

## Implementation Strategy

### MVP First (US2 Only — VSIX Packaging)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: US2 VSIX packaging (T003–T007)
3. **STOP and VALIDATE**: Verify `.vsix` installs cleanly on clean VS Code instance
4. Ship/demo the packaged extension

### Incremental Delivery

1. Phase 1 + Phase 2 → VSIX producible locally (US2 complete)
2. Add Phase 3 → JRE error notification at activation (US3 complete)
3. Add Phase 4 → Companion install button (US1 complete)
4. Add Phase 5 → CI/CD auto-publish on version tag (US4 complete)
5. Phase 6 polish → Production-ready release

### Single Developer Order

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015

---

## Notes

- T007 is a validation-only task — run after T003–T006 to confirm the build works before writing any code
- T009 modifies `extension/src/extension.ts`; T010 also modifies the same file — implement sequentially to avoid conflicts
- `VSCE_PAT` GitHub secret must be configured before T011 (CI pipeline) can be tested end-to-end
- `ysgao.ontograph-lite` must be published to marketplace before T010 companion action can be fully tested; can be verified in Extension Development Host with a locally-installed copy
- Icon placeholder (T002) is required before `vsce package` succeeds — the manifest references `assets/icon.png` after T003
