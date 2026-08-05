# Pulling Upstream Changes into OntoGraph-lite

## Architecture: three layers that must all be synced

The extension has a parallel-copy architecture. A git merge of the submodule alone is **not enough** — all three layers must be updated:

| Layer | Location | Built by |
|-------|----------|----------|
| Submodule (fork of upstream) | `apps/OntoGraph-lite/` | not built into extension host |
| Extension host copy | `extension/src/graph/` | esbuild → `dist/extension.js` |
| Webviews | `apps/OntoGraph-lite/webview-src/` | esbuild → `dist/*-webview.js` |
| Java reasoner server | `apps/OntoGraph-lite/java-server/` | Maven → JAR copied verbatim into `dist/java-server/` |

`extension/src/graph/` is a maintained copy of `apps/OntoGraph-lite/src/`. esbuild bundles the extension host from `extension/src/`, **not** from the submodule. Webviews are built directly from the submodule's `webview-src/`. The Java server is different again: nothing is copied into `extension/` at the source level — esbuild's post-build step just copies whatever **built JAR** already sits in `apps/OntoGraph-lite/java-server/target/`, so that JAR must be rebuilt from the merged source before packaging (see step 12).

**Consequence:** new or changed upstream TypeScript source must be copied into `extension/src/graph/` after the submodule merge, or the new features will not appear in the built extension — and if the merge touched `java-server/src`, the JAR must be rebuilt too, or the TS and Java sides silently disagree on the JSON-RPC protocol at runtime.

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

# Or diff against what extension/src/graph/ currently has.
# macOS `diff` has no --include flag, so build file lists with find + comm instead:
find apps/OntoGraph-lite/src -name "*.ts" ! -name "*.test.ts" | sed 's|apps/OntoGraph-lite/src/||' | sort > /tmp/sub_files.txt
find extension/src/graph -name "*.ts" ! -name "*.test.ts" | sed 's|extension/src/graph/||' | sort > /tmp/ext_files.txt
comm -23 /tmp/sub_files.txt /tmp/ext_files.txt   # NEW: in submodule, not yet in extension copy
comm -13 /tmp/sub_files.txt /tmp/ext_files.txt   # extension-only files (activateGraph.ts, its own *.test.ts) — expected, not a gap
```

Then, for files common to both lists, find which ones actually differ:

```bash
comm -12 /tmp/sub_files.txt /tmp/ext_files.txt > /tmp/common_files.txt
while read -r f; do
  diff -q "apps/OntoGraph-lite/src/$f" "extension/src/graph/$f" >/dev/null 2>&1 || echo "CHANGED: $f"
done < /tmp/common_files.txt
```

**Not every new upstream file belongs in `extension/src/graph/`.** `api.ts` and `bridge/BridgeServer.ts` back the standalone OntoGraph-lite extension's own external API (used by the separate `ontograph` CLI packages to talk to a running VS Code instance over a socket). The embedded extension has no equivalent consumer and already has its own IPC bridge (`ontographEditor.ipcRoute`) — skip these two files and anything that imports them, unless another new file starts depending on them (check with `grep -rl "from '.*\bapi'\|BridgeServer" apps/OntoGraph-lite/src/`).

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
| `commands/loadOntologyFile.ts` | Extension omits the upstream workspace-folder-switching feature (`onUriResolved` hook, `openWorkspaceFolderOnUriResolved`/`openWorkspaceFolderAfterLoad`, `pendingLoadUri` restart flow) — restarting the extension host to switch workspace folders would be disruptive to the embedded dual-panel host. Keep the 2-arg signature; only port in additions that don't need that hook (e.g. conflict-marker detection, prefill URI validation) |
| `reasoner/ReasonerBridge.ts` | `jarPath` points at `dist/java-server/onto-reasoner-server.jar` (packaged location), not the submodule's dev-mode `java-server/target/onto-reasoner-server.jar` |

**Telling a genuine upstream change apart from a pre-existing intentional divergence.** A file can differ from the submodule for two very different reasons: (a) upstream changed it in this sync, or (b) the extension copy has always diverged (deliberately, or from a gap an earlier sync missed). Conflating the two leads to either clobbering a real customization or leaving a real bug in place. Disambiguate with a three-way diff against the submodule commit the *previous* sync started from (recorded in the bump commit message, or `git -C apps/OntoGraph-lite log --oneline` around the last `chore: bump OntoGraph-lite submodule` commit — call it `<prev-sha>`):

```bash
# What did upstream actually change in THIS sync?
git -C apps/OntoGraph-lite diff <prev-sha> HEAD -- src/commands/loadOntologyFile.ts

# Did the extension copy already differ from the submodule BEFORE this sync?
diff <(git -C apps/OntoGraph-lite show <prev-sha>:src/commands/loadOntologyFile.ts) extension/src/graph/commands/loadOntologyFile.ts
```

If the second diff is empty, the extension copy had no customization — safe to overwrite verbatim with the submodule's current version. If it's non-empty, that divergence predates this sync; preserve it and apply only the first diff's delta on top. This is how `loadOntologyFile.ts`, `ReasonerBridge.ts`, and `FunctionalSerializer.ts` were correctly identified as needing surgical merges even though they weren't in the original known-customization list above — update that list whenever this process turns up a new one.

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

Also diff `contributes.configuration` and `dependencies`/`devDependencies` — a new feature (e.g. UML diagram generation) commonly ships new settings and, less often, new bundled libraries:

```bash
python3 -c "
import json
sub = json.load(open('apps/OntoGraph-lite/package.json'))
ext = json.load(open('extension/package.json'))
print('config keys missing from extension:',
      set(sub['contributes']['configuration']['properties']) - set(ext['contributes']['configuration']['properties']))
