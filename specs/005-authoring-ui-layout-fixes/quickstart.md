# Visual Testing Guide: Authoring UI Layout Fixes

**Feature**: 005-authoring-ui-layout-fixes

Use this guide to manually verify all three layout fixes after implementation.

---

## Prerequisites

- VS Code with OntoGraph Editor extension loaded in Extension Development Host (F5)
- The original `IHTSDO/authoring-ui` web app accessible in a browser at matching viewport width
- A task/project loaded in the authoring panel with at least one concept visible

---

## Test 1: Button-Nav Top Offset

**What to check**: The button-nav (narrow 50px strip on the left) should start at the very top of the authoring panel — not 64px down.

**Steps**:
1. Open the authoring panel in VS Code Extension Development Host.
2. Inspect the top edge of the left button strip.

**Pass**: The button strip starts flush with the top of the panel. All buttons are fully visible and none are clipped at the top.

**Fail**: There is a 64px gap above the button strip, or the top action buttons are partially hidden.

---

## Test 2: Edit Column Right-Edge Alignment

**What to check**: The editing column (grey/dark background) should reach the right edge of the panel — no whitespace gap on the right.

**Steps**:
1. Open the authoring panel with a concept loaded (default view).
2. Drag the VS Code panel edge to vary the panel width between ~600px and ~1200px.
3. At each width, inspect the right edge of the editing column.

**Pass**: The grey editing column reaches the right edge of the panel at all tested widths. Zero visible gap between the column and the panel boundary.

**Fail**: A white gap (typically ~20px) is visible on the right side of the editing column that does not belong to any content region.

**Side-by-side comparison**:
1. Open the original IHTSDO web app in a browser window.
2. Resize both windows to the same width.
3. Compare the right edge of the editing column. They should look identical.

---

## Test 3: Diagram Toggle — Hide and Restore

**What to check**: Clicking "Hide all concept models" removes the diagram and expands the edit column to full panel width. Clicking it again (or a restore button) brings the diagram back.

**Steps**:
1. Open the authoring panel with a concept loaded.
2. Locate the button-nav on the left (icons-only strip).
3. Find the "Hide all concept models" button (grid-off icon).
4. Click it.

**Pass (hide)**: The diagram column disappears. The editing column expands to fill 100% of the panel width with no right-side gap.

**Fail (hide)**: The diagram disappears but the editing column does not expand, leaving blank space where the diagram was.

5. Click the equivalent "show models" toggle or the default view button to restore.

**Pass (restore)**: The diagram reappears and the layout returns to the side-by-side default.

---

## Test 4: Tab-Switch State Preservation

**What to check**: Hiding the diagram survives a tab switch.

**Steps**:
1. Hide the diagram (Test 3 above).
2. Click to a different VS Code tab (e.g., a source file).
3. Click back to the authoring tab.

**Pass**: The diagram remains hidden. The edit column still fills full width.

**Fail**: The diagram reappears unexpectedly after the tab switch.

---

## Test 5: No Functional Regressions

**What to check**: All authoring controls work after layout fixes.

**Steps**:
1. With the diagram visible, create a new concept.
2. Edit an existing concept — change a description field.
3. Save the concept.
4. Hide the diagram and repeat steps 1-3.

**Pass**: All actions complete successfully in both layout states.

**Fail**: Any form field, button, or navigation control fails to respond in either layout state.
