# Feature Specification: OntoGraph-lite Graph Panel and IPC Bridge

**Feature Branch**: `002-graph-panel-ipc-bridge`

**Created**: 2026-06-03

**Status**: Draft

**Input**: Next feature derived from OntoGraphEditorSpec.md — wires the bidirectional IPC bridge between the OntoGraph Editor authoring panel and all OntoGraph-lite views.

## Clarifications

### Session 2026-06-03

- Q: What is the scope of entity selection that triggers GRAPH_NODE_SELECT toward AuthoringUI? → A: Any entity selection across ALL OntoGraph-lite panes and tree views — Inferred Hierarchy, Classes, Object Properties, Data Properties, Annotation Properties, Individuals tree views, Graph node click, Entity Editor, and DL Query results.
- Q: What is the scope of CONCEPT_FOCUS from AuthoringUI toward OntoGraph-lite? → A: CONCEPT_FOCUS must update ALL OntoGraph-lite views simultaneously — the graph panel navigates to the entity, AND all relevant tree views reveal the entity.
- Q: How should loop prevention be implemented when CONCEPT_FOCUS triggers programmatic tree view reveal that fires onEntitySelected? → A: Boolean suppression flag in OntoGraph-lite's extension.ts — set before programmatic reveal, checked and cleared in onEntitySelected.
- Q: When CONCEPT_FOCUS arrives, should ontograph.focusEntity auto-open the graph panel if not already open? → A: No — tree views and Entity Editor are shown/updated (existing focusEntity behavior). Graph panel only updates if already open. This preserves current OntoGraph-lite UX.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open OntoGraph-lite Alongside Authoring Workbench (Priority: P1)

A user has the Authoring Workbench open and wants to see the ontology graph context for the concept they are editing. They invoke "OntoGraph: Open Visualization Display" which activates OntoGraph-lite's graph panel alongside the authoring tab.

**Why this priority**: The graph panel is the second core pillar of the unified workspace. Without it, the split-panel authoring experience cannot function.

**Independent Test**: Run the extension with OntoGraph-lite installed, invoke `ontographEditor.openGraph`, and verify OntoGraph-lite's graph panel opens. No authoring panel or IPC is required.

**Acceptance Scenarios**:

1. **Given** OntoGraph Editor and OntoGraph-lite are both installed, **When** a user runs "OntoGraph: Open Visualization Display", **Then** OntoGraph-lite's graph panel opens or is brought to focus.
2. **Given** OntoGraph-lite's graph panel is open, **When** the user switches to another VS Code tab, **Then** the panel retains its state.
3. **Given** "Open Visualization Display" is invoked a second time, **When** the panel is already open, **Then** it is focused rather than duplicated.

---

### User Story 2 - Concept Focus: Authoring drives All OntoGraph-lite Views (Priority: P1)

When a user activates or selects a concept in the Authoring UI tab, all OntoGraph-lite views simultaneously update: the graph panel navigates to and highlights the concept node, and the relevant tree view (Classes, Inferred Hierarchy, Individuals, etc.) reveals and selects the matching entity.

**Why this priority**: Bidirectional synchronization is the primary value proposition. Authoring UI users should see the graph and hierarchy context of any concept they select without manual navigation in OntoGraph-lite.

**Independent Test**: With both panels open and an OWL ontology loaded in OntoGraph-lite, simulate a `CONCEPT_FOCUS { id, label }` message and verify that OntoGraph-lite's graph panel updates AND the correct tree view reveals the entity.

**Acceptance Scenarios**:

1. **Given** both the authoring panel and OntoGraph-lite are open with a loaded ontology, **When** the user activates a concept in the authoring panel (triggering `CONCEPT_FOCUS { id, label }`), **Then** OntoGraph-lite's Entity Editor shows the entity AND the relevant tree view reveals and selects it within 500ms. If the graph panel is already open, it also highlights the concept node.
2. **Given** a `CONCEPT_FOCUS` arrives for a concept not present in the loaded OWL ontology, **When** OntoGraph-lite processes it, **Then** it shows a graceful "entity not found" warning — it does not crash or silently do nothing.
3. **Given** OntoGraph-lite's sidebar is collapsed or graph panel is hidden, **When** a `CONCEPT_FOCUS` arrives, **Then** the message is still processed — views update as soon as they become visible, without message loss.

