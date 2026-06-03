# Feature Specification: Upstream Submodule Sync Workflow

**Feature Branch**: `004-upstream-sync`

**Created**: 2026-06-03

**Status**: Draft

**Input**: Next feature derived from OntoGraphEditorSpec.md — establishes a repeatable, safe workflow for maintainers to pull upstream open-source changes into both submodules (authoring-ui-vscode and OntoGraph-lite) without losing VS Code customizations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync Authoring UI Fork with IHTSDO Upstream (Priority: P1)

A maintainer wants to incorporate new clinical terminology features released by IHTSDO into the OntoGraph Editor. They run the upstream sync for `apps/authoring-ui-vscode`, which merges IHTSDO changes while preserving all VS Code-specific customizations (VsCodeService, HashLocationStrategy, Angular adapter modules).

**Why this priority**: The authoring-ui submodule is a fork with deliberate customizations. Without a safe, documented sync procedure, upstream merges risk overwriting `VsCodeService` or breaking Angular routing — silently breaking the extension for all users.

**Independent Test**: Add a dummy commit to a test branch simulating an IHTSDO upstream release, run the sync procedure, and verify: (1) the merge succeeds, (2) `src/app/core/services/vscode.service.ts` and routing config remain intact, (3) `npm run build:client` passes.

**Acceptance Scenarios**:

1. **Given** a maintainer on branch `004-upstream-sync`, **When** they execute the authoring-ui sync steps, **Then** all commits from `upstream/master` (IHTSDO) are merged into `apps/authoring-ui-vscode` without removing `vscode.service.ts` or `HashLocationStrategy` configuration.
2. **Given** an upstream merge produces conflicts only in non-custom files, **When** the maintainer resolves them, **Then** the merged result builds successfully (`npm run build:client` exits 0).
3. **Given** an upstream merge produces conflicts in VS Code customization files (`vscode.service.ts`, routing config), **When** the maintainer is warned, **Then** the procedure clearly identifies which custom files need manual review before completion.

---

### User Story 2 - Sync OntoGraph-lite with Upstream Origin (Priority: P1)

A maintainer pulls the latest graph visualization improvements from the OntoGraph-lite upstream and verifies the extension still loads correctly.

**Why this priority**: OntoGraph-lite is not customized — syncing is lower risk but still needs a verified build step to ensure the updated submodule integrates without breaking the extension host.

**Independent Test**: Run the OntoGraph-lite sync steps pointing to a test tag, then verify `npm run build-all` succeeds and the extension launches without errors in the VS Code Extension Development Host.

**Acceptance Scenarios**:

1. **Given** new commits exist on `origin/master` for `apps/OntoGraph-lite`, **When** the maintainer runs the sync procedure, **Then** the submodule HEAD advances to the latest upstream commit.
2. **Given** the updated OntoGraph-lite submodule, **When** the full build runs, **Then** it completes without errors.
3. **Given** the updated extension, **When** it is launched in VS Code Extension Development Host, **Then** "OntoGraph: Open Visualization Display" opens OntoGraph-lite's panel without errors.

---

### User Story 3 - Verify Build Integrity After Any Upstream Sync (Priority: P2)

After any upstream sync (either submodule), a maintainer runs a single verification command to confirm the unified build passes and the extension is ready for a new release.

**Why this priority**: Unified build verification prevents shipping a broken extension after an upstream merge. It acts as the final safety gate before tagging a release.

**Independent Test**: Run `npm run build-all` after a simulated upstream merge and confirm exit code 0 with no TypeScript or Angular compilation errors.

**Acceptance Scenarios**:

1. **Given** both submodules are synced, **When** the maintainer runs the unified build command, **Then** it produces a valid extension bundle with exit code 0.
2. **Given** a build failure after upstream sync, **When** the maintainer reviews the output, **Then** the error message identifies which submodule introduced the breaking change.

---

### Edge Cases

- What happens when IHTSDO upstream adds a new Angular dependency that conflicts with the VS Code fork's locked versions?
- How does the procedure handle a maintainer who has uncommitted local changes in a submodule when starting a sync?
- What if the upstream remote has been force-pushed, making a fast-forward merge impossible?
- How does the procedure behave if internet access is unavailable at sync time?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Maintainers MUST be able to fetch and merge all commits from `IHTSDO/authoring-ui` into `apps/authoring-ui-vscode` using documented steps without internet access to IHTSDO's services beyond standard `git fetch`.
- **FR-002**: The sync procedure MUST preserve all files under VS Code customization scope (`vscode.service.ts`, `HashLocationStrategy` routing config, Angular adapter modules) — these files MUST NOT be removed or overwritten during an upstream merge.
- **FR-003**: Maintainers MUST be able to fetch and merge all commits from the OntoGraph-lite origin into `apps/OntoGraph-lite` using documented steps.
- **FR-004**: The unified build command MUST be runnable as a single step after any upstream sync to verify integration health.
- **FR-005**: The procedure MUST provide clear guidance on identifying and resolving merge conflicts in customization files.
- **FR-006**: The upstream remote for `apps/authoring-ui-vscode` MUST be configured to point to the official IHTSDO repository so any maintainer can replicate the sync without additional setup beyond cloning the repo.
- **FR-007**: All sync steps MUST be documented in a runbook that a new maintainer (unfamiliar with the codebase) can follow end-to-end without assistance.

### Key Entities

- **Upstream Remote**: The official IHTSDO/authoring-ui repository registered as a git remote named `upstream` inside `apps/authoring-ui-vscode`. Key attribute: URL, tracked branch (`master`).
- **VS Code Customization Scope**: The set of files in `apps/authoring-ui-vscode` that were added or modified specifically for VS Code integration. These must survive every upstream merge.
- **Sync Runbook**: The documented step-by-step procedure (scripts and/or instructions) for performing a safe upstream merge for each submodule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer unfamiliar with the submodule sync process can complete a full sync (both submodules + build verification) in under 30 minutes using only the documented runbook.
- **SC-002**: 100% of VS Code customization files survive upstream merges without requiring manual re-application of changes.
- **SC-003**: The build passes after every upstream sync that introduces no API-breaking changes in the upstream libraries.
- **SC-004**: A new maintainer can configure the upstream remote and perform their first sync without external assistance, verified by following only the runbook.
- **SC-005**: Merge conflicts, when they occur, are surfaced with file-level specificity so the maintainer can resolve them in under 15 minutes per conflict.

## Assumptions

- Maintainers have git installed and are comfortable with standard git merge workflows.
- The upstream IHTSDO repository remains publicly accessible at `https://github.com/IHTSDO/authoring-ui`.
- The OntoGraph-lite repository origin remote is already configured in the submodule.
- VS Code customization files are stable and their paths do not change between upstream releases.
- Monthly sync frequency is the target cadence; the procedure does not need to be fully automated in this feature iteration.
- Automated CI sync scheduling and pull request creation are out of scope for this feature — the focus is the human-executable runbook and remote configuration.
