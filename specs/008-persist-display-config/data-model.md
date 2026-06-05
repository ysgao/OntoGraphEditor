# Data Model: Persist Display Configuration

**Date**: 2026-06-05

## DisplayConfig

Represents the persisted layout preferences for the authoring-ui-vscode panel.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `treeViewWidth` | `number` | Tree-view panel width in pixels | > 0; clamped to [100, screenWidth - 200] on restore |
| `editorWidth` | `number` | Editor panel width in pixels | > 0; clamped to [200, screenWidth - 100] on restore |
| `displayScheme` | `string` | Active display scheme identifier | Non-empty string; must match known scheme ID |
| `mode` | `string` | Active mode identifier (e.g., "edit", "view") | Non-empty string; must match known mode ID |

**Storage key**: `ontograph.authoringUi.displayConfig` (in `globalState`)

**Default values** (when no saved config):
- `treeViewWidth`: `280`
- `editorWidth`: `600`
- `displayScheme`: `"default"`
- `mode`: `"edit"`

## State Transitions

```
Extension activates
  → read globalState("ontograph.authoringUi.displayConfig")
  → if null: use defaults
  → send DISPLAY_CONFIG_INIT to webview

User resizes tree-view / editor
  → webview debounces 300 ms
  → sends DISPLAY_CONFIG_CHANGE { treeViewWidth | editorWidth }
  → extension host merges partial update into saved config
  → writes to globalState

User changes scheme or mode
  → webview sends DISPLAY_CONFIG_CHANGE { displayScheme | mode }
  → extension host merges and writes immediately
```

## Schema Versioning

Config object includes a `schemaVersion: number` field (current: `1`). On load, if `schemaVersion` is absent or differs from current, reset to defaults to avoid stale/incompatible values.
