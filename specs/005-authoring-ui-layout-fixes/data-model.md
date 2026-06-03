# Data Model: Authoring UI Layout Fidelity Fixes

**Feature**: 005-authoring-ui-layout-fixes | **Date**: 2026-06-03

## UI State Entities

### `thisView` (AngularJS `$scope` variable in `editCtrl.js`)

Controls which layout variant is rendered. Relevant values for this feature:

| Value | Description | Diagram shown | Edit col width |
|-------|-------------|---------------|----------------|
| `edit-default` | Default — sidebar + diagram + edit | ✓ | `getLayoutWidths('concepts')` |
| `edit-no-sidebar` | No left sidebar — diagram + edit | ✓ | `col-md-5` |
| `edit-no-model` | No diagram — edit fills full width | ✗ | `col-md-12` (or `getLayoutWidths('modelsAndConcepts')`) |

### Layout Width Overrides (`$rootScope.layoutWidths`)

Dynamic Bootstrap column class calculator managed by `layoutHandler.js`. Returns arrays of `col-sm-X col-md-X col-lg-X` classes.

| Key | Default value (col units out of 12) | Meaning |
|-----|-------------------------------------|---------|
| `modelsAndConcepts` | 12 (when no sidebar) | Outer wrapper width |
| `models` | 7 | Diagram column width |
| `concepts` | 5 | Edit column width |

### CSS Body Class: `vscode-webview`

Injected by inline script in `index.html` when `acquireVsCodeApi` is present. Gates all webview-specific CSS overrides.

| State | Body class present | CSS overrides active |
|-------|--------------------|----------------------|
| Running in VS Code webview | ✓ | ✓ |
| Running in standard browser | ✗ | ✗ |

## Files Changed

| File | Change type | Purpose |
|------|-------------|---------|
| `app/styles/vscode-overrides.scss` | NEW | All webview-scoped layout corrections |
| `app/index.html` | PATCH (1 line) | Inject `.vscode-webview` body class |
| `app/index.html` | PATCH (1 `<link>` tag) | Add `<link rel="stylesheet" href="styles/vscode-overrides.css">` — Grunt auto-compiles all `*.scss` in `app/styles/`, no entry-point import needed |
| `app/components/edit/edit.html` | VERIFY ONLY | Confirm `edit-no-model` div structure matches override selectors |
