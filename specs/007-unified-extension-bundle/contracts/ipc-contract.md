# IPC Contract: Extension Host <-> Webviews

All communication between the Extension Host and Webviews must use the `postMessage` API with the following structure.

## Base Message Structure

```typescript
interface IpcMessage {
    command: string;
    payload: any;
}
```

## Commands (Extension -> Webview)

### GRAPH_UPDATE
- **Source**: Extension (Graph Logic)
- **Target**: OntoGraph-lite Webview
- **Payload**: `{ nodes: GraphNode[], edges: GraphEdge[], focusIri?: string }`

### AUTHORING_UPDATE
- **Source**: Extension (Authoring Logic)
- **Target**: Authoring UI Webview
- **Payload**: Domain-specific data for the AngularJS workbench.

## Commands (Webview -> Extension)

### GRAPH_NODE_SELECT
- **Source**: OntoGraph-lite Webview
- **Target**: Extension
- **Payload**: `{ id: string }` (SCTID or IRI)
- **Effect**: Extension triggers `ontographEditor.ipcRoute` and notifies Authoring UI.

### AUTHORING_NODE_SELECT
- **Source**: Authoring UI Webview
- **Target**: Extension
- **Payload**: `{ id: string }` (SCTID)
- **Effect**: Extension triggers `ontographEditor.ipcRoute` and notifies Graph View.