print('deps missing from extension devDependencies:',
      set(sub.get('dependencies', {})) - set(ext.get('devDependencies', {})) - set(ext.get('dependencies', {})))
"
```

Note the extension declares these as `devDependencies` (esbuild bundles them into the webview/extension host; nothing needs installing at runtime beyond `vscode`), so compare against `devDependencies`, not `dependencies`.

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
- `extension/src/graph/commands/generateUmlDiagram.ts`

If a new feature introduces its own webview panel entirely (as `generateUmlDiagram.ts` did for the UML diagram view), it needs a matching entry point registered in **`extension/esbuild.mjs`**'s `webviewBuild.entryPoints`, pointing at the submodule's `webview-src/<name>/<App>.ts` — otherwise the panel's `buildHtml()` references a bundle (`dist/<name>-webview.js`) that esbuild never produces, and the panel loads with no script at all. Diff the submodule's own `esbuild.mjs` `entryPoints` list against `extension/esbuild.mjs` to catch this:

```bash
grep -A10 "entryPoints" apps/OntoGraph-lite/esbuild.mjs
grep -A10 "entryPoints" extension/esbuild.mjs
```

### 12. Rebuild the Java reasoner server, if changed

`java-server/` (Maven/Java, not TypeScript) is a **third** layer with the same parallel-copy problem as Part 2 — but instead of copying source, `extension/esbuild.mjs`'s post-build step copies the **built JAR** (`apps/OntoGraph-lite/java-server/target/onto-reasoner-server.jar`) into `extension/dist/java-server/`. That JAR is a stale build artifact until it's rebuilt from the merged source — merging the submodule does *not* rebuild it, and nothing else in this runbook does either.

```bash
# Did this sync touch the Java server source?
git -C apps/OntoGraph-lite diff <prev-sha> HEAD -- java-server/src
```

If it did, rebuild before packaging:

```bash
cd apps/OntoGraph-lite/java-server
mvn clean package
```

Skipping this is a silent failure, not a build error: `npm run compile`/`build-all`/`package:vsix` all succeed either way, because esbuild just copies whatever JAR is sitting in `target/`. The mismatch only surfaces at runtime — e.g. the TS side reading a new response field (`equivalentClasses`) that the stale JAR's JSON-RPC output doesn't include yet throws `entries is not iterable` deep in `groupEquivalentClasses()`. If classification (or any other reasoner-bridge feature) breaks after a sync with no compile errors, suspect a stale JAR first — check the JAR's mtime against `java-server/src`:

```bash
find apps/OntoGraph-lite/java-server/src -newer apps/OntoGraph-lite/java-server/target/onto-reasoner-server.jar
```

Any output means the JAR predates the current source and must be rebuilt. After rebuilding, re-run `npm run build-all` so the fresh JAR gets copied into `extension/dist/`.

---

## Part 3 — Build and verify

### 13. Type-check

```bash
cd extension && npm run compile
```

Only pre-existing errors in test files (missing `vitest`/`n3` type declarations) are acceptable. Any new errors must be fixed before packaging.

### 14. Run all test suites

Type-checking only catches compile errors, not behavior — run every component's own test suite before packaging, not just OntoGraph-lite's:

```bash
cd apps/OntoGraph-lite && npm test          # vitest — same fixture-ENOENT exception as step 4
cd ../../extension && npm test              # vitest
cd ../apps/authoring-ui-vscode && npm test  # grunt `test` — see caveat below
cd ../..
```

All three suites must pass — OntoGraph-lite's pre-existing fixture-`ENOENT` failures from step 4 are the only acceptable exception. `authoring-ui-vscode`'s Karma setup (`test/karma.conf.js`, wired into `grunt test` via `grunt-karma`) actually runs now; see `docs/maintenance/upstream-sync.md`'s "Known customizations and how to resolve conflicts in them" for what to preserve there across an `authoring-ui-vscode` upstream sync specifically (that file is a different submodule from this runbook's OntoGraph-lite, but shares the same repo-wide `npm run build-all`/`package:vsix`).

### 15. Build and package

```bash
cd ..  # repo root
npm run build-all && npm run package:vsix
```

Install the resulting VSIX and verify:
- New UI buttons appear in tree-view toolbars
- Selecting an entity in the AuthoringWorkbench highlights it in OntoGraph-lite without stealing focus from the authoring panel
- Clicking an entity in OntoGraph-lite opens/updates the Entity Editor
- Back/Forward navigation buttons work after navigating between entities
- Classification and any other reasoner-bridge feature (`checkConsistency`, DL Query) still succeed — this is the one that silently regresses if step 12 was skipped

If testing via F5 (Extension Development Host) rather than an installed VSIX: fully stop the debug session (Shift+F5) and relaunch rather than using the in-place Restart button. Restart can serve a stale `dist/`, including a Java server child process still holding the old JAR.

---

## Why merge over rebase

Rebase gives cleaner history but requires force-pushing `origin/main` and re-resolving every conflict per-commit rather than once. For ongoing maintenance where the fork has accumulated custom commits, a single merge commit is safer and less error-prone.

---

## Quick status check

```bash
cd apps/OntoGraph-lite && git fetch upstream && git log --oneline main..upstream/main | wc -l
```

If that returns `0`, the submodule is already in sync with upstream.
