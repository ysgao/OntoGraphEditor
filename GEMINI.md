<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/007-unified-extension-bundle/plan.md
<!-- SPECKIT END -->

## Project Structure

```
extension/
├── package.json         # Unified extension manifest (commands, views, config)
├── esbuild.mjs          # Unified build: extension host + webview bundles
└── src/
    ├── extension.ts     # Unified entry point — activates both graph and authoring
    ├── authoring/       # Authoring UI host logic (AuthoringPanel, activateAuthoring)
    ├── graph/           # OntoGraph-lite host logic (activateGraph, views, commands)
    └── shared/          # Shared utilities (LocalProxy, IPC message types)

apps/
├── authoring-ui-vscode/ # Git submodule: AngularJS SNOMED CT authoring UI
└── OntoGraph-lite/      # Git submodule: OWL ontology graph visualization

scripts/
├── sync-submodules.sh   # Initialize submodules + install all dependencies
└── validate-submodules.sh # Guard: verify submodules are present before build
```

## Key Commands

```bash
# First-time setup
./scripts/sync-submodules.sh

# Build everything
npm run build-all        # validate → build:client → build:graph → build:extension

# Individual steps
npm run build:client     # Grunt build for authoring-ui-vscode
npm run build:graph      # npm build for OntoGraph-lite
npm run build:extension  # esbuild bundle only (extension host + webviews)

# Package and publish
npm run package:vsix     # → extension/dist/ontograph-editor-extension-{version}.vsix
npm run lint             # ESLint on extension/src
npm run test             # Extension tests
```

### Build Artifact Layout (extension/dist/)

| File | Description |
|------|-------------|
| `extension.js` | Unified extension host (CJS) |
| `parserWorker.js` | OWL parser worker thread (CJS) |
| `server.js` | OWL/Manchester language server (CJS) |
| `graph-webview.js` | Graph visualization webview (ESM) |
| `entity-editor-webview.js` | OWL entity editor webview (ESM) |
| `sparql-editor-webview.js` | SPARQL editor webview (ESM) |
| `dl-query-webview.js` | DL query panel webview (ESM) |
| `chunks/` | Shared ESM chunks (codemirror et al.) |
| `authoring/` | Built AngularJS app assets (copied from submodule dist) |

### Packaging and Release

- VSIX output: `extension/dist/ontograph-editor-extension-{version}.vsix`
- Publish manually: `(cd extension && npx vsce publish --pat $VSCE_PAT)`
- CI auto-publish: push a version tag — `.github/workflows/release.yml` triggers on `v*.*.*` tags
- Set `VSCE_PAT` as a GitHub repository secret before CI publishing works
