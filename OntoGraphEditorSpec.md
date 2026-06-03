This document establishes the official product specification and architectural blueprint for the **OntoGraph Editor** VS Code extension.

---

## 1. Executive Product Overview

The **OntoGraph Editor** is a unified ontology and terminology engineering environment built natively for Visual Studio Code. It integrates two powerful open-source frontends into a single extension package:

1. **OntoGraph-lite:** A visual graphing node/edge layout workspace used for querying and browsing ontologies.
2. **AuthoringUI (VS Code Fork):** The enterprise-grade SNOMED CT clinical terminology application adapted for local IDE executions.

Instead of running as isolated extensions, this application binds both components using an **Extension Controller Pattern**. Users navigate the workbench through highly intuitive, independent **native VS Code tabs**, allowing full flexibility in window splitting, dragging, or docking while ensuring asynchronous, real-time data synchronization between visual graphs and structured data fields.

---

## 2. Repository Layout & Architecture

The project is structured as a monolithic orchestration workspace hosting two decoupled submodules. This lets developers maintain custom, IDE-specific adaptations without breaking tracking lines to official open-source code repositories.

### 2.1 Repository Map

```text
ontograph-editor-root/           # Master Orchestration Repository
├── .vscode/
│   └── launch.json              # Shared Debug Configurations
├── extension/                   # Main VS Code Extension Bundle (TypeScript)
│   ├── src/
│   │   ├── extension.ts         # Extension Activation Lifecycle & Commands
│   │   ├── authoringPanel.ts    # Independent Tab Controller for AuthoringUI
│   │   └── graphPanel.ts        # Independent Tab Controller for OntoGraph-lite
│   ├── package.json             # Combined Manifest & Contributions
│   └── tsconfig.json
└── apps/
    ├── OntoGraph-lite/          # Submodule: Direct Track of original graph repo
    └── authoring-ui-vscode/     # Submodule: FORK of IHTSDO/authoring-ui (VS Code ready)

```

---

## 3. Data Flow & Communication Specification (IPC Bridge)

Because both tools execute in completely separate, sandboxed V8 runtime processes under the Webview API, they cannot communicate directly through standard web APIs. The **VS Code Extension Host** handles all background routing.

```
+-------------------------------------------------------------------------+
|                        VS CODE EXTENSION HOST                           |
|                                                                         |
|            [AuthoringPanel State] <=======> [GraphPanel State]          |
+-----------------------------------+-------------------------------------+
                                    |
          Asynchronous Messages     |     Asynchronous Messages
          (postMessage JSON)        |     (postMessage JSON)
                                    v
+-----------------------------------+-------------------------------------+
|                      NATIVE INTEGRATED TABS                             |
|                                                                         |
|  +-----------------------------+     +-------------------------------+  |
|  |       TAB A: EDITING        |     |        TAB B: DISPLAY         |  |
|  |   (authoring-ui-vscode)     |     |       (OntoGraph-lite)        |  |
|  +-----------------------------+     +-------------------------------+  |
+-------------------------------------------------------------------------+

```

### 3.1 Event Transaction Interfaces

To ensure tight type-safety across components, the extension forces specific message models:

* **`CONCEPT_FOCUS` (Editing $\rightarrow$ Display):** Triggered when an active concept node or dictionary row is highlighted in the Authoring UI.
```json
{ "command": "CONCEPT_FOCUS", "payload": { "id": "404684003", "label": "Clinical finding" } }

```


* **`GRAPH_NODE_SELECT` (Display $\rightarrow$ Editing):** Triggered when a visual graph element is selected by the user to load editing fields.
```json
{ "command": "GRAPH_NODE_SELECT", "payload": { "id": "404684003" } }

```



---

## 4. Implementation Step Plan

### Phase 1: Upstream Forking & Asset Adapting

* **Task 1.1:** Create a public fork of `IHTSDO/authoring-ui`.
* **Task 1.2:** Inject the custom `VsCodeService` provider into the Angular core folder structures (`/src/app/core/services/`).
* **Task 1.3:** Modify routing dependencies to enable `HashLocationStrategy` to decouple structural navigation states from standard browser URL bar indicators.

### Phase 2: Core Manifest Compilation

* **Task 2.1:** Configure unified scripts inside root `package.json` to safely build both frontends into isolated output distribution paths.
* **Task 2.2:** Update `extension/package.json` to register the necessary suite workspace triggers:
```json
"contributes": {
  "commands": [
    { "command": "ontographEditor.openAuthoring", "title": "OntoGraph: Open Editing Workbench" },
    { "command": "ontographEditor.openGraph", "title": "OntoGraph: Open Visualization Display" }
  ]
}

```



### Phase 3: Tab Controller Engineering

* **Task 3.1:** Implement `AuthoringPanel.ts` and `GraphPanel.ts` classes utilizing `vscode.window.createWebviewPanel`.
* **Task 3.2:** Configure `retainContextWhenHidden: true` on both panel declarations to guarantee state preservation when a developer switches tabs.
* **Task 3.3:** Construct the HTML mapping engine using `webview.asWebviewUri` regex utilities to safely parse relative scripts (`runtime.js`, `main.js`, styles) across both application distributions.

### Phase 4: State Brokerage Wiring

* **Task 4.1:** Establish event routing pipes inside `extension.ts` to capture signals incoming from one controller instance and directly re-serialize them down to the alternative target pane.

---

## 5. Maintenance Plan: Syncing Upstream Repositories

To ensure the OntoGraph Editor stays performant and receives the latest capabilities from the upstream open-source communities, updates will be pulled monthly using a non-destructive dual-remote merging system.

```bash
# 1. Syncing OntoGraph-lite updates
cd apps/OntoGraph-lite
git fetch origin
git merge origin/master

# 2. Syncing the Angular Authoring UI updates without losing VS Code integrations
cd ../authoring-ui-vscode
git fetch upstream          # Points to official https://github.com/IHTSDO/authoring-ui
git merge upstream/master   # Pulls new clinical features; leaves custom local VsCodeService untouched

# 3. Compile and verify unified execution packages
cd ../../
npm run build-all

```