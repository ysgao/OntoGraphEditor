# Research: OntoGraph-lite Graph Panel & IPC Bridge

**Date**: 2026-06-03 | **Branch**: `002-graph-panel-ipc-bridge`

---

## 1. OntoGraph-lite Architecture Finding

**Finding**: OntoGraph-lite (`https://github.com/ysgao/OntoGraph-lite`) is a full VS Code extension, not a standalone web app. It has:
- Its own extension host (`src/extension.ts`, `dist/extension.js`)
- VS Code TreeView sidebar panels (class hierarchy, object properties, individuals, etc.)
- A Cytoscape graph webview (`webview-src/graph/GraphViewApp.ts` → `dist/graph-webview.js`)
- An in-memory OntologyModel backed by local OWL files (.ofn, .omn, .owl)
- Its own `package.json` manifest with `contributes`, `activationEvents`, `commands`, etc.

**Implication**: Cannot be embedded as a static HTML app in a WebviewPanel from our extension. Must be treated as a companion extension.

---

## 2. Integration Architecture Decision

**Decision**: Companion Extension pattern.

**Rationale**: User confirmed this approach. OntoGraph-lite is a full VS Code extension that the user installs alongside OntoGraph Editor. Our extension declares it as a dependency and wires the IPC bridge via VS Code commands.

**Alternatives considered**:
- Snowstorm-backed graph (serve graph-webview.js in our extension, query Snowstorm for data) — rejected by user
- OWL file-backed (reuse OntoGraph-lite's OntologyModel) — rejected by user
- Bundle OntoGraph-lite source into our extension — more complex, harder to maintain

---

## 3. Companion Extension IPC Bridge

**Decision**: Use VS Code command registration as the IPC channel between the two extensions.

**Rationale**: VS Code commands are the only reliable cross-extension communication mechanism. Both extensions can call each other's registered commands without importing each other directly.

**Bridge commands**:

| Direction | Command | Caller | Handler |
|-----------|---------|--------|---------|
| AuthoringUI → Graph | `ontograph.focusEntity` | OntoGraph Editor (`extension.ts`) | OntoGraph-lite (new) |
| Graph → AuthoringUI | `ontographEditor.ipcRoute` | OntoGraph-lite (new `nodeClicked` handler) | OntoGraph Editor (`extension.ts`) |

**Flow for CONCEPT_FOCUS (Authoring → Graph)**:
1. AuthoringPanel emits `{ command: 'CONCEPT_FOCUS', payload: { id: '404684003', label: '...' } }`
2. `authoringPanel.ts` calls `vscode.commands.executeCommand('ontographEditor.ipcRoute', message)`
3. `extension.ts` `ipcRoute` handler detects `CONCEPT_FOCUS` → translates SCTID to SNOMED IRI (`http://snomed.info/id/404684003`) → calls `vscode.commands.executeCommand('ontograph.focusEntity', iri)`
4. OntoGraph-lite's `focusEntity` command handler calls `openGraphView(context, model, iri)`

**Flow for GRAPH_NODE_SELECT (Graph → Authoring)**:
1. User clicks node in OntoGraph-lite's graph panel
2. OntoGraph-lite's `nodeClicked` handler calls `vscode.commands.executeCommand('ontographEditor.ipcRoute', { command: 'GRAPH_NODE_SELECT', payload: { id: sctid } })` — guarded by `if (vscode.commands.getCommands(true))` check so it's a no-op when OntoGraph Editor is absent
3. `extension.ts` `ipcRoute` handler detects `GRAPH_NODE_SELECT` → forwards to `AuthoringPanel.postMessage(msg)`

---

## 4. OntoGraph-lite Changes Required

Two minimal additions to `apps/OntoGraph-lite/` (non-breaking):

### 4a. New command: `ontograph.focusEntity`

Register in `src/extension.ts` alongside existing commands:
```ts
vscode.commands.registerCommand('ontograph.focusEntity', (iri: string) => {
  openGraphView(context, model, iri);
});
```

Also register in `package.json` contributes.commands:
```json
{ "command": "ontograph.focusEntity", "title": "OntoGraph: Focus Entity by IRI" }
```

### 4b. Patch `nodeClicked` handler in `src/commands/openVisualization.ts`

Replace the `// Nothing for now — could reveal in tree` comment:
```ts
} else if (msg.type === 'nodeClicked') {
  // Extract SNOMED CT concept SCTID from IRI if applicable
  const sctid = extractSctid(msg.iri);
  const id = sctid ?? msg.iri;
  vscode.commands.executeCommand('ontographEditor.ipcRoute', {
    command: 'GRAPH_NODE_SELECT',
    payload: { id },
  }).then(undefined, () => { /* ontographEditor not installed — silent no-op */ });
}
```

```ts
function extractSctid(iri: string): string | undefined {
  const match = /\/id\/(\d+)$/.exec(iri) ?? /[/#](\d{6,18})$/.exec(iri);
  return match?.[1];
}
```

---

## 5. OntoGraph Editor Changes Required

### 5a. `extension/package.json`

Add `extensionDependencies`:
```json
"extensionDependencies": ["ysgao.ontograph-lite"]
```

### 5b. `extension.ts`

Register two new commands:

**`ontographEditor.openGraph`**: Delegates to OntoGraph-lite:
```ts
vscode.commands.registerCommand('ontographEditor.openGraph', () => {
  vscode.commands.executeCommand('ontograph.openGraph');
});
```

**`ontographEditor.ipcRoute`**: Central broker:
```ts
vscode.commands.registerCommand('ontographEditor.ipcRoute', (message: IpcMessage) => {
  if (isConceptFocus(message)) {
    const sctid = message.payload.id;
    const iri = `http://snomed.info/id/${sctid}`;
    vscode.commands.executeCommand('ontograph.focusEntity', iri).then(
      undefined,
      () => { /* ontograph not available */ }
    );
  } else if (isGraphNodeSelect(message)) {
    AuthoringPanel.postMessage(message);
  }
});
```

### 5c. `authoringPanel.ts`

Add `static postMessage(msg: IpcMessage): void`.

---

## 6. SNOMED IRI Convention

**Decision**: Use `http://snomed.info/id/<sctid>` as the canonical IRI format for SNOMED CT concept nodes in OntoGraph-lite.

