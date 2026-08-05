# Upstream Sync Runbook

**OntoGraph Editor** | Maintenance Workflow

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

Alternatively, inspect manually — pass the same `PROTECTED_PATHS` entries listed in `scripts/check-upstream-conflicts.sh`:

```bash
git diff HEAD..upstream/master -- \
  app/shared/vscode-service \
  app/app.js \
  app/shared/concept-edit/conceptEdit.js \
  app/components/edit/edit.js \
  app/shared/sca-service/scaService.js \
  app/shared/taxonomy-tree/taxonomyTree.js \
  app/shared/task-detail/taskDetail.js \
  app/shared/task-detail/taskDetail.html \
  app/index.html \
  Gruntfile.js \
  package.json \
  test/karma.conf.js
```

### Step 1.4 — Merge upstream changes

```bash
git merge upstream/master
```

**If the merge is clean (no conflicts)**: proceed to Step 1.5.

**If conflicts arise in customization-scope files** (see `PROTECTED_PATHS` in `scripts/check-upstream-conflicts.sh` for the current list):

1. Open each conflicted file in your editor.
2. Preserve the VS Code integration code (marked with `<<<<<<< HEAD`).
3. Incorporate any structural changes from upstream (marked with `>>>>>>> upstream/master`) without removing the VS Code additions.
4. Mark resolved: `git add <file>`
5. Complete the merge: `git commit`

**If conflicts arise in non-custom files**:

1. Accept upstream changes unless they conflict with known Angular configuration.
2. `git add <file>` and `git commit`.

### Known customizations and how to resolve conflicts in them

Beyond the original VS Code IPC/webview customizations, this fork also finished a bower→npm
vendor-loading migration and restored a working Karma test setup (previously a Grunt no-op —
see `git log` around "restore Karma" for the full history). Both touch files upstream still
actively maintains, so future merges need specific handling, not just "keep HEAD":

| File | What's customized here | How to resolve a conflict |
|------|------------------------|----------------------------|
| `bower.json`, `.bowerrc`, `bower_components/` | **Deleted** — the fork no longer uses bower at all; every vendor library loads from `node_modules/` (or, for the one library with no npm release, from the new `vendor/` directory below). | If upstream's side still modifies `bower.json`, git reports a **modify/delete conflict**, not a text conflict — it won't auto-resolve. Keep the deletion (`git rm bower.json .bowerrc` if either reappears; do **not** run `bower install` or resurrect `bower_components/`). If upstream's diff reveals a *new* bower dependency was added, that library still needs an npm (or vendored) equivalent — treat it exactly like the six libraries below. |
| `Gruntfile.js` | `appPath` is hardcoded to `'app'` (was `require('./bower.json').appPath \|\| 'app'` — same effective value, just no longer reads the now-deleted file). A `karma` target and a real `test` task (`registerTask('test', ['karma'])`, previously `[]`) were added. | Keep the hardcoded `appPath`. Re-apply the `karma` config block and `test` task if upstream's version of this file overwrites them — check `git log -p -- Gruntfile.js` for the exact block if it's not obvious from the conflict markers. |
| `package.json` | Added `karma`, `karma-jasmine`, `karma-chrome-launcher`, `grunt-karma` (test infra), and `angular-mocks`, `bootstrap-sass`, `d3`, `c3`, `tinymce` (real npm packages standing in for libraries `app/index.html` referenced under bower-only names/paths — see below). | Keep all of the above. **`angular-mocks`'s version must exactly match `angular`'s version** — if upstream's merge bumps `angular`, bump `angular-mocks` to the same version in the same commit, or Karma breaks again with `TypeError: angular.module(...).info is not a function` (this exact symptom is what motivated pinning it in the first place). |
| `app/index.html` | Fixed 7 vendor `<script>`/`<link>` paths that pointed at bower-only package names never installed under `node_modules/` (`bootstrap-sass-official`→`bootstrap-sass`, `velocity`→`velocity-animate`, `c3-angular/c3js-directive.js`→`c3-angular/c3-angular.js`), plus routed `ngSmoothScroll` to the new `vendor/angular-smooth-scroll.js` (never published to npm at all). | If upstream's diff touches the `<!-- build:js(.) scripts/vendor.js -->` block (adds/removes/reorders a vendor script), keep our corrected paths for anything in the table above, and **verify every path upstream adds actually resolves**: `ls node_modules/<package>/<path-from-the-script-tag>` — don't assume a `node_modules/`-shaped path is real; that exact assumption is what broke these 7 originally. If upstream adds a library with no working npm path either, vendor it the same way `ngSmoothScroll` was (a file under top-level `vendor/`, referenced as `vendor/<name>.js` — that block's `cwd` is the submodule root, not `app/`, so don't prefix with `app/`). |
| `test/karma.conf.js` | Fully rewritten: `ChromeHeadless` instead of the dead `PhantomJS` launcher; file list rebuilt to mirror `app/index.html`'s real `node_modules/`-based script order (the old list was `bower_components/`-based and mostly non-matching glob patterns — Karma silently ran 0 real specs for years). `app/app.js` and `app/shared/sidebar-edit/sidebarEdit.js` are pulled in explicitly ahead of the general globs because both register their Angular module via the synchronous 1-arg `angular.module('name')` getter, which needs the registering file loaded first. | Never reintroduce `PhantomJS` (unmaintained since 2018, doesn't run on current Node) or revert the file list to `bower_components/`. If upstream's own `karma.conf.js` differs, treat it as a reference for *what new vendor files exist*, not for *how to load them* — port new entries into our `node_modules/`-based structure, keeping the explicit `app/app.js` / `sidebarEdit.js` ordering intact. |

