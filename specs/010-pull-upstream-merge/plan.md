# Implementation Plan: Pull Upstream Changes into OntoGraph-lite Fork

**Branch**: `010-pull-upstream-merge` | **Date**: 2026-07-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/010-pull-upstream-merge/spec.md`

---

## Summary

Bring the `ysgao/OntoGraph-lite-vscode` fork in sync with 35 upstream commits from `ysgao/OntoGraph-lite` (features 015–023, including entity creation, navigation history, unsaved-changes guard, Manchester sort, and the OntoGraph CLI). The fork is a strict ancestor of upstream (merge-base = `origin/main`), so the merge is a guaranteed fast-forward with no conflict risk. After merging, the parent `OntoGraphEditor` repo's submodule pointer is bumped and the unified build is verified.

---

## Technical Context

**Language/Version**: TypeScript 5 (strict mode), Node.js 18+
**Primary Dependencies**: VS Code Extension API, esbuild (7 bundles), Vitest (tests), pnpm (CLI workspace)
**Storage**: N/A — maintenance operation, no new data persistence
**Testing**: Vitest (`npm test` in `apps/OntoGraph-lite`)
**Target Platform**: VS Code Extension submodule (OntoGraph-lite fork)
**Project Type**: Git maintenance / upstream sync
**Performance Goals**: N/A
**Constraints**: No `--force` push to `origin main`; `npm run build-all` must pass after submodule bump
**Scale/Scope**: 35 upstream commits; ~150 changed files (mostly specs/tooling/CLI); 9 src/ files with meaningful logic changes

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Decoupled UI Core | ✅ PASS | Operation keeps `apps/OntoGraph-lite` as a standalone submodule; extension host unchanged |
| II. IPC-Only Communication | ✅ PASS | No new network calls introduced; upstream features route through existing IPC bridge |
| III. Webview Path Safety | ✅ PASS | No build configuration or asset path changes that affect `asWebviewUri` |
| IV. Test-First Integration | ✅ PASS | Maintenance merge; no new custom integration services requiring contract-first design |

No violations. No complexity tracking required.

---

## Project Structure

### Documentation (this feature)

```text
specs/010-pull-upstream-merge/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (/speckit-tasks — not yet created)
```

### Source Code (repository root)

```text
apps/OntoGraph-lite/           ← fork submodule (target of merge)
├── src/
│   ├── commands/              ← addEntity.ts, loadOntologyFile.ts, openVisualization.ts
│   ├── sync/                  ← EntityCreationSync.ts (new), IriRenameSync.ts (new), AnnotationSync.ts
│   ├── views/                 ← EntityEditorPanel.ts, NavigationHistory.ts (new), syncHighlight.ts
│   └── utils/                 ← ManchesterFormatting.ts, namespaceUtils.ts (new)
├── cli/                       ← new standalone CLI package (018-ontograph-cli)
└── specs/015-023/             ← upstream spec artifacts (docs only)

extension/                     ← parent repo (submodule pointer bump only)
└── (no src changes)
```

**Structure Decision**: Single-project structure. All logic changes are in `apps/OntoGraph-lite`. The parent repo (`extension/`) requires only a submodule pointer commit — no source changes.

---

## Phase 0: Research Summary

See [research.md](research.md) for full findings. Key decisions:

1. **Merge strategy**: `git merge upstream/main` (merge commit). Rebase rejected — would require force-push (violates SC-005).
2. **Conflict risk**: Zero. Fork is a strict ancestor of upstream (`merge-base == origin/main`). Fast-forward guaranteed.
3. **Fork customization preservation**: No risk. The fork has 0 unique commits (`git log upstream/main..origin/main` = empty). All VS Code customizations are already in the shared commit history.
4. **Changed file categories**: New feature src/ files (additive), modified core files (no fork conflict), new CLI package, tooling/spec docs.
5. **Verification**: `npm test` in submodule before push; `npm run build-all` in parent after submodule bump.

---

## Phase 1: Design Summary

See [data-model.md](data-model.md) and [quickstart.md](quickstart.md).

**Contracts**: Skipped — this is a purely internal git maintenance operation with no external interface changes.

### Key upstream changes to be aware of (src/ only)

| File | Feature | Nature |
|---|---|---|
| `src/sync/EntityCreationSync.ts` | 019-create-entity | New file — entity creation write-back |
| `src/sync/IriRenameSync.ts` | 019-create-entity | New file — IRI rename propagation |
| `src/views/NavigationHistory.ts` | 021-entity-nav-history | New file — Back/Forward history |
| `src/views/EntityEditorPanel.ts` | 016, 022 | Modified — stale-save fix + dirty guard |
| `src/commands/addEntity.ts` | 019-create-entity | Modified — per-panel creation |
| `src/utils/ManchesterFormatting.ts` | 023-manchester-sort | Modified — sort conjuncts |
| `src/utils/namespaceUtils.ts` | 019-create-entity | New file — IRI namespace utilities |
| `src/sync/AnnotationSync.ts` | 019-create-entity | Modified — creation support |
| `webview-src/entity-editor/EntityEditorApp.ts` | 022 | Modified — unsaved changes guard |

### Post-merge verification steps

1. `npm test` in `apps/OntoGraph-lite` — confirm all existing tests still pass
2. `git push origin main` — confirm no force-push needed (SC-005)
3. Bump submodule pointer in parent repo
4. `npm run build-all` from parent repo root — confirm SC-003

---

## Implementation Steps

*(Detailed runbook in [quickstart.md](quickstart.md))*

1. `cd apps/OntoGraph-lite && git fetch upstream`
2. Verify divergence: `git log --oneline main..upstream/main` (expect 35 commits)
3. Verify no fork-only commits: `git log --oneline upstream/main..main` (expect empty)
4. `git merge upstream/main` — fast-forward
5. `npm test` — confirm tests pass
6. `git push origin main`
7. `cd ../.. && git add apps/OntoGraph-lite && git commit`
8. `npm run build-all`
9. `git push origin master`
