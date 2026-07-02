# Tasks: Pull Upstream Changes into OntoGraph-lite Fork

**Input**: Design documents from `specs/010-pull-upstream-merge/`
**Branch**: `010-pull-upstream-merge`
**Runbook**: See `quickstart.md` for command reference

**Note**: This is a git maintenance operation. Tasks are sequential shell steps with verifiable outcomes. No code is authored — the upstream commits are incorporated as-is via merge.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different concerns, no dependency)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup (Prerequisites)

**Purpose**: Confirm environment and remotes are ready before any git operations.

- [x] T001 Verify `upstream` remote exists in `apps/OntoGraph-lite` (`git remote -v | grep upstream`)
- [x] T002 Verify working tree is clean in `apps/OntoGraph-lite` (`git status`)
- [x] T003 [P] Confirm push access to `origin main` (ysgao/OntoGraph-lite-vscode)
- [x] T004 [P] Confirm push access to parent repo `master` (ysgao/OntoGraphEditor)

**Checkpoint**: Remotes configured, working tree clean, push access confirmed.

---

## Phase 2: Foundational (Divergence Analysis)

**Purpose**: Characterise the gap between fork and upstream before executing any merge. These checks BLOCK the merge — if either fails unexpectedly, stop and investigate.

**⚠️ CRITICAL**: Both checks must pass before Phase 3 begins.

- [x] T005 Fetch latest upstream: `git fetch upstream` in `apps/OntoGraph-lite`
- [x] T006 Confirm upstream commits exist: `git log --oneline main..upstream/main` — must return non-empty output (at least 1 commit); if empty the fork is already in sync, STOP
- [x] T006b [P] Check file overlap: `git diff --name-only main upstream/main` — record any files that also appear in the fork's customized set (IPC bridge, entity sync, stale-save fix); if overlap found, review each with `git diff main upstream/main -- <file>` before T008
- [x] T007 Confirm no fork-only commits: `git log --oneline upstream/main..main` — must return empty output; if commits appear, document them before proceeding

**Checkpoint**: Upstream commits confirmed, file-overlap reviewed, 0 fork-only commits confirmed — fast-forward merge is safe.

---

## Phase 3: User Story 1 — Sync Fork with Upstream (Priority: P1) 🎯 MVP

**Goal**: Bring `origin/main` (fork) fully in sync with `upstream/main` by fast-forward merge and push.

**Independent Test**: `git log --oneline main..upstream/main` returns 0 lines after push (SC-001).

- [x] T008 [US1] Execute merge in `apps/OntoGraph-lite`: `git merge upstream/main` — expect `Fast-forward` output, no conflict markers; capture post-merge SHA: `git rev-parse HEAD` (used in T019/T025)
- [x] T009 [US1] Run test suite: `npm test` in `apps/OntoGraph-lite` — all pre-existing passing tests must still pass; fixture-file failures in Phase2/3/4 tests are pre-existing and acceptable
- [x] T010 [US1] Push updated fork: `git push origin main` — must succeed without `--force`; if rejected, stop and investigate (do NOT force-push)
- [x] T011 [US1] Verify SC-001: `git log --oneline main..upstream/main` must return empty output

**Checkpoint**: Fork is in sync with upstream. SC-001 satisfied.

---

## Phase 4: User Story 2 — Verify VS Code Customization Integrity (Priority: P2)

**Goal**: Confirm that no VS Code-specific code was lost during the merge.

**Independent Test**: Key fork-customized sections are present in `apps/OntoGraph-lite/src/views/EntityEditorPanel.ts` (bypassHistory param, `sendLoadEntity` signature with 4 params).

**Context**: Research confirmed zero conflicts (fork is strict ancestor of upstream), so this phase is verification-only — no manual conflict resolution expected.

- [x] T012 [P] [US2] Verify `bypassHistory` parameter in `apps/OntoGraph-lite/src/views/EntityEditorPanel.ts` (`grep bypassHistory src/views/EntityEditorPanel.ts`)
- [x] T013 [P] [US2] Verify `sendLoadEntity` signature accepts 4 params in `apps/OntoGraph-lite/src/views/EntityEditorPanel.ts`
- [x] T014 [P] [US2] Verify `apps/OntoGraph-lite/src/views/EntityEditHistory.ts` is present and unchanged (`git show HEAD:src/views/EntityEditHistory.ts | head -5`)
- [x] T015 [US2] Confirm SC-002: no pre-merge VS Code additions have been removed (review `git diff origin/main@{1}..HEAD -- src/views/EntityEditorPanel.ts` for any deleted VS Code blocks)

