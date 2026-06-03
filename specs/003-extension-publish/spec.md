# Feature Specification: Extension Packaging and Marketplace Publication

**Feature Branch**: `003-extension-publish`

**Created**: 2026-06-03

**Status**: Draft

**Input**: Next feature derived from OntoGraphEditorSpec.md — packages the OntoGraph Editor extension as a distributable VSIX and publishes it to the VS Code Marketplace, including dependency declaration and runtime validation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install OntoGraph Editor from Marketplace (Priority: P1)

A clinical terminology engineer searches the VS Code Marketplace for "OntoGraph Editor", installs it with one click, and has the full environment (authoring panel + graph visualization) ready without any manual dependency steps.

**Why this priority**: Marketplace installation is the primary distribution path. Auto-installing the required OntoGraph-lite companion extension and declaring metadata correctly is the minimum requirement for public availability.

**Independent Test**: Publish a pre-release build to the marketplace, install it on a clean VS Code instance, and verify that: (1) OntoGraph-lite is installed automatically as a declared extension dependency, (2) invoking "OntoGraph: Open Editing Workbench" opens the authoring panel.

**Acceptance Scenarios**:

1. **Given** a clean VS Code installation, **When** the user installs "OntoGraph Editor" from the marketplace, **Then** VS Code automatically installs `ysgao.ontograph-lite` as a companion extension without any user prompt.
2. **Given** OntoGraph Editor is installed, **When** the user opens the Extensions view, **Then** the listing shows the correct publisher name, description, icon, and categories.
3. **Given** a previous version of OntoGraph Editor is installed, **When** a new version is published, **Then** VS Code notifies the user of the update and auto-updates without breaking existing workspace state.

---

### User Story 2 - Developer Produces a Distributable VSIX (Priority: P1)

A developer finishes a release cycle and needs to produce a signed, self-contained `.vsix` file for distribution (offline environments, enterprise customers, or pre-release testing) using a single command.

**Why this priority**: VSIX packaging is the prerequisite to both marketplace publication and any offline distribution channel. A reliable, reproducible packaging command is essential before any release workflow.

**Independent Test**: Run the packaging command from the repo root. Verify a `.vsix` file is produced, the file installs cleanly on a separate VS Code instance via "Install from VSIX", and all webview assets (Angular bundles for authoring UI, extension host bundle) are bundled inside.

**Acceptance Scenarios**:

1. **Given** a complete build of both Angular submodules and the extension bundle, **When** the developer runs the packaging command, **Then** a single `.vsix` file is produced containing all required assets.
2. **Given** the `.vsix` file, **When** installed manually via VS Code ("Install from VSIX…"), **Then** the extension activates and both "Open Editing Workbench" and "Open Visualization Display" commands are available.
3. **Given** the packaging command runs in CI, **When** it completes, **Then** the VSIX artifact is uploaded as a build artifact accessible for download.

---

### User Story 3 - Runtime Dependency Validation on Activation (Priority: P2)

When OntoGraph Editor activates, it checks that all required runtime dependencies are present — specifically a compatible JRE for OntoGraph-lite's reasoning backend — and provides actionable error guidance if any are missing.

**Why this priority**: Without JRE 21+, OntoGraph-lite's reasoning features silently fail. Surfacing this as a clear, actionable error at activation time prevents confusing downstream failures.

**Independent Test**: Activate the extension in an environment without a JRE. Verify VS Code shows an error notification identifying the missing JRE and linking to installation instructions. No silent failure.

**Acceptance Scenarios**:

1. **Given** the extension activates and no JRE 21+ is detected on the system path, **When** activation completes, **Then** VS Code shows an error notification: "OntoGraph Editor requires Java 21 or later. [Install Java]" with a link to the JRE download page.
2. **Given** the extension activates and JRE 21+ is present, **When** activation completes, **Then** no JRE warning is shown.
3. **Given** the extension activates and `ysgao.ontograph-lite` is not installed (e.g., user bypassed auto-install), **When** the "Open Visualization Display" command is invoked, **Then** VS Code shows an actionable message: "OntoGraph-lite extension is required. [Install Now]".

---

### User Story 4 - Automated Release Pipeline (Priority: P3)

When a version tag is pushed to the repository, a CI/CD pipeline automatically builds, packages, and publishes the extension to the VS Code Marketplace without manual intervention.

**Why this priority**: Automates the release process to reduce human error and enable frequent, consistent releases.

