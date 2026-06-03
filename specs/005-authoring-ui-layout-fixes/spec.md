# Feature Specification: Authoring UI Layout Fidelity Fixes

**Feature Branch**: `005-authoring-ui-layout-fixes`

**Created**: 2026-06-03

**Status**: Draft

**Input**: User description: "improve the UI in the authoringUI-vscode. The display is not exact the same to the original webapp. The diagram in the middle can be hidden to utilise the space fully. The editing column is not aligned to the right edge."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hide Centre Diagram to Maximise Editing Space (Priority: P1)

A clinical terminology editor working in the VS Code authoring panel wants to collapse or hide the diagram panel in the centre of the layout so they can use the full available width for the data entry and editing columns. When the diagram is hidden, the remaining panels expand to fill the space. When revealed again, the layout returns to its previous state.

**Why this priority**: The diagram occupies significant horizontal screen real estate. Hiding it is the fastest way to improve editor productivity on smaller screens or when graph context is not needed during a focused editing session.

**Independent Test**: Open the authoring panel, locate the diagram toggle control, click to hide the diagram — confirm the editing columns expand to fill the freed space. Click again — confirm the diagram reappears and the layout returns to normal.

**Acceptance Scenarios**:

1. **Given** the authoring panel is open with the diagram visible, **When** the user clicks the diagram hide/collapse control, **Then** the diagram panel is hidden and the adjacent editing columns expand to fill the full available width.
2. **Given** the diagram is hidden, **When** the user clicks the diagram show/expand control, **Then** the diagram panel reappears and the layout returns to the default proportions.
3. **Given** the user has hidden the diagram and switches away from the authoring tab, **When** they return to the authoring tab, **Then** the diagram visibility state is preserved (still hidden).

---

### User Story 2 - Editing Column Aligns to Right Edge (Priority: P1)

A clinical terminology editor notices the editing column does not extend to the right edge of the panel — there is unexpected whitespace or misalignment. After this fix, the editing column fills the full available width of the panel, matching the layout of the original web application.

**Why this priority**: Misaligned columns reduce usable editing area and create visual inconsistency versus the upstream application, reducing user trust in the VS Code environment.

**Independent Test**: Open the authoring panel side-by-side with the original web application at the same viewport width. Verify the editing column in VS Code reaches the right edge with no unexplained gap.

**Acceptance Scenarios**:

1. **Given** the authoring panel is open, **When** the user views the editing column, **Then** the column extends to the right boundary of the panel with no unexplained whitespace gap.
2. **Given** the panel is resized (made wider or narrower), **When** the user inspects the editing column, **Then** it continues to fill the available width edge-to-edge at any panel width.
3. **Given** the editing column alignment fix is applied, **When** a user places the original web application and the VS Code panel side-by-side, **Then** the layout proportions are visually equivalent.

---

### User Story 3 - Overall Display Parity with Original Web Application (Priority: P2)

A clinical terminology editor switching between the browser-based authoring UI and the VS Code version notices visual discrepancies beyond the two specific issues above. After this feature, the VS Code panel renders at parity with the upstream web application for all visible layout elements (spacing, column widths, typography, panel proportions).

**Why this priority**: Visual parity builds user confidence and reduces cognitive switching cost. Secondary to the two specific layout bugs above, which are the highest-impact fixes.

**Independent Test**: Conduct a side-by-side visual comparison between the original web application and the VS Code panel using the same concept record. Identify and confirm no visible layout discrepancies remain in spacing, column proportions, or panel boundaries.

**Acceptance Scenarios**:

1. **Given** the same concept record is open in both the original web app and the VS Code authoring panel, **When** viewed side-by-side at matching viewport widths, **Then** all major layout regions (header, editing columns, side panels) are visually equivalent.
2. **Given** a user familiar with the original web application, **When** they use the VS Code authoring panel for the first time after this fix, **Then** they can locate all controls and columns without reorientation.

---

### Edge Cases

- What happens when the VS Code panel is very narrow (< 600px) and the diagram is shown — does collapsing it still provide a meaningful editing area?
- How does the layout behave if the user has VS Code in a split-editor configuration with the authoring panel on one side?
- What happens if the user resizes the VS Code window while the diagram is hidden — does the editing column continue to fill correctly?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The authoring panel MUST provide a visible control (button or toggle) to hide and show the centre diagram panel.
- **FR-002**: When the diagram is hidden, the editing columns MUST expand to occupy the full available panel width without any gap or overflow.
- **FR-003**: When the diagram is shown again, the layout MUST return to proportions matching the original web application layout.
- **FR-004**: The diagram visibility state MUST persist when the user switches away from and returns to the authoring tab within the same session.
- **FR-005**: The editing column MUST align flush with the right edge of the panel at all supported panel widths — no unexplained whitespace gap on the right side.
- **FR-006**: The overall panel layout (spacing, column widths, proportions) MUST visually match the original web application when viewed at equivalent viewport widths.
- **FR-007**: Layout fixes MUST NOT alter the functional behaviour of any existing authoring controls (form fields, buttons, navigation).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The diagram panel can be hidden and restored in 1 click, with the editing area expanding to fill 100% of available width within 300ms.
- **SC-002**: Zero unexplained whitespace gap on the right edge of the editing column at any panel width between 400px and 1920px.
- **SC-003**: A side-by-side visual comparison between the original web application and the VS Code panel identifies no layout discrepancies in the 3 primary layout regions (header, editing columns, side panels), as assessed by the feature author.
- **SC-004**: Diagram visibility state survives at least one tab-switch cycle within a session.
- **SC-005**: No existing authoring control (form field, save button, navigation link) is non-functional after the layout changes.

## Assumptions

- The authoring panel already loads the Angular authoring UI inside a VS Code webview — layout issues are CSS/style discrepancies introduced by the webview sandbox, not missing functionality.
- "The diagram in the middle" refers to the relationship diagram or concept map rendered in the centre column of the authoring UI layout.
- The right-edge alignment issue is a CSS gap (e.g., missing `width: 100%`, unexpected margin/padding, or scrollbar offset) rather than a data rendering issue.
- Visual parity is assessed against the upstream `IHTSDO/authoring-ui` web application running in a standard browser at equivalent viewport widths.
- Mobile and touch-screen support is out of scope — target environment is a desktop VS Code window.
- The diagram hide/show control does not need to persist across VS Code restarts (session-scoped state is sufficient for v1).
