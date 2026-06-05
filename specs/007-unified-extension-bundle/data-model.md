# Data Model: Unified VSIX Bundle

This document describes the structure of the unified VSIX bundle and the build artifacts.

## Build Artifacts (extension/dist/)

- **extension.js**: The single entry point for the VS Code extension host. Bundles logic for both Authoring UI and OntoGraph-lite.
- **parserWorker.js**: Shared parser worker for large OWL files (from OntoGraph-lite).
- **server.js**: Language Server for OWL/Manchester syntax (from OntoGraph-lite).
- **graph-webview.js**: Bundled frontend logic for the graph visualization.
- **entity-editor-webview.js**: Bundled frontend logic for the OWL entity editor.
- **sparql-editor-webview.js**: Bundled frontend logic for the SPARQL editor.
- **dl-query-webview.js**: Bundled frontend logic for the DL query panel.
- **authoring/**: Subdirectory containing the built AngularJS app (Authoring UI).
    - `index.html`
    - `scripts/`
    - `styles/`
    - `images/`

## Manifest Structure (extension/package.json)

The manifest will contain a merged set of:
- **Activation Events**: `onStartupFinished`, `onCommand:*`, `onView:*`.
- **Contributes**:
    - `commands`: Both `ontograph.*` and `ontographEditor.*`.
    - `viewsContainers`: Activity bar item for `ontograph`.
    - `views`: Tree views for classes, properties, etc.
    - `languages`: Manchester, OWL Functional, OWL/XML.
    - `configuration`: Settings for both reasoner and authoring services.
