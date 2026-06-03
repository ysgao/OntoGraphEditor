# Research: Upstream Submodule Sync Workflow

**Feature**: 004-upstream-sync | **Date**: 2026-06-03

## Decision 1: Git Merge Strategy for Forked Submodule with Custom Files

**Decision**: Use `git merge upstream/master` (recursive merge) inside `apps/authoring-ui-vscode`. Do NOT use `git rebase` or `git cherry-pick`.

**Rationale**: Recursive merge preserves the full commit graph — custom files modified in the fork appear as local changes relative to the merge base. If IHTSDO never touches `vscode.service.ts`, there is zero conflict. Rebase would replay every fork commit on top of upstream, creating synthetic conflicts and rewriting commit SHAs that break submodule tracking.

**Alternatives considered**:
- `git rebase upstream/master` — rejected: rewrites fork commit history, loses `.git` submodule pointer stability, increases conflict surface
- `git cherry-pick` — rejected: requires manually selecting each upstream commit, does not scale to monthly cadence
- Subtree merge — rejected: overkill for a two-submodule repo; adds complexity without benefit

---

## Decision 2: Protection Strategy for VS Code Customization Files

**Decision**: Define a static allowlist of customization-scope files and add a pre-merge check script that warns if any allowlisted file appears in the incoming diff.

**Rationale**: The simplest protection is awareness. Git's merge machinery already preserves fork-local changes unless the same lines are edited upstream. A pre-merge diff check (`git diff HEAD..upstream/master -- <file>`) gives the maintainer advance warning before the merge runs.

**Alternatives considered**:
- `.gitattributes` merge driver — could mark files as `ours` to always keep fork version; rejected because it silently drops legitimate upstream changes to those files (e.g., if IHTSDO refactors the same Angular service)
- Git hooks (`pre-merge-commit`) — considered but pre-merge hooks don't fire on `git merge`; would require a wrapper script anyway

**VS Code Customization Scope (allowlist)**:
- `src/app/core/services/vscode.service.ts`
- `src/app/app.module.ts` (HashLocationStrategy import)
- `src/app/app-routing.module.ts` (useHash: true)
- Any file matching `src/app/core/services/vscode*.ts`

---

## Decision 3: Upstream Remote Naming Convention

**Decision**: Register the IHTSDO remote as `upstream` inside `apps/authoring-ui-vscode` (standard fork convention). OntoGraph-lite uses `origin` (already correct — it is not a fork).

**Rationale**: `upstream` is the universally understood convention for a fork's source. New maintainers will recognize it immediately without documentation. Using any other name adds cognitive overhead.

**Alternatives considered**:
- `ihtsdo` — more explicit but deviates from convention; would require explaining in every doc
- `source` — too generic

---

## Decision 4: Build Verification Gate

**Decision**: Use `npm run build-all` from the repo root as the single verification command. No additional test suite is required for this workflow feature.

**Rationale**: `build-all` already compiles both the Angular client and the TypeScript extension bundle. A passing build is sufficient evidence that upstream changes integrate without breaking the extension. End-to-end UI verification is out of scope for a maintenance workflow.

**Alternatives considered**:
- Running `npm run test` — current test coverage is too sparse to be a reliable gate; build is a stronger signal for integration breaks
- Launching the Extension Development Host — too slow for a routine sync gate; reserved for release candidates

---

## Decision 5: Runbook Location and Format

**Decision**: Primary runbook lives at `specs/004-upstream-sync/quickstart.md`. A copy is placed at `docs/maintenance/upstream-sync.md` for in-repo discoverability.

**Rationale**: `specs/` holds the canonical planning artifacts. `docs/maintenance/` ensures the runbook is findable without knowing the spec numbering scheme.

**Alternatives considered**:
- CLAUDE.md section — rejected: CLAUDE.md is already used for agent context; adding a long runbook makes it unwieldy
- README.md section — rejected: README is user-facing, not maintainer-facing
