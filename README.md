# OntoGraph Editor

A unified ontology and terminology engineering environment for Visual Studio Code. Pairs a live OWL ontology graph workspace with an enterprise-grade SNOMED CT authoring workbench — both running as native VS Code tabs, synchronized in real time.

---

## Features

- **OWL Ontology Browser** — load `.ofn`, `.omn`, or `.owl` files and explore classes, object properties, data properties, annotation properties, and individuals in the VS Code sidebar
- **Graph Visualization** — interactive node/edge graph powered by [OntoGraph-lite](https://github.com/ysgao/OntoGraph-lite); navigate entity neighbourhoods, zoom, and pan inside a dedicated webview tab
- **OWL Reasoning** — classify ontologies and check consistency using ELK (default) or HermiT; inferred hierarchy displayed in a dedicated sidebar view
- **Entity Editor** — add classes, object properties, data properties, annotation properties, and individuals; edit axioms with Manchester Syntax autocompletion
- **SPARQL & DL Query** — open the SPARQL editor or DL query panel from the command palette
- **SNOMED CT Authoring UI** — embedded fork of [IHTSDO/authoring-ui](https://github.com/IHTSDO/authoring-ui) for clinical terminology editing against a Snowstorm backend
- **Live IPC Bridge** — selecting a concept in the authoring panel auto-focuses the ontograph, and clicking an ontograph node loads the editing fields; all synchronization happens over the VS Code extension host (no direct cross-webview calls)
- **Navigation History** — back/forward commands mirror browser history within the ontology panel
- **Authoring CLI (`authoring-cli`)** — a command-line tool that lets an AI model create, edit, validate, and (when never versioned) delete SNOMED CT content against whatever task you have open in the Authoring Workbench, without needing the panel focused or even visible

---

## Requirements

| Dependency | Version |
|---|---|
| VS Code | 1.90+ |
| Node.js | 18+ |
| Java (JRE/JDK) | 21+ (for the OWL reasoner) |

---

## Installation

### From VS Code Marketplace

Search **OntoGraph Editor** in the Extensions panel, or install from the command palette:

```
ext install ontograph.ontograph-editor-extension
```

### From a `.vsix` file

```bash
code --install-extension ontograph-editor-extension-<version>.vsix
```

Or: **Extensions** panel → `⋯` menu → **Install from VSIX…**

---

## Getting Started

1. Open VS Code and trigger the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **OntoGraph: Load Ontology File…** to open an `.ofn`, `.omn`, or `.owl` file.
3. The sidebar populates with **Classes**, **Object Properties**, and other entity lists.
4. Click **OntoGraph: Classify Ontology** (▶ button in the sidebar header) to compute the inferred hierarchy.
5. Right-click any entity → **Open Graph** to open the graph visualization tab.
6. Run **OntoGraph: Open Editing Workbench** for the full SNOMED CT authoring UI (requires a configured Snowstorm backend).

---

## Configuration

All settings are under `ontographEditor.*` and `ontograph.*` in VS Code Settings:

| Setting | Default | Description |
|---|---|---|
| `ontographEditor.authoringServicesEndpoint` | `https://uat-snowstorm.ihtsdotools.org/authoring-services/` | Authoring Services backend URL |
| `ontographEditor.terminologyServerEndpoint` | `https://uat-snowstorm.ihtsdotools.org/snowstorm/snomed-ct/` | Snowstorm SNOMED CT endpoint |
| `ontographEditor.imsEndpoint` | `https://uat-snowstorm.ihtsdotools.org/` | IHTSDO Identity Management System endpoint |
| `ontograph.reasoner.engine` | `elk` | Reasoner: `elk`, `hermit`, or `auto` |
| `ontograph.reasoner.javaPath` | `java` | Path to Java executable (must be Java 11+) |
| `ontograph.reasoner.jvmArgs` | `["-Xmx4g"]` | Extra JVM arguments for the reasoner process |
| `ontograph.reasoner.timeoutSeconds` | `600` | Reasoning timeout in seconds |
| `ontograph.display.preferredLabelLanguage` | `en` | Language tag for `rdfs:label` display |
| `ontograph.display.showIriOnHover` | `false` | Show full IRI as tooltip on tree items |
| `ontograph.display.axiomEntityStyle` | `label` | Entity display style: `label`, `shortIri`, or `fullIri` |
| `ontograph.graph.defaultDepth` | `1` | Default neighbourhood depth for graph visualization (1–5) |
| `ontograph.largeOntologyThreshold` | `50000` | Class count above which large-ontology optimisations are applied |

---

## Architecture

The extension hosts two Angular/web frontends as sandboxed webview panels. Because webviews run in isolated V8 processes, all cross-panel communication is brokered by the extension host:

```
AuthoringPanel  ←→  extension host (IPC router)  ←→  GraphPanel
     ↕                                                      ↕
postMessage JSON                                    postMessage JSON
```

**Event types:**

| Event | Direction | Payload |
|---|---|---|
| `CONCEPT_FOCUS` | Authoring → Graph | `{ id, label }` |
| `GRAPH_NODE_SELECT` | Graph → Authoring | `{ id }` |

**Submodule layout:**

```
extension/          VS Code extension bundle (TypeScript + esbuild)
apps/
├── OntoGraph-lite/         fork of ysgao/OntoGraph-lite
└── authoring-ui-vscode/    fork of IHTSDO/authoring-ui
```

---

## Building from Source

```bash
# 1. Clone with submodules
git clone --recurse-submodules https://github.com/ysgao/OntoGraphEditor.git
cd OntoGraphEditor

# 2. Install all dependencies
npm run setup

# 3. Development build (Angular + extension bundle)
npm run build-all

# 4. Package as .vsix
npm run package:vsix
# Output: extension/dist/ontograph-editor-extension-<version>.vsix
```

**Debug in VS Code:** open the repo root → Run & Debug panel → **Launch Extension** (F5). A second `[Extension Development Host]` window opens; run **OntoGraph: Open Editing Workbench** to verify the webview loads.

---

## Commands

| Command | Description |
|---|---|
| `OntoGraph: Load Ontology File…` | Open an OWL file into the extension |
| `OntoGraph: Classify Ontology` | Run OWL classification, populate inferred hierarchy |
| `OntoGraph: Check Consistency` | Run consistency check on the loaded ontology |
| `OntoGraph: Open Editing Workbench` | Open the SNOMED CT authoring UI panel |
| `OntoGraph: Open Visualization Display` | Open the graph visualization panel |
| `OntoGraph: Search Entity` | Search entities in the sidebar |
| `OntoGraph: Open SPARQL Editor` | Open the SPARQL query editor |
| `OntoGraph: Open DL Query` | Open the Description Logic query panel |
| `OntoGraph: Add Class…` | Add a new OWL class |
| `OntoGraph: Add Object Property…` | Add a new object property |
| `OntoGraph: Export Ontology As…` | Export the ontology to a file |
| `OntoGraph: Sign In to IMS` | Authenticate via username/password |
| `OntoGraph: Set IMS Session Cookie` | Paste a session cookie from the browser |

---

## Authoring CLI (`authoring-cli`)

A separate, standalone command-line tool (bundled with the extension, in `cli/`) for AI-driven authoring. It reuses whatever IMS session and task you already have open in the Authoring Workbench, so there's nothing extra to authenticate.

**No setup needed** — installing the extension is enough. The extension bundles a compiled copy of the CLI and automatically runs `npm link` for it the first time it activates, so `authoring-cli` just works as soon as VS Code has loaded the extension once.

```bash
# With the extension running and a task open in the Authoring Workbench:
authoring-cli create-concept \
  --fsn "Test finding" --tag finding --pt "Test finding" --parent 404684003

# Or target a specific project/task explicitly:
authoring-cli create-concept \
  --fsn "Test finding" --tag finding --parent 404684003 \
  --project MYPROJECT --task MYPROJECT-123

# Confirm the CLI is pointed at the same task you have open in the UI:
authoring-cli current-task

# Check a concept's current validation state (convention warnings/errors) without saving anything:
authoring-cli validate-concept --id 404684003

# Full command list, always current:
authoring-cli
```

Beyond concept creation, the CLI covers the concept's full edit surface — descriptions (add/update/delete, case significance, dialect acceptability), relationships and axioms (add/replace/delete, including GCI axioms), definition status, inactivation, and unpublished-content deletion (`delete-concept`/`delete-description`/`delete-axiom`/`delete-gci-axiom`, permitted only when the target has never been versioned — mirroring the interactive editor's own delete behavior). Every save requests the same validation Snowstorm runs for a manual save in the UI: results print in the CLI output, and if the Authoring Workbench panel is open on that same concept, the same warnings/errors appear there too, live.

Requires the extension to be running and signed in to IMS (`OntoGraph: Set IMS Session Cookie` or `OntoGraph: Import IMS Cookies from Chrome`) — it does not work standalone. If the automatic setup fails (check the "OntoGraph CLI Setup" output channel), run **OntoGraph: Set Up authoring-cli Command** from the Command Palette to retry, or do it manually: `cd <extension install dir>/dist/cli && npm link`.

---

## License

[Apache 2.0](LICENSE)