New files with no upstream equivalent (no conflict risk, but flagged so a future
`find`/`grep`-based audit doesn't mistake them for stray junk): `test/stubs/ga-stub.js`
(reproduces the inline Google Analytics stub `app/index.html`'s `<head>` defines, since Karma
never executes the HTML file itself) and `vendor/angular-smooth-scroll.js` (see the `app/index.html`
row above).

### Step 1.5 — Return to repo root

```bash
cd ../..
```

---

## Part 2: Sync apps/OntoGraph-lite with Upstream

`apps/OntoGraph-lite` tracks the fork `ysgao/OntoGraph-lite-vscode`, which contains VS Code-specific customizations (IPC bridge, entity focus sync). `origin` = the fork; `upstream` = `IHTSDO/OntoGraph-lite`.

### Step 2.1 — Configure upstream remote (first time only)

```bash
cd apps/OntoGraph-lite
git remote -v   # check if 'upstream' already exists
```

If `upstream` is not listed:

```bash
git remote add upstream https://github.com/ysgao/OntoGraph-lite
```

### Step 2.2 — Fetch upstream and merge into fork

```bash
git fetch upstream
git merge upstream/main
cd ../..
```

If conflicts arise in VS Code customization files (IPC bridge, entity sync handlers), preserve the fork's changes.

---

## Part 3: Build Verification

Run the unified build from the repo root to verify integration health:

```bash
npm run build-all
```

**Expected**: exits 0, produces `extension/dist/` with bundled extension.

**If build fails**:

1. Read the error output — it will identify which submodule introduced the break.
2. For AngularJS errors in `apps/authoring-ui-vscode`: the upstream merge likely changed an API used by `vsCodeService`. Update `app/shared/vscode-service/vsCodeService.js` to match the new API.
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
| `vsCodeService.js` missing after merge | Merge incorrectly chose upstream version | `git checkout HEAD -- app/shared/vscode-service/vsCodeService.js` then re-commit |
| Extension fails to activate after build | GraphPanel or AuthoringPanel path changed | Inspect `extension/src/graphPanel.ts` and `authoringPanel.ts` for path references |
| `git merge` reports `bower.json`/`.bowerrc` as deleted by us, modified by them | Upstream still maintains bower; this fork deleted it when migrating to npm-only vendor loading | Keep it deleted (`git rm bower.json .bowerrc`, `git add -u`). If upstream's diff added a genuinely new bower dependency, give it an npm/vendored equivalent per the `app/index.html` row in "Known customizations" above, don't reinstall bower. |
| `npm test` in `authoring-ui-vscode` fails with `angular.module(...).info is not a function` | `angular-mocks` version no longer matches `angular`'s version in `package.json` | Set `angular-mocks` to the exact same version as `angular`, then `npm install` |
| Karma reports `Uncaught Error: [$injector:nomod]` for a module that clearly exists in some `.js` file | That file isn't matched by `test/karma.conf.js`'s file globs (or loads before a module it depends on) | Check the glob patterns cover the file's actual path, and that files using the 1-arg `angular.module('name')` getter form load after whatever registers `'name'` |
| Live app is missing a UI feature (charts, rich-text editor, animations, dropdowns) with no console error | `app/index.html` references a vendor script under a `node_modules/` path that doesn't actually exist (stale bower-era path) | `ls node_modules/<package>/<path>` for every `<script>`/`<link>` tag in the `<!-- build:js(.) scripts/vendor.js -->` block — Grunt's `concat` silently drops non-matching sources instead of failing the build |
