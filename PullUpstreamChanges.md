# Pulling Upstream Changes into OntoGraph-lite

## Architecture: two layers that must both be synced

The extension has a parallel-copy architecture. A git merge of the submodule alone is **not enough** — both layers must be updated:

| Layer | Location | Built by |
|-------|----------|----------|
| Submodule (fork of upstream) | `apps/OntoGraph-lite/` | not built into extension host |
| Extension host copy | `extension/src/graph/` | esbuild → `dist/extension.js` |
| Webviews | `apps/OntoGraph-lite/webview-src/` | esbuild → `dist/*-webview.js` |

`extension/src/graph/` is a maintained copy of `apps/OntoGraph-lite/src/`. esbuild bundles the extension host from `extension/src/`, **not** from the submodule. Webviews are built directly from the submodule's `webview-src/`.

**Consequence:** new upstream source files or changed upstream source files must be copied into `extension/src/graph/` after the submodule merge, or the new features will not appear in the built extension.

---

## Part 1 — Sync the submodule (git)

### 1. Fetch upstream and preview

```bash
cd apps/OntoGraph-lite
git fetch upstream

# Commits upstream has that the fork doesn't
git log --oneline main..upstream/main
```

If the count is 0, the fork is already in sync. Stop here.

### 2. Check for file overlap with fork customisations

```bash
# Files upstream changed since the fork diverged
git diff --name-only main upstream/main

# Files the fork's own commits touched
git log --name-only --format="" origin/main ^upstream/main | sort -u
```

**No overlap** → merge will be clean. Proceed directly.

**Overlap** → review the upstream diff for each overlapping file before merging:

```bash
git diff main upstream/main -- <file>
```

When resolving conflicts in fork-custom files (IPC bridge, entity sync, save fix), keep the `HEAD` (fork) code and incorporate only structural changes from upstream. Never drop VS Code integration additions.

### 3. Merge

```bash
git merge upstream/main
```

### 4. Run tests

```bash
npm test
```

Pre-existing ENOENT failures for fixture files (`animals.ttl`, `pizza.owl`) are acceptable. All other tests must pass.

### 5. Push fork and bump submodule pointer

```bash
git push origin main   # must succeed without --force

cd ../..
git add apps/OntoGraph-lite
git commit -m "chore: bump OntoGraph-lite submodule — sync upstream $(date +%Y-%m-%d)"
```

---

## Part 2 — Sync the extension host copy

The submodule merge brings new and updated TypeScript source files. These must be reflected in `extension/src/graph/`.

### 6. Identify what changed in the submodule's src/

```bash
# New files upstream added to src/ since the last sync point
git -C apps/OntoGraph-lite diff --name-status <prev-sha>..HEAD -- src/

# Or diff against what extension/src/graph/ currently has
diff -rq --include="*.ts" apps/OntoGraph-lite/src/ extension/src/graph/ \
  | grep "Only in apps"   # files in submodule but not in extension copy
```

### 7. Copy new files verbatim

For every file that exists in `apps/OntoGraph-lite/src/` but not in `extension/src/graph/`, copy it directly:

```bash
cp apps/OntoGraph-lite/src/views/NavigationHistory.ts   extension/src/graph/views/
cp apps/OntoGraph-lite/src/views/syncHighlight.ts       extension/src/graph/views/
cp apps/OntoGraph-lite/src/sync/EntityCreationSync.ts   extension/src/graph/sync/
cp apps/OntoGraph-lite/src/sync/IriRenameSync.ts        extension/src/graph/sync/
cp apps/OntoGraph-lite/src/commands/searchQueryState.ts extension/src/graph/commands/
cp apps/OntoGraph-lite/src/utils/namespaceUtils.ts      extension/src/graph/utils/
# ... add any other new files discovered in step 6
```

### 8. Diff and update changed files

For files that exist in both locations, diff them and apply upstream changes — but preserve any extension-specific additions:

```bash
diff apps/OntoGraph-lite/src/views/EntityEditorPanel.ts \
     extension/src/graph/views/EntityEditorPanel.ts
```

Files that can be replaced verbatim (no extension-specific content):
- `views/EntityEditorMessages.ts`
- `views/EntityEditHistory.ts`
- `utils/ManchesterFormatting.ts`
- `sync/AnnotationSync.ts`
- `sync/AxiomSync.ts`
- `model/SegmentIndex.ts`
- `model/OntologyModel.ts`
- `model/OntologyIndex.ts`
- `model/AxiomDisplay.ts`

Files requiring surgical merge (extension-specific code must be preserved):

| File | What to preserve |
|------|-----------------|
| `views/EntityEditorPanel.ts` | `bypassHistory` param in `sendLoadEntity`; `preserveFocus` param in `guardedShowEntityInfo` |
| `commands/activateGraph.ts` | `ontographEditor.ipcRoute` call in `onEntitySelected`; `preserveFocus` arg in `focusEntity`; `updateGraphPanel` call; `fromIpc` handling throughout |
| `commands/openVisualization.ts` | **Never replace** — has IPC routing (`GRAPH_NODE_SELECT`), `updateGraphPanel` export, and extension-specific graph panel wiring |

### 9. Update activateGraph.ts with new upstream commands

Compare the submodule's `apps/OntoGraph-lite/src/extension.ts` with `extension/src/graph/activateGraph.ts`:

```bash
diff apps/OntoGraph-lite/src/extension.ts extension/src/graph/activateGraph.ts
```

For each new command or feature in the submodule's `extension.ts`, add the equivalent to `activateGraph.ts`. Preserve the following extension-only additions that do not exist in the submodule:

- `suppressNextSelection` / `revealInTreeView` / `fromIpc` pattern
- `updateGraphPanel(...)` call in `focusEntity` and `onEntitySelected`
- `ontographEditor.ipcRoute` dispatch in `onEntitySelected`
- `preserveFocus` arg passed to `guardedShowEntityInfo` when `fromIpc=true`

### 10. Update package.json with new commands

For each new command registered in `activateGraph.ts`, add a corresponding entry to `extension/package.json` under `contributes.commands` and any applicable `contributes.menus` entries.

```bash
# Check what commands the submodule registers
grep -n "registerCommand" apps/OntoGraph-lite/src/extension.ts

# Compare with what the extension already declares
grep -n '"command"' extension/package.json
```

### 11. Verify webview script tags

Webview bundles are built as `format: 'esm'` with code splitting. Every `buildHtml` function that serves a webview must use `type="module"` on its script tag:

```html
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
```

Files to check:
- `extension/src/graph/views/EntityEditorPanel.ts`
- `extension/src/graph/commands/openVisualization.ts`
- `extension/src/graph/commands/openSparqlEditor.ts`
- `extension/src/graph/views/DLQueryPanel.ts`

---

## Part 3 — Build and verify

### 12. Type-check

```bash
cd extension && npm run compile
```

Only pre-existing errors in test files (missing `vitest`/`n3` type declarations) are acceptable. Any new errors must be fixed before packaging.

### 13. Build and package

```bash
cd ..  # repo root
npm run build-all && npm run package:vsix
```

Install the resulting VSIX and verify:
- New UI buttons appear in tree-view toolbars
- Selecting an entity in the AuthoringWorkbench highlights it in OntoGraph-lite without stealing focus from the authoring panel
- Clicking an entity in OntoGraph-lite opens/updates the Entity Editor
- Back/Forward navigation buttons work after navigating between entities

---

## Why merge over rebase

Rebase gives cleaner history but requires force-pushing `origin/main` and re-resolving every conflict per-commit rather than once. For ongoing maintenance where the fork has accumulated custom commits, a single merge commit is safer and less error-prone.

---

## Quick status check

```bash
cd apps/OntoGraph-lite && git fetch upstream && git log --oneline main..upstream/main | wc -l
```

If that returns `0`, the submodule is already in sync with upstream.