**Independent Test**: Push a version tag to the repository and verify the CI pipeline completes successfully: VSIX is produced, tests pass, and the extension is published to the marketplace.

**Acceptance Scenarios**:

1. **Given** a version tag is pushed (e.g., `v1.0.0`), **When** the CI pipeline runs, **Then** it builds both Angular submodules and the extension bundle, runs tests, and packages a VSIX.
2. **Given** all CI checks pass, **When** the pipeline completes, **Then** the new version is published to the VS Code Marketplace and appears on the extension listing page.
3. **Given** any CI step fails, **When** the pipeline errors, **Then** publication is blocked and the failure is reported with enough context to diagnose the issue.

---

### Edge Cases

- What happens if the packaging command runs before Angular submodule builds complete? The command must fail with a clear message indicating which asset is missing rather than producing a broken VSIX.
- How does the system handle a JRE that is installed but below version 21? The activation check must distinguish between "no JRE" and "incompatible JRE version" and report the actual version found.
- What happens if the marketplace token is expired or invalid during CI publication? The pipeline must fail the publish step with an actionable error rather than silently succeeding with a stale listing.
- How does auto-update behave when the user has unsaved work in the authoring panel? The extension should follow VS Code's standard reload-to-apply-update flow, deferring the update until the user explicitly reloads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The build system MUST produce a single `.vsix` file containing all extension host bundle files and all Angular frontend compiled assets via a single packaging command.
- **FR-002**: The extension manifest MUST declare `ysgao.ontograph-lite` under `extensionDependencies` so VS Code automatically installs it alongside OntoGraph Editor.
- **FR-003**: The extension manifest MUST include publisher ID, display name, description, version, categories, icon, and repository URL fields required for marketplace listing.
- **FR-004**: On activation, the extension MUST detect whether JRE 21 or later is present on the system and display an error notification with a download link if it is absent or incompatible.
- **FR-005**: The packaging command MUST verify that all required built assets exist before assembling the VSIX and exit with a non-zero status if any asset is missing.
- **FR-006**: The extension MUST provide a `.vscodeignore` configuration that excludes source maps, test files, development configuration, and submodule source code from the packaged VSIX.
- **FR-007**: A CI/CD pipeline configuration MUST be added that builds and packages the extension on version tag push and publishes it to the VS Code Marketplace.
- **FR-008**: When `ysgao.ontograph-lite` is not installed and the user invokes "Open Visualization Display", the extension MUST show a notification with an "Install Now" action that triggers marketplace installation of the missing extension.

### Key Entities

- **VSIX Package**: The self-contained distributable archive containing extension host bundle, Angular build assets for authoring UI, extension manifest, and all declared static resources.
- **Extension Manifest** (`extension/package.json`): Declares publisher, version, dependencies, activation events, contributes, and marketplace metadata.
- **JRE Detector**: Logic run at activation time that inspects the system for a compatible Java runtime and surfaces a diagnostic if not found.
- **Release Pipeline**: CI workflow triggered on version tag that builds, tests, packages, and publishes the extension.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can produce a distributable VSIX from a clean checkout in under 5 minutes using a single command.
- **SC-002**: Installing the VSIX on a clean VS Code instance results in a fully functional extension (both panels open, IPC bridge routes messages) with zero manual post-install configuration steps.
- **SC-003**: 100% of version tag pushes that pass CI tests result in a published marketplace release without manual intervention.
- **SC-004**: Users missing JRE 21+ receive an actionable error notification within 3 seconds of extension activation — no silent failure or undiagnosed error in the output log.
- **SC-005**: The packaged VSIX size does not exceed 50 MB (excluding the Angular submodule source code, which is excluded via `.vscodeignore`).

## Assumptions

- OntoGraph-lite (`ysgao.ontograph-lite`) is already published to the VS Code Marketplace and accessible for auto-install via `extensionDependencies`.
- The publisher account (`ysgao`) exists and a valid Personal Access Token for marketplace publication will be available as a CI secret.
- Both Angular submodule builds (authoring-ui-vscode) are complete and their output directories are populated before the VSIX packaging step runs.
- JRE detection is performed by invoking `java -version` on the system path; the extension does not bundle a JRE.
- The initial publication targets VS Code Marketplace only; Open VSX Registry is out of scope for this feature.
- Automated testing (unit and integration) infrastructure is assumed to be in place and passing before CI publication triggers.
