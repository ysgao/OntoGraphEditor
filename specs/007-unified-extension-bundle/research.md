# Research: Unified VSIX Extension Bundle

## Decision: Build Orchestration
We will use the root `package.json` to orchestrate builds for both submodules.
- `apps/OntoGraph-lite`: `npm run build` (produces `dist/*.js`)
- `apps/authoring-ui-vscode`: `npm install && npx grunt build` (produces `dist/` with HTML/JS/CSS)

The main `extension/esbuild.mjs` will be updated to:
1. Bundle its own `extension.ts`.
2. Bundle `OntoGraph-lite`'s worker and server scripts.
3. Bundle `OntoGraph-lite`'s webviews.

## Decision: Unified Extension Host
We will merge the logic of `apps/OntoGraph-lite/src/extension.ts` into a new file `extension/src/graph/activateGraph.ts`.
The main `extension/src/extension.ts` will then call:
```typescript
import { activate as activateGraph } from './graph/activateGraph';
// ...
export async function activate(context: vscode.ExtensionContext) {
    // ... main activation
    activateGraph(context);
    // ...
}
```

## Decision: Resource Mapping
- Authoring UI resources: `apps/authoring-ui-vscode/dist/`
- OntoGraph-lite resources: `apps/OntoGraph-lite/dist/`

The VSIX will include these in its `dist/` folder:
- `dist/extension.js`
- `dist/graph/` (assets from OntoGraph-lite)
- `dist/authoring/` (assets from authoring-ui)

## Alternatives Considered
- **Keeping separate VSIXs**: Rejected by user request.
- **Using a shared library**: Too much refactoring for legacy AngularJS and existing OntoGraph-lite code. Bundling at the extension level is cleaner.

## Decision: package.json Merging
All `contributes` from `apps/OntoGraph-lite/package.json` will be manually merged into `extension/package.json`. We must ensure no ID collisions.
- Command IDs: `ontograph.*` vs `ontographEditor.*` (no collision)
- View IDs: `ontograph.*` (no collision)
- Language IDs: `owl-functional`, `manchester`, `owl-xml` (no collision)