---

### User Story 3 - Entity Selection: Any OntoGraph-lite View drives Authoring Context (Priority: P1)

When a user selects any entity in any OntoGraph-lite view — any tree view (Inferred Hierarchy, Classes, Object Properties, Data Properties, Annotation Properties, Individuals), the Graph panel, the Entity Editor, or DL Query results — the authoring panel loads and displays the editing fields for that concept.

**Why this priority**: The reverse direction of the IPC bridge is equally essential. Users navigating the ontology from any angle in OntoGraph-lite should be able to instantly switch to editing in the authoring panel without a separate search.

**Independent Test**: With both panels open, select an entity in each OntoGraph-lite view type (at minimum: tree view, graph node) and verify the authoring panel receives `GRAPH_NODE_SELECT { id }` and navigates to the concept's edit view each time.

**Acceptance Scenarios**:

1. **Given** both panels are open, **When** a user selects a class in any tree view (Classes, Inferred Hierarchy, Object Properties, Data Properties, Annotation Properties, Individuals), **Then** the authoring panel navigates to the edit view for that entity within 500ms.
2. **Given** both panels are open, **When** a user clicks a node in OntoGraph-lite's graph panel, **Then** the authoring panel navigates to the edit view for that entity within 500ms.
3. **Given** the authoring panel is hidden (background tab), **When** a `GRAPH_NODE_SELECT` arrives, **Then** the authoring panel processes it on reveal without data loss.
4. **Given** AuthoringUI sends a `CONCEPT_FOCUS` which causes OntoGraph-lite to reveal an entity in the tree view (programmatic selection), **When** that reveal fires `onDidChangeSelection`, **Then** it does NOT send a `GRAPH_NODE_SELECT` back to AuthoringUI (no selection echo loop).

---

### User Story 4 - Unified Command Registration (Priority: P2)

Both `openAuthoring` and `openGraph` commands appear in the VS Code command palette as a cohesive pair.

**Why this priority**: Discoverability. Users should surface both tools without knowing which extension owns which command.

**Independent Test**: Open command palette and confirm both "OntoGraph: Open Editing Workbench" and "OntoGraph: Open Visualization Display" appear and activate their respective panels.

**Acceptance Scenarios**:

1. **Given** both extensions are installed, **When** a user opens the VS Code command palette, **Then** both ontograph commands are listed with clear, descriptive titles.

---

### Edge Cases

- If one panel is closed while a message is in flight, the extension host drops the message gracefully — no unhandled errors.
- If `CONCEPT_FOCUS` fires before OntoGraph-lite has a model loaded, `ontograph.focusEntity` shows a graceful warning and does nothing.
- Programmatic entity reveal (triggered by CONCEPT_FOCUS) must not echo a GRAPH_NODE_SELECT back — loop prevention required.
- If OntoGraph-lite is not installed or not activated, `ontographEditor.ipcRoute` swallows errors silently when calling `ontograph.focusEntity`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST register an `ontographEditor.openGraph` command that delegates to `ontograph.openGraph`, opening or focusing OntoGraph-lite's graph panel.
- **FR-002**: The extension MUST register an `ontographEditor.ipcRoute` command that acts as the central IPC broker routing messages between the authoring panel and OntoGraph-lite.
- **FR-003**: The extension host MUST route `CONCEPT_FOCUS` messages from the authoring panel to OntoGraph-lite by calling `ontograph.focusEntity` with the translated SNOMED IRI (`http://snomed.info/id/<sctid>`).
- **FR-004**: `ontograph.focusEntity` (OntoGraph-lite) MUST show the Entity Editor for the entity AND reveal it in all relevant tree views (existing behavior — preserved). If the graph panel is already open, it MUST also navigate/highlight the entity there. The graph panel MUST NOT be auto-opened.
- **FR-005**: Entity selection in ALL OntoGraph-lite views MUST dispatch `GRAPH_NODE_SELECT` to `ontographEditor.ipcRoute`: this includes all six tree views (Inferred Hierarchy, Classes, Object Properties, Data Properties, Annotation Properties, Individuals), graph node clicks (`nodeClicked`), and DL Query result selections.
- **FR-006**: The `GRAPH_NODE_SELECT` dispatch MUST be suppressed when the selection is programmatically triggered by `ontograph.focusEntity` (loop prevention). Implementation: a boolean flag (`suppressNextSelection`) is set to `true` before calling `revealInTreeView`, and `onEntitySelected` checks and clears the flag before dispatching.
- **FR-007**: The extension MUST add `"extensionDependencies": ["ysgao.ontograph-lite"]` to `extension/package.json` so VS Code installs OntoGraph-lite as a prerequisite.
- **FR-008**: `authoringPanel.ts` MUST expose a `static postMessage(msg: IpcMessage): void` method so `ontographEditor.ipcRoute` can forward inbound `GRAPH_NODE_SELECT` messages to the authoring webview.
- **FR-009**: All IPC calls toward OntoGraph-lite MUST use silent error swallowing (`.then(undefined, () => {})`) so OntoGraph Editor operates gracefully when OntoGraph-lite is absent.

