# Data Models and States: Angular UI Integration

This document defines the structured schemas and state-management data formats serialized across the Angular UI and VS Code extension boundaries.

## 1. Webview State Retention Schema

When the VS Code editor panel is hidden or active tabs change, the V8 runtime is suspended or destroyed. We utilize VS Code's native state persistence APIs to retain the app state.

### `WebviewState` Schema

This object is serialized using `acquireVsCodeApi().setState()` and loaded via `getState()` when the Angular app boots.

```typescript
interface WebviewState {
  // Currently focused SNOMED CT concept identifier
  activeConceptId: string | null;
  
  // Human-readable term/label for the active concept
  activeConceptLabel: string | null;
  
  // Last visited routing path to restore navigation on tab restore
  lastVisitedRoute: string;
}
```

## 2. IPC Message Event Schema

All messages passed between the Angular client and the VS Code extension host follow a standard envelope structure.

### `IpcMessageEnvelope`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "OBJECT",
  "properties": {
    "command": {
      "type": "STRING",
      "description": "Identifier of the transaction request or signal"
    },
    "payload": {
      "type": "OBJECT",
      "description": "Metadata arguments matching the command payload signature"
    }
  },
  "required": ["command", "payload"]
}
```
