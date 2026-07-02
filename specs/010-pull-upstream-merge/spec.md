# Feature Specification: Pull Upstream Changes into OntoGraph-lite Fork

**Feature Branch**: `010-pull-upstream-merge`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Pull changes from upstream and resolve the merge conflicts by following the spec @PullUpstreamChanges.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync fork with upstream changes (Priority: P1)

The repository maintainer wants to bring the OntoGraph-lite fork up to date with new commits from the upstream `ysgao/OntoGraph-lite` repository, without losing any VS Code-specific customizations (IPC bridge, entity sync, stale-save fix).

**Why this priority**: This is the core task. Without it, the fork drifts away from upstream improvements.

**Independent Test**: Can be fully tested by confirming that `git log --oneline main..upstream/main` returns 0 results after the merge, and the fork's custom files remain intact.

**Acceptance Scenarios**:

1. **Given** upstream has commits not yet in the fork, **When** the maintainer runs `git fetch upstream && git merge upstream/main`, **Then** the fork's `main` branch includes all upstream commits.
2. **Given** upstream changes do not overlap with fork-customized files, **When** the merge runs, **Then** it completes without conflicts.
3. **Given** the fork is already up to date, **When** the maintainer checks `git log --oneline main..upstream/main | wc -l`, **Then** the result is `0` and no merge is needed.

---

### User Story 2 - Identify and resolve conflicts in custom files (Priority: P2)

If upstream has modified the same files as the fork's VS Code customizations (IPC bridge, entity sync handlers, stale-save fix), the maintainer needs to resolve those conflicts correctly: preserving fork additions while incorporating upstream structural changes.

**Why this priority**: Incorrect conflict resolution would silently drop VS Code integration, causing runtime regressions.

**Independent Test**: Can be tested independently by deliberately creating a conflict in a custom file, merging, and verifying the VS Code-specific code remains present after resolution.

**Acceptance Scenarios**:

1. **Given** upstream and fork have both modified the same file, **When** the merge produces a conflict, **Then** the maintainer resolves it by keeping fork (`HEAD`) code and incorporating only structural/surrounding changes from upstream.
2. **Given** conflicts have been resolved, **When** the build is run (`npm run build-all`), **Then** it succeeds with no errors.

---

### User Story 3 - Update submodule pointer in parent repo (Priority: P3)

After syncing the OntoGraph-lite fork, the parent `OntoGraphEditor` repository must update its submodule reference to point at the new fork commit.

**Why this priority**: Without this step, the parent repo still builds from the old submodule SHA.

**Independent Test**: Can be tested by confirming `git submodule status` in the parent repo shows the updated SHA, and `npm run build-all` succeeds.

**Acceptance Scenarios**:

1. **Given** the fork's `main` branch has been updated and pushed, **When** the maintainer runs `git add apps/OntoGraph-lite && git commit` in the parent repo, **Then** `git submodule status` reflects the new SHA.
2. **Given** the submodule pointer is updated, **When** `npm run build-all` is run from the parent repo root, **Then** the build completes successfully.

---

### Edge Cases

- What happens when `git log --oneline main..upstream/main | wc -l` returns `0`? → No merge needed; process ends at step 1 check.
- How does the system handle conflicts in fork-customized files (IPC bridge, entity sync, stale-save fix)? → Resolve by keeping `HEAD` (fork) code; incorporate only surrounding structural changes from upstream.
- What if `git push origin main` is rejected due to diverged fork history? → Investigate before force-pushing; do not use `--force` without explicit confirmation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Maintainer MUST fetch the latest commits from `upstream` remote (`git fetch upstream`) before any comparison or merge.
- **FR-002**: Maintainer MUST check for divergence by running `git log --oneline main..upstream/main` to see what upstream is adding before committing to a merge.
- **FR-003**: Maintainer MUST check for file overlap between upstream changes and fork-customized files before merging, using `git diff --name-only main upstream/main` cross-referenced against fork-only commits.
- **FR-004**: If no file overlap exists, maintainer MUST proceed with `git merge upstream/main` directly.
- **FR-005**: If file overlap exists, maintainer MUST review the upstream diff for conflicted files (`git diff main upstream/main -- <file>`) before merging.
- **FR-006**: During conflict resolution, fork VS Code customizations (IPC bridge, entity sync handlers, stale-save fix) MUST be preserved; only structural/surrounding upstream changes MAY be incorporated.
- **FR-007**: After a successful merge, maintainer MUST push the updated fork branch to `origin main`.
- **FR-008**: Maintainer MUST update the `apps/OntoGraph-lite` submodule pointer in the parent repo and commit it.
- **FR-009**: Build MUST succeed (`npm run build-all`) after the submodule pointer is updated.

### Key Entities

- **Upstream remote**: `ysgao/OntoGraph-lite` — the source of new commits to be merged.
- **Fork remote (origin)**: `ysgao/OntoGraph-lite-vscode` — the fork that holds VS Code customizations.
- **Fork-customized files**: Files modified exclusively by the fork (IPC bridge, entity sync handlers, stale-save fix) — must never lose their additions during a merge.
- **Submodule pointer**: The SHA reference in the parent `OntoGraphEditor` repo pointing to `apps/OntoGraph-lite`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the merge, `git log --oneline main..upstream/main` returns `0` lines — the fork is fully up to date with upstream.
- **SC-002**: Fork-customized files (IPC bridge, entity sync, stale-save fix) contain all their pre-merge VS Code additions unchanged after the merge.
- **SC-003**: `npm run build-all` exits with code `0` after the submodule pointer is updated.
- **SC-004**: `git submodule status` in the parent repo shows the new OntoGraph-lite SHA, not the pre-merge one.
- **SC-005**: The entire sync process (steps 1–4) completes without requiring any force-push to `origin main`.

## Assumptions

- The `upstream` remote is already configured in `apps/OntoGraph-lite` (pointing to `ysgao/OntoGraph-lite`).
- The fork's VS Code customizations are confined to a known set of files (IPC bridge, entity sync handlers, stale-save fix) that do not change frequently.
- A merge strategy is preferred over rebase to avoid force-pushing and per-commit conflict re-resolution.
- The maintainer has push access to both `origin main` (fork) and the parent repo's `master` branch.
- Node 18+ and npm are available for running `npm run build-all` verification.
