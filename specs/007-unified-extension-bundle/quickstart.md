# Quickstart: Building the Unified Extension

Follow these steps to build the unified `ontograph-editor` VSIX.

## Prerequisites

- Node.js 18+
- npm (or yarn)
- Git (for submodules)
- Java 21+ (for the OWL reasoner)

## Initial Setup

```bash
# Clone the repository and submodules
git clone --recursive https://github.com/ysgao/OntoGraphEditor.git
cd OntoGraphEditor

# Sync submodules and install all dependencies
./scripts/sync-submodules.sh
```

## Build Process

```bash
# Validate submodules, build submodules, and bundle the main extension
npm run build-all
```

The `build-all` command executes:
1. `scripts/validate-submodules.sh` (validates submodule initialization)
2. `cd apps/authoring-ui-vscode && npx grunt build`
3. `cd apps/OntoGraph-lite && npm run build`
4. `cd extension && node esbuild.mjs`

## Packaging

```bash
# Package the VSIX
npm run package:vsix
```

The output will be in `extension/dist/ontograph-editor-extension-X.Y.Z.vsix`.

## Debugging

1. Open the project in VS Code.
2. Press `F5` to launch the "Extension" debug configuration.
3. This will launch a new VS Code instance with the unified extension active.