**Rationale**: This is the official IHTSDO-published IRI namespace for SNOMED CT entities. OntoGraph-lite uses IRIs as node identifiers — the SNOMED OWL release files use this namespace.

**IRI ↔ SCTID translation**:
- SCTID to IRI: `http://snomed.info/id/${sctid}`
- IRI to SCTID: extract trailing digits after `/id/`

---

## 7. Data Model Compatibility

**Finding**: OntoGraph-lite shows graph data from locally loaded OWL files. For CONCEPT_FOCUS to navigate to a SNOMED concept, the user must have a SNOMED CT OWL release loaded in OntoGraph-lite (or a relevant subset).

**Implication**: The IPC bridge correctly routes signals, but the graph visualization only shows data if an OWL file containing the concept is loaded. This is expected behavior — the feature delivers the bridge; data availability depends on the loaded ontology.

**User-facing behavior when concept not in loaded ontology**: OntoGraph-lite's `openGraphView` will show an empty/root graph (existing behavior — `focusIri` not found in model falls back to top-level classes). Acceptable for v1.

---

## 8. Build Integration

**Decision**: Do NOT build OntoGraph-lite as part of `build-all`.

**Rationale**: In the companion extension model, OntoGraph-lite is a separately installed VS Code extension. It has its own build and publish pipeline. Users install it from the VS Code marketplace (or build themselves) — not as a build artifact of this project.

**Root `package.json`**: No changes to `build-all`.

---

## 9. Implementation Details (Final)

### Loop Prevention

**Flag name**: `suppressNextSelection` (module-level `let` inside `activate()` closure in `apps/OntoGraph-lite/src/extension.ts`)

**Mechanism**:
- Set to `true` in `ontograph.focusEntity` handler **only when** `item?.fromIpc === true` (IPC-driven call)
- Cleared to `false` on the first suppressed call inside `onEntitySelected`
- User-initiated Entity Editor navigation calls `ontograph.focusEntity` **without** `fromIpc` → flag stays `false` → GRAPH_NODE_SELECT dispatches normally

**Caller fix**: `ontographEditor.ipcRoute` passes `{ iri, fromIpc: true }` to `ontograph.focusEntity` — this is the required complement to the flag check. Without `fromIpc: true`, the flag is never set and loop prevention does not activate.

### extractSctid Pattern

**Final implementation** (in `apps/OntoGraph-lite/src/extension.ts`):
```ts
function extractSctid(iri: string): string | undefined {
  return /\/id\/(\d+)$/.exec(iri)?.[1];
}
```

Strict match on `/id/<digits>` suffix. Used in `onEntitySelected` before dispatching GRAPH_NODE_SELECT.

### Entity Editor Integration

**Finding**: `EntityEditorPanel.ts` already dispatches `ontograph.focusEntity` for all user entity navigation (cases `'navigate'` and `'focusEntity'` in the webview message handler at lines ~460-466). No additional wiring needed — Entity Editor is fully integrated via the `focusEntity` path.

**DL Query Integration**: DL Query results call `revealFn` (= `revealInTreeView`) → triggers `onDidChangeSelection` → `onEntitySelected` → dispatches GRAPH_NODE_SELECT. Already integrated with no additional code.

---

## Summary of Unknowns — All Resolved

| # | Unknown | Resolution |
|---|---------|------------|
| 1 | OntoGraph-lite GitHub URL | `https://github.com/ysgao/OntoGraph-lite` |
| 2 | Integration architecture | Companion extension (user decision) |
| 3 | IPC mechanism between extensions | VS Code commands |
| 4 | SNOMED IRI format | `http://snomed.info/id/<sctid>` |
| 5 | OntoGraph-lite build integration | Not needed — separate extension |
