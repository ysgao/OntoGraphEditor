# Feature Specification: Angular Authoring UI Integration and Packaging

**Feature Branch**: `001-authoring-ui-integration`

**Created**: 2026-06-03

**Status**: Draft

**Input**: User description: "use the OntoGraphEditorSpec.md to create specifications, if it is needed to split it into mulitiple specifications."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Integrate Forked Angular UI into Project Structure (Priority: P1)

Integrate the clinical terminology authoring interface (a fork of `IHTSDO/authoring-ui`) into the extension workspace at `apps/authoring-ui-vscode` so it can be built and packaged as a local resource.

**Why this priority**: It is the core foundational dependency of the authoring UI tab. Without the repository structures and compiled Angular assets, the webview panel cannot render the editing workbench.

**Independent Test**: Build the Angular app in `apps/authoring-ui-vscode` and verify compiled assets (such as `main.js`, `polyfills.js`, and styling files) are created inside the output distribution directory.

**Acceptance Scenarios**:

1. **Given** the upstream Angular Authoring UI codebase is placed in `apps/authoring-ui-vscode`, **When** the build command is run, **Then** it compiles successfully without errors.
2. **Given** the compiled Angular build assets, **When** they are generated, **Then** they are output to a predictable relative directory accessible by the VS Code extension host.

---

### User Story 2 - VS Code Routing & Service Adaptation (Priority: P1)

Adapt the Angular app's router and network configuration to run locally inside a VS Code webview sandbox environment.

**Why this priority**: Sandboxed webviews do not support standard browser history routing (which manipulates the window URL path directly) or direct external HTTP requests without cross-origin issues.

**Independent Test**: Verify that the Angular router navigates using hash paths (e.g. `index.html#/concepts`) and mock messages are captured by `VsCodeService`.

**Acceptance Scenarios**:

1. **Given** the Angular application routing, **When** the app is initialized, **Then** it uses `HashLocationStrategy` to manage routes instead of standard HTML5 `PathLocationStrategy`.
2. **Given** the `VsCodeService` integration, **When** the application attempts to communicate with the extension host, **Then** it uses `window.parent.postMessage` / `acquireVsCodeApi().postMessage` to pass messages securely.

---

### User Story 3 - Unified Workspace Packaging and Script Compilation (Priority: P2)

Configure unified build and packaging scripts at the root level to simplify building the entire project (extension + submodules).

**Why this priority**: Essential for automated pipelines (CI/CD) and developer quality-of-life to ensure that code updates across sub-projects compile in one step.

**Independent Test**: Run the root build command and verify both the TypeScript extension code and Angular frontend assets compile successfully.

**Acceptance Scenarios**:

1. **Given** a new checkout of the project, **When** the root packaging command (`npm run build-all`) is run, **Then** it compiles the VS Code extension bundle, compiles the Angular Authoring UI, and outputs them to the extension package folder.

---

### Edge Cases

- **What happens when Angular router tries to navigate to a fallback route?** The application should route safely to the dashboard main page via hash routing (`#/`) without trying to reload from the host file system.
- **How does the system handle messaging if the VS Code API is not available (e.g., running in a standard web browser for testing)?** `VsCodeService` should fall back gracefully (e.g., log warning or use console outputs) to allow standalone local development/debugging of the Angular application.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository layout MUST define `apps/authoring-ui-vscode/` to house the custom clinical authoring Angular application.
- **FR-002**: The Angular application MUST configure `HashLocationStrategy` as the primary routing provider.
- **FR-003**: The Angular application MUST inject a custom `VsCodeService` (located at `/src/app/core/services/vscode.service.ts` or equivalent service module) to act as the communication bridge.
- **FR-004**: The root `package.json` MUST define a unified build script `build-all` to trigger compilation of the Angular application and the VS Code extension TS compiler.
- **FR-005**: Build scripts MUST cleanly copy or direct compiled Angular output files to distribution paths accessible by `webview.asWebviewUri` inside the extension.

### Key Entities *(include if feature involves data)*

- **VsCodeService**: The Angular service wrapper that manages `postMessage` requests and intercepts terminology calls, mapping them to the VS Code extension host messaging broker instead of backend API calls.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the root build script compiles both the extension backend and Angular frontend components in under 3 minutes.
- **SC-002**: The compiled Angular client application runs within a sandboxed webview context using relative/webview URIs without throwing resource loading errors.

## Assumptions

- The upstream `IHTSDO/authoring-ui` codebase does not depend on hardcoded root browser paths that cannot be overridden by `HashLocationStrategy`.
- The user's system has Node.js and npm installed to support Angular compilation scripts.
