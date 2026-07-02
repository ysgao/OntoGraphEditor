# Research: Pull Upstream Changes into OntoGraph-lite Fork

**Feature**: `010-pull-upstream-merge`
**Date**: 2026-07-02

---

## Decision 1: Merge strategy — merge vs rebase

**Decision**: Use `git merge upstream/main` (merge commit strategy).

**Rationale**: The spec (assumption §5) requires merge over rebase to avoid force-pushing. A merge commit preserves the full history of both branches, making it safe to push to `origin main` without `--force`.

**Alternatives considered**:
- *Rebase*: Would produce a linear history but requires `git push --force-with-lease`, which risks data loss if other contributors have pulled. Rejected per spec constraint SC-005.
- *Squash merge*: Loses granular upstream commit history. Rejected.

---

## Decision 2: Conflict risk assessment

**Decision**: Zero conflicts expected — merge will fast-forward cleanly.

**Rationale**: Git analysis confirms the fork (`origin/main`, SHA `6aaa255`) is the exact merge-base of `origin/main` and `upstream/main`. This means `origin/main` is a strict ancestor of `upstream/main`. A `git merge upstream/main` will fast-forward the fork's pointer to the upstream HEAD without creating a merge commit or any conflict markers.

**Evidence**:
```
git merge-base origin/main upstream/main
→ 6aaa255646f25bb47d7242d733a61dfca3b01c55  (= origin/main exactly)
```

**Alternatives considered**: Manual conflict resolution was planned as a fallback (FR-005, FR-006), but is not required given the fast-forward path.

---

## Decision 3: Fork-customized files — preservation risk

**Decision**: No fork-specific customizations exist at risk. The upstream already incorporates all VS Code integration work.

**Rationale**: `git log upstream/main..origin/main` returns zero results — the fork has no commits that are not also in the upstream. The VS Code customizations referenced in the spec (IPC bridge, entity sync handlers, stale-save fix) were already upstreamed:
- `feat(016-fix-editor-stale-display)` in upstream includes the `bypassHistory` stale-save fix
- `feat(015-remove-authoring-ui-integration)` cleaned up integration artifacts
- All fork entity sync work is in the shared commit history

**Alternatives considered**: N/A — the data is unambiguous.

---

## Decision 4: Scope of changed files

**Decision**: The 35 upstream commits introduce four categories of changes, all safe to take as-is:

| Category | Examples | Risk |
|---|---|---|
| New features (src/) | `EntityCreationSync.ts`, `IriRenameSync.ts`, `NavigationHistory.ts`, `ManchesterFormatting.ts` updates | None — pure additions |
| Modified core files | `EntityEditorPanel.ts`, `addEntity.ts`, `extension.ts`, `AnnotationSync.ts` | None — fork has no conflicting changes |
| New CLI package | `cli/` directory, `pnpm-workspace.yaml` | None — additive |
| Tooling / specs | `.claude/`, `.specify/`, `specs/015–023/` | None — docs/tooling only |

---

## Decision 5: Post-merge verification plan

**Decision**: Run `npm test` in `apps/OntoGraph-lite` before pushing, then `npm run build-all` from parent repo after the submodule pointer is bumped.

**Rationale**: Tests confirm the 35 upstream commits don't break existing behaviour. The full build confirms the parent repo can still bundle the updated submodule. This satisfies SC-003 and SC-004.
