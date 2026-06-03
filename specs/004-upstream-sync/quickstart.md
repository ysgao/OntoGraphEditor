# Upstream Sync Runbook

**Feature**: 004-upstream-sync | OntoGraph Editor Maintenance Workflow

This runbook documents how to safely pull upstream changes into both submodules. Run this approximately once per month, or whenever an upstream release is announced.

---

## Prerequisites

- git 2.x installed
- Node.js 18+ installed
- Repo cloned with submodules initialized (`git clone --recurse-submodules`)
- Internet access to GitHub

**Estimated time**: 10–30 minutes depending on conflict volume

---

## Part 1: Sync apps/authoring-ui-vscode with IHTSDO Upstream

### Step 1.1 — Configure upstream remote (first time only)

```bash
cd apps/authoring-ui-vscode
git remote -v   # check if 'upstream' already exists
```

If `upstream` is not listed:

```bash
git remote add upstream https://github.com/IHTSDO/authoring-ui
```

Verify:

```bash
git remote -v
# upstream  https://github.com/IHTSDO/authoring-ui (fetch)
# upstream  https://github.com/IHTSDO/authoring-ui (push)
```

### Step 1.2 — Fetch upstream changes

```bash
git fetch upstream
```

### Step 1.3 — Pre-merge conflict check (recommended)

Before merging, run the automated check script from the repo root (while still inside `apps/authoring-ui-vscode`):

```bash
../../scripts/check-upstream-conflicts.sh upstream/master
```

**If output is `✓ CLEAN`**: upstream did not touch VS Code customizations. Merge is low risk — proceed to Step 1.4.

**If output is `⚠ WARNING`**: upstream modified customization-scope files. The script will list each affected file and the exact `git diff` command to review it. Inspect all listed files before proceeding — you will need to resolve conflicts manually.

Alternatively, inspect manually:

```bash
git diff HEAD..upstream/master -- \
  src/app/core/services/vscode.service.ts \
  src/app/app.module.ts \
  src/app/app-routing.module.ts
```

### Step 1.4 — Merge upstream changes

```bash
git merge upstream/master
```

**If the merge is clean (no conflicts)**: proceed to Step 1.5.

**If conflicts arise in customization-scope files** (`vscode.service.ts`, `app.module.ts`, `app-routing.module.ts`):

1. Open each conflicted file in your editor.
2. Preserve the VS Code integration code (marked with `<<<<<<< HEAD`).
3. Incorporate any structural changes from upstream (marked with `>>>>>>> upstream/master`) without removing the VS Code additions.
4. Mark resolved: `git add <file>`
5. Complete the merge: `git commit`

**If conflicts arise in non-custom files**:

1. Accept upstream changes unless they conflict with known Angular configuration.
2. `git add <file>` and `git commit`.

### Step 1.5 — Return to repo root

```bash
cd ../..
```

---

## Part 2: Sync apps/OntoGraph-lite with Origin

```bash
cd apps/OntoGraph-lite
git fetch origin
git merge origin/main
cd ../..
```

This submodule has no VS Code customizations — conflicts are unexpected. If they arise, prefer upstream changes unless you have local commits you intentionally added.

---

## Part 3: Build Verification

Run the unified build from the repo root to verify integration health:

```bash
npm run build-all
```

**Expected**: exits 0, produces `extension/dist/` with bundled extension.

**If build fails**:

1. Read the error output — it will identify which submodule introduced the break.
2. For Angular errors in `apps/authoring-ui-vscode`: the upstream merge likely changed an API used by `VsCodeService`. Update `vscode.service.ts` to match the new API.
3. For TypeScript errors in `extension/src/`: unlikely from a submodule sync alone — check if `graphPanel.ts` or `authoringPanel.ts` references paths that changed.
4. Re-run `npm run build-all` after fixes.

---

## Part 4: Commit the Submodule Pointer Updates

After a successful build, commit the updated submodule pointers from the repo root:

```bash
git add apps/authoring-ui-vscode apps/OntoGraph-lite
git commit -m "chore: sync upstream submodules $(date +%Y-%m-%d)"
```

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| `git fetch upstream` fails with auth error | Upstream remote URL misconfigured | Re-run Step 1.1 to verify remote URL |
| Angular build fails with missing module | Upstream added a new dependency | Run `npm install` inside `apps/authoring-ui-vscode` |
| `vscode.service.ts` missing after merge | Merge incorrectly chose upstream version | `git checkout HEAD -- src/app/core/services/vscode.service.ts` then re-commit |
| Extension fails to activate after build | GraphPanel or AuthoringPanel path changed | Inspect `extension/src/graphPanel.ts` and `authoringPanel.ts` for path references |
