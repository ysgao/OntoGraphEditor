# Tasks: Upstream Submodule Sync Workflow

**Input**: Design documents from `specs/004-upstream-sync/`

**Available docs**: plan.md, spec.md, research.md, data-model.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 = sync authoring-ui-vscode, US2 = sync OntoGraph-lite, US3 = build verification)
- No test tasks — none requested in spec

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configure git remotes and create directory scaffolding needed by all user stories

- [x] T001 Configure `upstream` remote inside `apps/authoring-ui-vscode` pointing to `https://github.com/IHTSDO/authoring-ui` (run `git remote add upstream https://github.com/IHTSDO/authoring-ui` inside the submodule; verify with `git remote -v`)
- [x] T002 [P] Verify `apps/OntoGraph-lite` has `origin` remote configured (run `cd apps/OntoGraph-lite && git remote -v`; document result)
- [x] T003 [P] Create `scripts/` directory at repo root for maintenance tooling

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pre-merge conflict check script must exist before US1 merge steps can be safely executed

**⚠️ CRITICAL**: US1 Step 1.3 (pre-merge check) depends on T004 being complete

- [x] T004 Implement `scripts/check-upstream-conflicts.sh` — bash script that accepts a remote/branch argument, diffs it against the customization-scope file allowlist (`src/app/core/services/vscode*.ts`, `src/app/app.module.ts`, `src/app/app-routing.module.ts`), and prints a WARNING for each overlapping file; exits 0 if clean, exits 1 if any customization-scope file is touched
- [x] T005 Make `scripts/check-upstream-conflicts.sh` executable (`chmod +x scripts/check-upstream-conflicts.sh`) and run a smoke test against `upstream/master` from `apps/authoring-ui-vscode` to confirm output format

**Checkpoint**: Script operational — US1 implementation can now begin

---

## Phase 3: User Story 1 — Sync authoring-ui-vscode with IHTSDO Upstream (Priority: P1) 🎯 MVP

**Goal**: Maintainer can safely fetch and merge IHTSDO upstream changes without losing VS Code customizations

**Independent Test**: Run `cd apps/authoring-ui-vscode && git fetch upstream && ../../scripts/check-upstream-conflicts.sh upstream/master` — script must report green; then run `git merge --no-commit --no-ff upstream/master`, confirm `vscode.service.ts`, `app.module.ts`, `app-routing.module.ts` are unchanged, then `git merge --abort`

- [x] T006 [US1] Fetch upstream and run pre-merge check: `cd apps/authoring-ui-vscode && git fetch upstream && ../../scripts/check-upstream-conflicts.sh upstream/master` — verify exit code and output
- [x] T007 [US1] Perform dry-run merge in `apps/authoring-ui-vscode`: `git merge --no-commit --no-ff upstream/master` — inspect that customization-scope files are untouched, then abort with `git merge --abort`
- [x] T008 [US1] Update `specs/004-upstream-sync/quickstart.md` Step 1.3 to include `scripts/check-upstream-conflicts.sh` invocation with correct relative path from submodule root

**Checkpoint**: US1 fully functional — maintainer can safely sync authoring-ui-vscode

---

## Phase 4: User Story 2 — Sync OntoGraph-lite with Origin (Priority: P1)

**Goal**: Maintainer can pull latest OntoGraph-lite commits and have the submodule pointer updated in the root repo

**Independent Test**: `cd apps/OntoGraph-lite && git fetch origin && git merge origin/master` succeeds; `cd ../.. && git status` shows modified submodule pointer for `apps/OntoGraph-lite`

- [x] T009 [US2] Fetch and merge OntoGraph-lite: `cd apps/OntoGraph-lite && git fetch origin && git merge origin/main` — confirm clean merge and submodule HEAD advances
- [x] T010 [US2] Verify root repo detects submodule pointer change: `cd ../.. && git status` must show `apps/OntoGraph-lite` as modified

**Checkpoint**: US2 complete — both submodules synced

---

## Phase 5: User Story 3 — Build Verification After Sync (Priority: P2)

**Goal**: Maintainer runs a single command to confirm the unified build passes after both submodule syncs

**Independent Test**: `npm run build-all` from repo root exits 0 and produces `extension/dist/` bundle

- [x] T011 [US3] Run `npm run build-all` from repo root after both submodule syncs complete — confirm exit code 0 and `extension/dist/` contains valid bundle
- [x] T012 [US3] Commit updated submodule pointers and remote config from repo root: `git add apps/authoring-ui-vscode apps/OntoGraph-lite && git commit -m "chore: sync upstream submodules $(date +%Y-%m-%d)"`

**Checkpoint**: Build verified — extension is ready for release consideration

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: In-repo discoverability of runbook and updated agent context

- [x] T013 [P] Create `docs/maintenance/upstream-sync.md` mirroring `specs/004-upstream-sync/quickstart.md` content (copy and adjust any spec-relative paths to be repo-root-relative)
- [x] T014 [P] Update `CLAUDE.md` Syncing Submodules section to add reference to `docs/maintenance/upstream-sync.md` runbook and `scripts/check-upstream-conflicts.sh`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately; T002 and T003 can run in parallel with T001
- **Foundational (Phase 2)**: Depends on T001 (upstream remote must exist for smoke test in T005)
- **US1 (Phase 3)**: Depends on T004 + T005 (check script must be functional)
- **US2 (Phase 4)**: Depends only on T002 — can start independently of US1 after Phase 1
- **US3 (Phase 5)**: Depends on US1 + US2 both complete
- **Polish (Phase 6)**: Depends on all user stories complete; T013 and T014 can run in parallel

### User Story Dependencies

- **US1 (P1)**: Requires Phase 1 + Phase 2 (upstream remote + check script)
- **US2 (P1)**: Requires Phase 1 only (origin remote check); can run in parallel with US1 after Phase 2
- **US3 (P2)**: Requires both US1 and US2 complete

---

## Parallel Example: Phase 1

```bash
# These can run simultaneously:
Task T001: Configure upstream remote in apps/authoring-ui-vscode
Task T002: Verify apps/OntoGraph-lite origin remote
Task T003: Create scripts/ directory
```

## Parallel Example: US1 + US2 after Phase 2

```bash
# Once Phase 2 complete, run concurrently:
Developer A: US1 tasks (T006 → T007 → T008)
Developer B: US2 tasks (T009 → T010)
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T005)
3. Complete Phase 3: US1 (T006–T008)
4. **STOP and VALIDATE**: Confirm customization files survive dry-run merge

### Full Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Authoring-ui sync workflow verified
3. US2 → OntoGraph-lite sync verified (can parallel with US1)
4. US3 → Unified build gate confirmed
5. Polish → Runbook published in `docs/`, CLAUDE.md updated

---

## Notes

- [P] tasks = different files/targets, no blocking dependencies
- T004 (check script) is the only net-new source artifact — all other tasks are git operations or documentation
- T007 dry-run merge uses `--no-commit --no-ff` to simulate without committing; always abort after inspection
- Customization scope allowlist defined in `specs/004-upstream-sync/data-model.md`
