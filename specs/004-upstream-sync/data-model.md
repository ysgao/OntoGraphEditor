# Data Model: Upstream Submodule Sync Workflow

**Feature**: 004-upstream-sync | **Date**: 2026-06-03

## VS Code Customization Scope

This is the canonical list of files in `apps/authoring-ui-vscode` that were added or modified specifically for VS Code integration. These files MUST survive every upstream merge from `IHTSDO/authoring-ui`.

| File Path (relative to apps/authoring-ui-vscode/) | Purpose | Risk if Overwritten |
|----------------------------------------------------|---------|---------------------|
| `src/app/core/services/vscode.service.ts` | Implements the VS Code ↔ Angular IPC bridge (`acquireVsCodeApi`, `postMessage`) | Extension host communication breaks entirely |
| `src/app/app.module.ts` | Imports `HashLocationStrategy` provider | Angular routing breaks in webview sandbox |
| `src/app/app-routing.module.ts` | Sets `useHash: true` on RouterModule | All Angular routes return 404 in webview |

**Glob pattern for pre-merge check**:
```
src/app/core/services/vscode*.ts
src/app/app.module.ts
src/app/app-routing.module.ts
```

## Upstream Remote Configuration

| Submodule | Remote Name | Remote URL | Tracked Branch |
|-----------|-------------|------------|----------------|
| `apps/authoring-ui-vscode` | `upstream` | `https://github.com/IHTSDO/authoring-ui` | `master` |
| `apps/OntoGraph-lite` | `origin` | `https://github.com/ysgao/OntoGraph-lite` | `main` |

## Sync State (per sync run)

Not persisted — purely operational. Represented here for documentation purposes.

| Field | Description |
|-------|-------------|
| `submodule` | Which submodule was synced (`authoring-ui-vscode` or `OntoGraph-lite`) |
| `upstream_sha_before` | Commit SHA at upstream before fetch |
| `upstream_sha_after` | Commit SHA at upstream after fetch |
| `conflicts` | List of conflicting files (empty if clean merge) |
| `customization_conflicts` | Subset of conflicts that overlap with VS Code customization scope |
| `build_result` | `pass` or `fail` with exit code |
