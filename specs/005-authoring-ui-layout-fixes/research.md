# Research: Authoring UI Layout Fidelity Fixes

**Feature**: 005-authoring-ui-layout-fixes | **Date**: 2026-06-03

## Finding 1: Button-Nav Top Offset Root Cause

**Root cause**: `editpanel.scss:929` sets `.button-nav { position: fixed; top: 64px; }`. In a browser, 64px accounts for the browser chrome (tab bar + URL bar). In VS Code webview, the webview panel renders without any browser chrome — the panel content starts at `top: 0`. Result: the button-nav appears 64px lower than intended, cutting off the top action buttons.

**Decision**: Add `.vscode-webview .button-nav { top: 0px; }` in the override stylesheet.

**Rationale**: Zero-offset places the button-nav at the true top of the webview panel, matching the original browser experience.

**Alternatives considered**:
- Patching `editpanel.scss` directly — rejected: would break the app in standard browser where 64px is correct
- Using a VS Code webview CSS variable (`--vscode-*`) — considered but VS Code does not expose a variable for panel offset height

---

## Finding 2: Edit Column Right-Edge Gap Root Cause

**Root cause**: Two compounding issues:

1. VS Code webview body has `padding: 0 20px` by default (VS Code's webview host stylesheet injects this to make text readable). This 20px right padding reduces the effective content width, so Bootstrap's 12-column grid calculates widths based on a narrower container — but the `pull-right` float of the edit column tries to snap to the true right edge of the body, landing 20px inside the panel edge.

2. `modelsConceptsView.html` line 3: the wrapper div has both `ng-class="getLayoutWidths('modelsAndConcepts')"` (returning something like `col-md-11`) AND `pull-right`. When Bootstrap column width + body padding don't add up to 100%, the `pull-right` leaves a visible gap.

**Decision**: Add the following to `vscode-overrides.scss`:
```scss
.vscode-webview body {
  padding: 0 !important;
  margin: 0 !important;
  box-sizing: border-box;
}
.vscode-webview .sca-container {
  width: 100%;
  box-sizing: border-box;
}
```
And patch `modelsConceptsView.html` to remove the `pull-right` class on the outer wrapper when running in webview (or override `pull-right` to `float: none; width: 100%` for `.vscode-webview`).

**Rationale**: Resetting body padding to 0 in webview mode eliminates the gap. `box-sizing: border-box` prevents padding from reducing effective column widths.

**Alternatives considered**:
- Subtracting 40px from column widths in `layoutHandler.js` — rejected: brittle, device-dependent, not future-proof
- Using `max-width: 100vw` on the container — rejected: `vw` units in webview exclude scrollbar width differently than in browser
- Patching Bootstrap's container-fluid — rejected: too broad, affects all Bootstrap layouts

---

## Finding 3: Diagram Toggle Already Implemented

**Finding**: The "Hide all concept models" button (`hide-concept-model-btn`) already exists at `edit.html:185-190`. It calls `setView('edit-no-model')` which switches `thisView` to a view where the diagram column is removed and the edit column gets `col-md-12`. This is the correct underlying mechanic.

**Decision**: No new toggle logic needed. The task is to fix the `edit-no-model` view so that after hiding the diagram, the edit column truly fills 100% width in webview context (currently affected by the same body padding and `pull-right` issues identified in Finding 2).

**Additional fix needed**: In `edit-no-model` view (`edit.html:294`), the outer div uses `pull-right` + `getLayoutWidths('modelsAndConcepts')`. When in webview, this doesn't expand to full width. Override: `.vscode-webview .edit-no-model > div { float: none; width: 100%; }`.

---

## Finding 4: Body Class Injection Strategy

**Decision**: Inject a `vscode-webview` CSS class on `<body>` when `acquireVsCodeApi()` is available. Do this in `index.html` via a short inline script that runs synchronously before Angular bootstraps.

```html
<script>
  if (typeof acquireVsCodeApi !== 'undefined') {
    document.body.classList.add('vscode-webview');
  }
</script>
```

**Rationale**: Synchronous inline script ensures the class is present before any CSS is applied. All override rules are scoped to `.vscode-webview` — zero impact on standard browser execution.

**Alternatives considered**:
- Injecting via `VsCodeService` on Angular bootstrap — rejected: Angular bootstraps after first paint, causing a layout flash
- Using a CSS media query or environment variable — no reliable CSS-only way to detect webview vs. browser

---

## Finding 5: Build Pipeline Integration

**Finding**: The app uses a Grunt-based build pipeline. SCSS compilation is handled by the `sass` task in `Gruntfile.js`. The `editpanel.scss` and `edit.scss` files are imported into a main stylesheet.

**Decision**: Add `@import 'vscode-overrides'` at the end of the main SCSS entry point so overrides have highest specificity without `!important` (except for the body reset where `!important` is necessary to beat VS Code's injected styles).

**Rationale**: Placing the import at the end of the main stylesheet ensures cascade order gives overrides priority over all base styles.