**Checkpoint**: VS Code customizations intact. SC-002 satisfied.

---

## Phase 5: User Story 3 — Bump Submodule Pointer and Verify Parent Build (Priority: P3)

**Goal**: Update the parent `OntoGraphEditor` repo's submodule reference to the newly merged fork HEAD and confirm the unified build passes.

**Independent Test**: `git submodule status` in parent repo shows the new SHA; `npm run build-all` exits `0`.

- [x] T016 [US3] Navigate to parent repo root: `cd ../..` (from `apps/OntoGraph-lite/`) or use the repo root directly
- [x] T017 [US3] Stage the submodule pointer update: `git add apps/OntoGraph-lite`
- [x] T018 [US3] Commit the bump in parent repo: `git commit -m "chore: bump OntoGraph-lite submodule — sync upstream features 015-023"`
- [x] T019 [US3] Verify SC-004: `git submodule status` shows the post-merge SHA captured in T008 (must differ from the pre-merge SHA)
- [x] T020 [US3] Run unified build: `npm run build-all` from parent repo root — must exit code `0` (SC-003)
- [x] T021 [US3] Push parent repo: `git push origin master`

**Checkpoint**: Submodule pointer updated, parent build passes, parent repo pushed. SC-003 and SC-004 satisfied.

---

## Phase 6: Final Verification

**Purpose**: Confirm all success criteria are met end-to-end.

- [x] T022 [P] Verify SC-001: `git -C apps/OntoGraph-lite log --oneline main..upstream/main` returns empty
- [x] T023 [P] Verify SC-002: VS Code customization sections present in `EntityEditorPanel.ts`
- [x] T024 [P] Verify SC-003: record exit code of the `npm run build-all` run from T020
- [x] T025 [P] Verify SC-004: `git submodule status` shows the post-merge SHA captured in T008 (must differ from the pre-merge SHA)
- [x] T026 Verify SC-005: confirm no `--force` push was used at any step (review shell history or task notes)

**Checkpoint**: All 5 success criteria satisfied. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — **blocks Phase 3**
- **US1 (Phase 3)**: Depends on Phase 2 — execute merge only after divergence analysis passes
- **US2 (Phase 4)**: Depends on Phase 3 completion (merge must be done before verification)
- **US3 (Phase 5)**: Depends on Phase 3 + Phase 4 (submodule bump only after fork is confirmed clean)
- **Final Verification (Phase 6)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational only — this is the core deliverable
- **US2 (P2)**: Depends on US1 — verification runs after merge
- **US3 (P3)**: Depends on US1 + US2 — parent bump runs after fork is confirmed clean

### Within Each Phase

- Steps are sequential (each git command depends on the previous state)
- Tasks marked [P] within a phase have independent concerns and can be spot-checked simultaneously

### Parallel Opportunities

- T003 and T004 (push access checks) can run in parallel
- T012, T013, T014 (integrity checks) can run in parallel — different files, independent greps
- T022–T025 (final success-criteria checks) can all run in parallel

---

## Parallel Example: Phase 4 (US2 Integrity Checks)

```bash
# All three file checks can run simultaneously:
grep bypassHistory apps/OntoGraph-lite/src/views/EntityEditorPanel.ts
grep "bypassHistory = false" apps/OntoGraph-lite/src/views/EntityEditorPanel.ts
git -C apps/OntoGraph-lite show HEAD:src/views/EntityEditHistory.ts | head -5
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1: Prerequisites
2. Complete Phase 2: Divergence analysis
3. Complete Phase 3: Merge + test + push fork
4. **STOP and VALIDATE**: SC-001 satisfied — fork is in sync

### Full Delivery (all stories)

1. Phases 1–3: Fork merged and pushed (US1 ✅)
2. Phase 4: VS Code integrity confirmed (US2 ✅)
3. Phase 5: Parent repo bumped, build passes (US3 ✅)
4. Phase 6: All 5 SCs verified (complete ✅)

---

## Notes

- All git commands in Phases 1–4 run inside `apps/OntoGraph-lite/`
- All git commands in Phase 5 run from the parent repo root (`/Users/yoga/OntoGraphEditor`)
- Fixture-file failures in `npm test` (ENOENT for `animals.ttl` etc.) are pre-existing and do not indicate a regression
- Do NOT use `--force` or `--force-with-lease` at any step without explicit user confirmation
- If T007 finds unexpected fork-only commits, pause and document before continuing
