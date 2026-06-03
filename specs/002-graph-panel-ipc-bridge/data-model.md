# Data Model: OntoGraph-lite Graph Panel & IPC Bridge

**Date**: 2026-06-03 | **Branch**: `002-graph-panel-ipc-bridge`

## IPC Message Types (cross-extension bridge)

### ConceptFocusMessage

Direction: AuthoringPanel webview → extension.ts → `ontograph.focusEntity`

```ts
interface ConceptFocusMessage {
  command: 'CONCEPT_FOCUS';
  payload: {
    id: string;    // SNOMED CT SCTID (e.g. "404684003")
    label: string; // Human-readable FSN or PT
  };
}
```

### GraphNodeSelectMessage

Direction: OntoGraph-lite `nodeClicked` → `ontographEditor.ipcRoute` → AuthoringPanel webview

```ts
interface GraphNodeSelectMessage {
  command: 'GRAPH_NODE_SELECT';
  payload: {
    id: string; // SNOMED CT SCTID (extracted from IRI) or raw IRI if not SNOMED
  };
}
```

### IpcMessage (union)

```ts
type IpcMessage = ConceptFocusMessage | GraphNodeSelectMessage;
```

## VS Code Command Signatures

| Command ID | Caller | Parameters | Handler |
|------------|--------|------------|---------|
| `ontographEditor.ipcRoute` | AuthoringPanel, OntoGraph-lite | `message: IpcMessage` | `extension.ts` IPC router |
| `ontographEditor.openGraph` | User (command palette) | none | `extension.ts` → delegates to `ontograph.openGraph` |
| `ontograph.focusEntity` | `extension.ts` IPC router | `iri: string` | OntoGraph-lite `extension.ts` |
| `ontograph.openGraph` | `extension.ts` | `entity?: TreeItem` | OntoGraph-lite (existing) |

## SNOMED IRI Mapping

- SCTID to IRI: `http://snomed.info/id/${sctid}`
- IRI to SCTID: match `/\/id\/(\d+)$/` — fall back to raw IRI if no match

## AuthoringPanel Addition

| Method | Signature | Description |
|--------|-----------|-------------|
| `postMessage` | `static postMessage(msg: IpcMessage): void` | Forward inbound IPC message into the authoring webview |
