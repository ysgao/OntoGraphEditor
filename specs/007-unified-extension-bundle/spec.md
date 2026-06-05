# Feature Specification: Unified VSIX Extension Bundle

**Feature Branch**: `007-unified-extension-bundle`

**Created**: Friday, June 5, 2026

**Status**: Draft

**Input**: User description: "build a single VSIX extension that include both ontograph-lite and authoring-ui-vscode in separate git submodules and all their webview UIs and dependencies. The entension host for node.js environment are shared and do not need to duplicate."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unified Tooling Installation (Priority: P1)

As a knowledge engineer, I want to install a single VS Code extension so that I have immediate access to both the OntoGraph-lite visualization and the Authoring UI without managing separate extensions.

**Why this priority**: This is the core value proposition—reducing the overhead of managing multiple related tools.

**Independent Test**: Can be tested by installing the generated VSIX file in a clean VS Code instance and verifying that both "OntoGraph-lite" and "Authoring UI" features (e.g., commands, sidebars, or editors) are present and functional.

**Acceptance Scenarios**:

1. **Given** a clean VS Code installation, **When** I install the unified `ontograph-editor` VSIX, **Then** both OntoGraph-lite and Authoring UI features appear in the extension list and activity bar.
2. **Given** the extension is installed, **When** I trigger an OntoGraph-lite command and an Authoring UI command, **Then** both respective webviews open and function correctly.

---

### User Story 2 - Shared Resource Efficiency (Priority: P2)

As a VS Code user, I want the extension to be lightweight and efficient so that it doesn't consume unnecessary memory or disk space by duplicating the Node.js extension host environment.

**Why this priority**: Performance and resource management are critical for a smooth IDE experience.

**Independent Test**: Can be tested by inspecting the VSIX package contents to ensure there is only one set of extension host entry points and that node_modules are not duplicated for shared core logic.

**Acceptance Scenarios**:

1. **Given** a built VSIX, **When** I inspect the `dist` folder, **Then** I find a single bundled entry point for the extension host that initializes both sub-applications.
2. **Given** the extension is running, **When** I check the VS Code extension host process, **Then** I see only one process managing both OntoGraph and Authoring UI components.

---

### User Story 3 - Streamlined Developer Workflow (Priority: P3)

As a contributor to the OntoGraph project, I want both sub-tools to be managed as git submodules so that I can pull updates from their respective repositories independently while maintaining a unified build process.

**Why this priority**: Facilitates easier maintenance and upstream synchronization.

**Independent Test**: Can be tested by running a single build command that fetches/updates submodules and packages them into the VSIX.

**Acceptance Scenarios**:

1. **Given** a fresh clone of the main repository, **When** I run the submodule update and build script, **Then** both `ontograph-lite` and `authoring-ui-vscode` are correctly populated and built.

### Edge Cases

- **Missing Submodule**: If a developer fails to run `git submodule update --init`, the build script should provide a clear error message rather than producing a broken VSIX.
- **Naming Conflicts**: If both applications define a command or view with the same ID, the build process should detect this conflict and fail early.
- **Version Mismatch**: If the submodules require incompatible versions of shared dependencies, the build system must manage these conflicts or warn the user.
- **Webview Isolation**: Ensuring that webview assets (like global CSS) from one app do not leak into the other.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support managing `ontograph-lite` as a git submodule within the main repository.
- **FR-002**: The system MUST support managing `authoring-ui-vscode` as a git submodule within the main repository.
- **FR-003**: The build process MUST produce a single `.vsix` file containing all necessary assets for both applications.
- **FR-004**: The extension MUST share a single Node.js extension host entry point (`extension.ts` or similar) to initialize both applications.
- **FR-005**: All webview resources (HTML, CSS, JS, images) from both applications MUST be bundled and accessible within the unified extension.
- **FR-006**: The system MUST resolve and bundle all dependencies for both applications without duplication in the final VSIX package where possible.
- **FR-007**: The extension manifest (`package.json`) MUST include all contributions (commands, views, menus) from both applications.

### Key Entities

- **Unified Extension Bundle**: The final VSIX package containing both tools.
- **Shared Extension Host**: The single Node.js process that handles IPC and VS Code API interactions for both tools.
- **Git Submodules**: The source code references for `ontograph-lite` and `authoring-ui-vscode`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single `.vsix` file is generated that successfully installs in VS Code.
- **SC-002**: Both OntoGraph-lite and Authoring UI are fully functional within the same VS Code instance using the single extension.
- **SC-003**: The VSIX package does not contain multiple copies of the Node.js extension host logic.
- **SC-004**: The build time for the unified extension is within 20% of the sum of individual build times.

## Assumptions

- Both `ontograph-lite` and `authoring-ui-vscode` are architecturally compatible with a shared extension host model.
- There are no conflicting command IDs or view IDs between the two applications.
- The user has git and npm/yarn installed for the build process.
- VS Code version compatibility is consistent across both sub-tools.