### Key Entities *(include if feature involves data)*

- **IPC Router** (`extension.ts`): Stateless VS Code command (`ontographEditor.ipcRoute`) that routes `CONCEPT_FOCUS` to `ontograph.focusEntity` and `GRAPH_NODE_SELECT` to `AuthoringPanel.postMessage`.
- **CONCEPT_FOCUS message**: `{ command: "CONCEPT_FOCUS", payload: { id: string, label: string } }` — emitted by authoring webview, consumed by IPC router → `ontograph.focusEntity`.
- **GRAPH_NODE_SELECT message**: `{ command: "GRAPH_NODE_SELECT", payload: { id: string } }` — emitted by any OntoGraph-lite view selection, consumed by IPC router → authoring webview.
- **`ontograph.focusEntity` command**: VS Code command in OntoGraph-lite that accepts `{ iri: string }` and updates graph panel + all tree views. Must include loop-prevention guard.
- **`onEntitySelected(item)` function**: Central selection callback in OntoGraph-lite that fires from all 6 tree views. IPC dispatch hook point.
- **SNOMED IRI translation**: SCTID ↔ IRI via `http://snomed.info/id/<sctid>`. Used when converting CONCEPT_FOCUS payloads to `ontograph.focusEntity` args and when extracting SCTID from IRI for GRAPH_NODE_SELECT payloads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can open OntoGraph-lite's graph panel via "OntoGraph: Open Visualization Display" command with zero configuration after both extensions are installed.
- **SC-002**: A concept selected in the authoring UI shows the Entity Editor and reveals the entity in the relevant tree view within 500ms. If the graph panel is open, it also highlights the concept node within 500ms.
- **SC-003**: An entity selected in any OntoGraph-lite view (tree view, graph, DL Query) loads the corresponding concept in the authoring panel within 500ms.
- **SC-004**: Programmatic entity focus from CONCEPT_FOCUS does NOT trigger a GRAPH_NODE_SELECT echo — verified by monitoring IPC router call count.
- **SC-005**: Both panels operate independently without errors when the other is not open.
- **SC-006**: When OntoGraph-lite is not installed, OntoGraph Editor activates without errors and `ontographEditor.openGraph` surfaces a friendly "OntoGraph-lite not installed" message.

## Assumptions

- OntoGraph-lite is a companion VS Code extension (`ysgao.ontograph-lite`) that the user installs alongside OntoGraph Editor. It manages its own webview panels and tree views.
- The `ontograph.focusEntity` command exists in OntoGraph-lite (confirmed in codebase) and accepts `{ iri?: string }`. It currently reveals in tree views but does NOT open the graph panel — opening the graph panel will be added as part of this feature.
- The `onEntitySelected(item)` function in OntoGraph-lite's `extension.ts` is the single hook point for all tree view selections (lines 95–100).
- SNOMED CT concepts use IRI format `http://snomed.info/id/<sctid>`. The IPC bridge translates between SCTID (AuthoringUI) and IRI (OntoGraph-lite).
- OntoGraph-lite's graph panel only shows data for entities present in the loaded OWL ontology. If a SNOMED concept is not in the loaded OWL file, `ontograph.focusEntity` will show a "not found" warning — this is acceptable v1 behavior.
- JRE 21+ runtime check remains out of scope for this feature.
- Mobile/browser deployment is out of scope — VS Code desktop only.
