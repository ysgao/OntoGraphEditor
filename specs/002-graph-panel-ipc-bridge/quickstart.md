# Quickstart: Feature 002 — OntoGraph-lite Graph Panel & IPC Bridge

## Architecture Summary

OntoGraph-lite is a **companion VS Code extension** — not embedded in our webview. The IPC bridge uses VS Code commands:

```
AuthoringPanel → ontographEditor.ipcRoute → ontograph.focusEntity → OntoGraph-lite graph
OntoGraph-lite nodeClicked → ontographEditor.ipcRoute → AuthoringPanel.postMessage()
```

## Prerequisites

1. Feature 001 (`authoring-ui-vscode` panel) merged and working
2. OntoGraph-lite cloned at `apps/OntoGraph-lite/` (already done as submodule)
3. Node.js 18+, npm

## Setup

```bash
# Install OntoGraph-lite deps (for type-checking changes to the submodule)
cd apps/OntoGraph-lite && npm install && cd ../..

# Build extension bundle
npm run build:extension
```

## Run / Debug

1. Open repo root in VS Code
2. Also open `apps/OntoGraph-lite/` in the **same** VS Code window (multi-root workspace) **OR** launch it as a separate extension via its own F5
3. **Run & Debug** → `Launch Extension` (F5) — Extension Development Host opens
4. In EDH, also activate OntoGraph-lite (if not via `extensionDependencies`, manually install/link it)
5. Open an OWL ontology file in EDH to give OntoGraph-lite a loaded model
6. `Cmd+Shift+P` → "OntoGraph: Open Visualization Display" — delegates to OntoGraph-lite
7. `Cmd+Shift+P` → "OntoGraph: Open Editing Workbench" — opens authoring panel
8. Select concept in authoring → graph navigates to concept

## Type-Check Both Extensions

```bash
# OntoGraph Editor extension
cd extension && npm run compile && cd ..

# OntoGraph-lite submodule
cd apps/OntoGraph-lite && npm run compile && cd ..
```

## Key Files Changed

| File | Repo | Change |
|------|------|--------|
| `extension/src/extension.ts` | OntoGraph Editor | Add `openGraph` + `ipcRoute` commands |
| `extension/src/authoringPanel.ts` | OntoGraph Editor | Add `static postMessage()` |
| `extension/src/ipcMessages.ts` | OntoGraph Editor | New: IPC type definitions |
| `extension/package.json` | OntoGraph Editor | Add `extensionDependencies` |
| `src/extension.ts` | OntoGraph-lite | Register `ontograph.focusEntity` |
| `src/commands/openVisualization.ts` | OntoGraph-lite | Wire `nodeClicked` to `ontographEditor.ipcRoute` |
| `package.json` | OntoGraph-lite | Add `focusEntity` to `contributes.commands` |

## Testing IPC manually

In Extension Development Host debug console:
```ts
// Test CONCEPT_FOCUS -> graph navigation
vscode.commands.executeCommand('ontographEditor.ipcRoute', {
  command: 'CONCEPT_FOCUS',
  payload: { id: '404684003', label: 'Clinical finding' }
});

// Test GRAPH_NODE_SELECT -> authoring panel
vscode.commands.executeCommand('ontographEditor.ipcRoute', {
  command: 'GRAPH_NODE_SELECT',
  payload: { id: '404684003' }
});
```
