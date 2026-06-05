# Feature Specification: Persist Display Configuration

**Feature Branch**: `008-persist-display-config`

**Created**: 2026-06-05

**Status**: Draft

**Input**: Save the display config in the authoring-ui-vscode. The display scheme and width of tree-view and mode, and editor can be changed and saved in the config. However, the config is lost when the app restarted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Display Config Survives Restart (Priority: P1)

A clinician adjusts the tree-view width and editor panel width to suit their workflow, closes VS Code, then reopens it. Their layout is restored exactly as they left it.

**Why this priority**: The core pain point — losing layout every restart — blocks repeated use.

**Independent Test**: Resize tree-view, close and reopen extension, verify widths are restored.

**Acceptance Scenarios**:

1. **Given** user has resized the tree-view panel, **When** the extension restarts, **Then** tree-view width is restored to the saved value.
2. **Given** user has resized the editor panel, **When** the extension restarts, **Then** editor width is restored.
3. **Given** no saved config exists yet, **When** the extension starts, **Then** default layout is applied without error.

---

### User Story 2 - Display Scheme Persists (Priority: P2)

A user switches between display schemes (e.g., compact vs. expanded, dark vs. light mode for ontology rendering), closes VS Code, and reopens — the scheme is still active.

**Why this priority**: High-value UX but only meaningful after widths work.

**Independent Test**: Switch scheme, restart, verify scheme is active.

**Acceptance Scenarios**:

1. **Given** user has changed the display scheme, **When** the extension restarts, **Then** the same scheme is active.
2. **Given** user switches scheme multiple times, **When** the extension restarts, **Then** only the last-selected scheme is applied.

---

### User Story 3 - Mode Selection Persists (Priority: P3)

A user selects a particular mode (e.g., edit mode vs. view mode) in the authoring UI, closes the panel, reopens it in the same session, and finds their mode preserved.

**Why this priority**: Nice-to-have; mode is often intentionally reset per-session.

**Independent Test**: Select mode, close and reopen panel, verify mode retained.

**Acceptance Scenarios**:

1. **Given** user has selected a mode, **When** the panel is closed and reopened within the same session, **Then** the mode is restored.
2. **Given** user selected a mode in a previous session, **When** the extension restarts, **Then** the mode is restored.

---

### Edge Cases

- What happens when saved config values are invalid or corrupt? → Apply defaults, do not crash.
- What happens when a previously saved panel width is wider than current screen? → Clamp to screen bounds.
- What happens when config schema changes between extension versions? → Migrate gracefully or reset to defaults.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST save tree-view panel width to persistent storage when the user resizes it.
- **FR-002**: The extension MUST save editor panel width to persistent storage when the user resizes it.
- **FR-003**: The extension MUST save the selected display scheme to persistent storage when the user changes it.
- **FR-004**: The extension MUST save the selected mode to persistent storage when the user changes it.
- **FR-005**: The extension MUST restore all saved display settings when the extension activates (app restart or panel reopen).
- **FR-006**: The extension MUST apply default layout values when no saved config exists.
- **FR-007**: The extension MUST handle corrupted or incompatible saved config without crashing, falling back to defaults.
- **FR-008**: Saved config MUST persist across VS Code restarts (not just panel close/open within same session).

### Key Entities

- **DisplayConfig**: Persisted user preferences — tree-view width, editor width, display scheme, mode selection.
- **ConfigStore**: Abstraction for reading and writing the config to durable storage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After restart, all four config values (tree width, editor width, scheme, mode) are restored to values set in the previous session — 100% of the time under normal conditions.
- **SC-002**: Config is saved within 500 ms of the user completing a resize or selection change.
- **SC-003**: Extension activates without error when no saved config is present (fresh install scenario).
- **SC-004**: Extension activates without error when saved config is corrupt or from an older schema version.

## Assumptions

- "App restarted" means VS Code is fully closed and reopened, not just the webview panel toggled.
- Display scheme refers to visual presentation options exposed in the authoring-ui-vscode UI (not VS Code's own theme).
- Mode refers to the view/edit mode within the authoring UI panel.
- Config is per-user, per-workspace (not shared across workspaces).
- Mobile/multi-window sync is out of scope.
- The authoring-ui-vscode Angular app communicates panel state to the VS Code extension host via the existing IPC bridge.
