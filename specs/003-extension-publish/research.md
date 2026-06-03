# Research: Extension Packaging and Marketplace Publication

**Feature**: 003-extension-publish | **Date**: 2026-06-03

---

## Decision 1: VSIX Packaging Tool

**Decision**: Use `@vscode/vsce` (the official VS Code Extension Manager CLI)

**Rationale**: `@vscode/vsce` is the only supported tool for producing marketplace-compatible VSIX files. It reads `extension/package.json`, applies `.vscodeignore` filtering, and bundles all declared assets into a self-contained `.vsix` archive. The `vscode:prepublish` script hook in package.json triggers automatically before packaging, ensuring the esbuild minified bundle is produced first.

**Alternatives considered**:
- Custom zip script: Fragile, does not apply `.vscodeignore` semantics correctly and produces non-marketplace-compatible archives.
- `ovsx` (Open VSX): Secondary registry tool; can be added later for Open VSX publication but is out of scope per spec assumption.

**Resolved**: No NEEDS CLARIFICATION. Standard toolchain is clear.

---

## Decision 2: JRE Detection Strategy

**Decision**: Use `child_process.spawnSync('java', ['-version'], { encoding: 'utf8' })` at extension activation. Parse version from stderr (Java writes version info to stderr by convention). Extract major version via regex.

**Rationale**: The JRE is an external system dependency, not managed by the extension. Detecting via `java -version` on PATH mirrors the approach used by other VS Code extensions that depend on JVM tooling (e.g., Language Support for Java, Kotlin). Activation-time detection is required per FR-004 so users receive the error before attempting to use reasoning features.

**Version parsing**: `java -version` outputs to stderr in the format:
- `java version "1.8.0_292"` (Java 8)
- `openjdk version "21.0.1" 2023-10-17` (Java 21+)

Major version extraction regex: `/version "(\d+)/` capturing group 1. Values `<21` trigger the error notification.

**Alternatives considered**:
- Checking `JAVA_HOME` env variable: Unreliable — not always set even when `java` is on PATH.
- Bundling JRE: Increases VSIX size dramatically (100+ MB). Out of scope.
- Deferring check to first reasoning operation: User sees confusing downstream error rather than actionable upfront message. Rejected.

**Resolved**: No NEEDS CLARIFICATION.

---

## Decision 3: Publisher ID

**Decision**: Keep `publisher: "ontograph"` as defined in `extension/package.json`. This is the publisher account identifier registered on the VS Code Marketplace.

**Rationale**: The manifest already declares `"publisher": "ontograph"`. Changing this at planning time would require verifying Marketplace account ownership, which is an operational concern outside the code change scope. The spec notes the extension ID as `ysgao.ontograph-lite` for the companion — the OntoGraph Editor publisher is `ontograph`, giving an extension ID of `ontograph.ontograph-editor-extension`.

**Note**: Publisher ID and `extensionDependencies` are already correct in the manifest (`ysgao.ontograph-lite` declared). No change needed for dependency declaration (FR-002 already met).

---

## Decision 4: CI/CD Platform and Publish Mechanism

**Decision**: GitHub Actions workflow triggered on version tags (`v*.*.*`). Use `HaaLeo/publish-vscode-extension@v1` action for marketplace publication. PAT stored as `VSCE_PAT` repository secret.

**Rationale**: The repository is on GitHub (inferred from git remote conventions). GitHub Actions is the natural CI choice. `HaaLeo/publish-vscode-extension` is the de facto community action for marketplace publication and handles both VSIX packaging and marketplace upload in one step.

**Workflow stages**:
1. Checkout (with submodules)
2. Node.js 18 setup
3. `npm run build:client` (Angular authoring UI)
4. `npm run build:extension` (esbuild minified bundle)
5. VSIX package + publish via `HaaLeo/publish-vscode-extension@v1`

**Alternatives considered**:
- Direct `vsce publish` in shell step: Works but `HaaLeo` action provides better error reporting and VSIX artifact upload built in.
- Manual publish (no CI): Not acceptable per FR-007.

**Resolved**: No NEEDS CLARIFICATION.

---

## Decision 5: `.vscodeignore` Scope

**Decision**: Exclude from VSIX:
- `apps/` submodule source trees (Angular source, node_modules, test files) — only the compiled `apps/authoring-ui-vscode/dist/` output is needed
- `specs/` directory (documentation)
- `extension/src/` TypeScript source files
- `extension/out/` (tsc output, not the esbuild bundle)
- `**/*.map` source maps
- `**/*.test.ts`, `**/*.spec.ts`, test fixtures
- Root `node_modules/`
- `.vscode/`, `.github/`

**Rationale**: These paths are build-time inputs or documentation. The VSIX needs only: `extension/dist/extension.js` (esbuild bundle), `apps/authoring-ui-vscode/dist/` (Angular assets), and `extension/package.json`. Angular submodule source alone is several hundred MB.

**Resolved**: No NEEDS CLARIFICATION.

---

## Decision 6: "Install Companion" Notification (FR-008)

**Decision**: Enhance the existing `ontographEditor.openGraph` command handler. Current code shows a `showWarningMessage` string. Change to `showWarningMessage` with an "Install OntoGraph-lite" action button that calls `vscode.commands.executeCommand('workbench.extensions.installExtension', 'ysgao.ontograph-lite')`.

**Rationale**: VS Code exposes `workbench.extensions.installExtension` as a built-in command that triggers a marketplace install dialog. This is the correct API for offering in-product installation. The existing warning message in `extension.ts` is the exact place to inject this.

**Resolved**: No NEEDS CLARIFICATION.

---

## Summary of Code Touchpoints

| File | Change Type | Reason |
|------|-------------|--------|
| `extension/src/jreDetector.ts` | New | JRE detection service (FR-004) |
| `extension/src/extension.ts` | Modify | Call JRE check at activation; add Install Now to openGraph (FR-004, FR-008) |
| `extension/package.json` | Modify | Add description, icon path, repository, categories, `@vscode/vsce` devDep, `package:vsix` script |
| `extension/.vscodeignore` | New | Exclude non-VSIX assets (FR-006) |
| `.github/workflows/release.yml` | New | CI/CD release pipeline (FR-007) |
