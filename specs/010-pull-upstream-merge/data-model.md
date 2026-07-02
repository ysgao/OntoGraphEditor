# Data Model: Pull Upstream Changes into OntoGraph-lite Fork

**Feature**: `010-pull-upstream-merge`

This is a git maintenance operation. The "entities" are git branch references and the submodule pointer, not application data. No new persistent data structures are introduced.

---

## Entities

### ForkBranch
Represents the state of `origin/main` in `apps/OntoGraph-lite`.

| Field | Type | Description |
|---|---|---|
| remote | string | `origin` → `ysgao/OntoGraph-lite-vscode` |
| branch | string | `main` |
| sha_before | string | SHA of `origin/main` before the merge (`6aaa255`) |
| sha_after | string | SHA of `upstream/main` after the fast-forward |

**State transition**: `behind-upstream` → `in-sync`

---

### UpstreamBranch
Represents the state of `upstream/main` in `apps/OntoGraph-lite`.

| Field | Type | Description |
|---|---|---|
| remote | string | `upstream` → `ysgao/OntoGraph-lite` |
| branch | string | `main` |
| sha | string | `bca897a` (HEAD at time of merge) |
| commits_ahead | integer | 35 (commits not yet in fork) |

---

### SubmodulePointer
Represents the `apps/OntoGraph-lite` entry in the parent `OntoGraphEditor` repo's `.gitmodules` and tree.

| Field | Type | Description |
|---|---|---|
| path | string | `apps/OntoGraph-lite` |
| sha_before | string | SHA pointing to old fork commit (`6aaa255`) |
| sha_after | string | SHA pointing to merged fork HEAD (`bca897a`) |
| parent_branch | string | `master` in `OntoGraphEditor` |

**State transition**: `stale` → `current`

---

## State Transition Diagram

```
apps/OntoGraph-lite (fork)
  origin/main: 6aaa255  ──fast-forward──►  bca897a
                                            (= upstream/main HEAD)

OntoGraphEditor (parent)
  submodule ptr: 6aaa255  ──bump──►  bca897a
```

---

## Validation Rules

- FR-001: `upstream` remote must exist before fetch (`git remote -v | grep upstream`)
- FR-002: `git log main..upstream/main` must be non-empty before proceeding (otherwise already up-to-date)
- FR-007: `git push origin main` must succeed without `--force`
- FR-009: `npm run build-all` exit code must be `0`
