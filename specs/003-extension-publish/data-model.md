# Data Model: Extension Packaging and Marketplace Publication

**Feature**: 003-extension-publish | **Date**: 2026-06-03

---

## Entity 1: JreDetectionResult

Returned by the JRE detection service at extension activation. Immutable value object.

| Field | Type | Description |
|-------|------|-------------|
| `found` | `boolean` | Whether a `java` executable was located on PATH |
| `major` | `number \| undefined` | Parsed major version (e.g., `21` for Java 21.0.1) |
| `raw` | `string \| undefined` | Raw version string from stderr output for diagnostic logging |
| `compatible` | `boolean` | Derived: `found && major >= 21` |
| `error` | `string \| undefined` | Capture of process error if spawn fails (e.g., command not found) |

**State transitions**:
- `found: false` → notification: "Java not found — install JRE 21+"
- `found: true, compatible: false` → notification: "Java {major} found — upgrade to JRE 21+"
- `found: true, compatible: true` → no notification, proceed silently

---

## Entity 2: VsixManifest (extension/package.json fields)

Subset of `package.json` fields that must be populated for marketplace publication.

| Field | Required for VSIX | Current State | Target State |
|-------|------------------|---------------|--------------|
| `name` | Yes | `ontograph-editor-extension` | unchanged |
| `displayName` | Yes | `OntoGraph Editor` | unchanged |
| `description` | Yes | *(empty)* | Populated with one-line description |
| `version` | Yes | `0.0.1` | `1.0.0` for first public release |
| `publisher` | Yes | `ontograph` | unchanged |
| `categories` | Recommended | `["Other"]` | `["Education", "Other"]` |
| `icon` | Recommended | *(absent)* | `assets/icon.png` (128×128 PNG) |
| `repository` | Recommended | *(absent)* | GitHub URL of this repo |
| `extensionDependencies` | Yes | `["ysgao.ontograph-lite"]` | unchanged (already correct) |
| `engines.vscode` | Yes | `^1.80.0` | unchanged |

---

## Entity 3: VsixPackage (build artifact)

The `.vsix` file produced by `@vscode/vsce`.

| Attribute | Value |
|-----------|-------|
| Filename | `ontograph-editor-extension-{version}.vsix` |
| Contents | esbuild bundle, Angular assets, package.json, icon, README |
| Size constraint | ≤ 50 MB (per SC-005) |
| Excluded | Source TypeScript, specs/, submodule source trees, source maps, test files |

---

## Entity 4: ReleaseWorkflow (CI pipeline state)

| Stage | Trigger | Output |
|-------|---------|--------|
| Build | `push: tags: v*.*.*` | Angular dist + extension dist |
| Package | After build passes | `.vsix` artifact |
| Test | After build | Extension tests pass/fail |
| Publish | After package + test | Marketplace listing updated |
| Artifact | After package | VSIX downloadable from CI run |

---

## Relationships

```
VsixManifest ──defines metadata for──▶ VsixPackage
JreDetectionResult ──consumed by──▶ extension.ts activate()
VsixPackage ──produced by──▶ ReleaseWorkflow
ReleaseWorkflow ──triggers on──▶ version tag push
```
