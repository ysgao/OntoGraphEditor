# Quickstart: Pull Upstream Changes into OntoGraph-lite Fork

**Feature**: `010-pull-upstream-merge`
**Estimated time**: ~10 minutes

---

## Prerequisites

- `upstream` remote configured in `apps/OntoGraph-lite` pointing to `ysgao/OntoGraph-lite`
- Push access to `origin main` (`ysgao/OntoGraph-lite-vscode`)
- Push access to parent repo `master` (`ysgao/OntoGraphEditor`)
- Node 18+ and npm installed

Verify the upstream remote:
```bash
cd apps/OntoGraph-lite
git remote -v
# upstream  https://github.com/ysgao/OntoGraph-lite (fetch)
# upstream  https://github.com/ysgao/OntoGraph-lite (push)
```

---

## Step 1 — Fetch upstream and check divergence

```bash
cd apps/OntoGraph-lite
git fetch upstream
git log --oneline main..upstream/main
```

Expected: a list of upstream commits. If the output is empty, the fork is already up to date — stop here.

---

## Step 2 — Confirm no fork-only commits (fast-forward safe)

```bash
git log --oneline upstream/main..main
```

Expected: **empty output**. If commits appear, review them before merging — they are fork-specific changes that may need manual preservation.

---

## Step 3 — Merge

```bash
git merge upstream/main
```

Expected: fast-forward merge, no conflict markers. The output should show `Fast-forward` and list updated files.

If conflicts appear (unexpected given Step 2 check), resolve by keeping `HEAD` (fork) code for any VS Code-specific sections and incorporating surrounding structural changes from upstream.

---

## Step 4 — Run tests

```bash
npm test
```

Expected: all tests pass (fixture-file failures in `Phase2/3/4` tests are pre-existing and unrelated).

---

## Step 5 — Push the updated fork

```bash
git push origin main
```

Expected: a clean push without `--force`. If rejected, investigate the divergence — do **not** force-push without explicit confirmation.

---

## Step 6 — Bump the submodule pointer in the parent repo

```bash
cd ../..   # back to OntoGraphEditor root
git add apps/OntoGraph-lite
git commit -m "chore: bump OntoGraph-lite submodule — sync upstream features 019-023"
```

Verify the pointer updated:
```bash
git submodule status
# should show the new SHA (bca897a or current upstream HEAD)
```

---

## Step 7 — Verify the parent build

```bash
npm run build-all
```

Expected: exits with code `0`. If the build fails, investigate the error before pushing.

---

## Step 8 — Push the parent repo

```bash
git push origin master
```

---

## Verification Checklist

- [ ] `git log --oneline main..upstream/main` returns 0 lines (fork is now in sync)
- [ ] `git submodule status` shows the new SHA
- [ ] `npm run build-all` exits `0`
- [ ] No force-push was needed at any step
