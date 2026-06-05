# IPC Contract: Display Config Persistence

**Date**: 2026-06-05

## Message Types

### DISPLAY_CONFIG_CHANGE (webview → extension host)

Sent by the Angular webview when any display config value changes.

```typescript
{
  command: "DISPLAY_CONFIG_CHANGE";
  payload: Partial<{
    treeViewWidth: number;
    editorWidth: number;
    displayScheme: string;
    mode: string;
  }>;
}
```

- Payload is a **partial** update — only changed fields need be included.
- Extension host merges payload into stored config and persists.

### DISPLAY_CONFIG_INIT (extension host → webview)

Sent by the extension host after the webview signals ready. Delivers the full saved config.

```typescript
{
  command: "DISPLAY_CONFIG_INIT";
  payload: {
    treeViewWidth: number;
    editorWidth: number;
    displayScheme: string;
    mode: string;
    schemaVersion: number;
  };
}
```

- Webview applies all values on receipt.
- If webview receives this before layout is initialized, it queues and applies on init.

## Extension Host Interface

```typescript
interface IDisplayConfigStore {
  load(): DisplayConfig;
  save(partial: Partial<DisplayConfig>): void;
}
```

Implemented by `DisplayConfigStore` in `extension/src/authoring/displayConfig.ts`.
