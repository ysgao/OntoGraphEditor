# Quickstart Guide: Angular UI & Extension Integration

This guide provides instructions for developers to set up, compile, and run the integrated OntoGraph Editor workspace.

## 1. Directory Setup

Ensure the following submodules and directories are present in your workspace:

```text
/Users/yoga/OntoGraphEditor/
├── extension/                   # Main VS Code Extension Bundle (TypeScript)
└── apps/
    └── authoring-ui-vscode/     # Fork of the Angular Authoring UI
```

---

## 2. Compilation and Packaging

To compile both components, run the following command from the repository root:

```bash
npm run build-all
```

This single command triggers the build sequence:
1. **Clean**: Removes stale build artifacts.
2. **Frontend Compilation**: Runs the Angular build in `apps/authoring-ui-vscode` to compile the app as static assets.
3. **Backend Compilation**: Runs the TypeScript compiler (`tsc`) on the extension host code inside `extension/`.

---

## 3. Running Locally for Development

1. Open `/Users/yoga/OntoGraphEditor` in VS Code.
2. Open the **Run and Debug** view (`Ctrl+Shift+D` or `Cmd+Shift+D`).
3. Select **"Launch Extension"** from the dropdown menu and press `F5`.
4. A new **[Extension Development Host]** VS Code window will launch.
5. In the new window, trigger the command `OntoGraph: Open Editing Workbench` to verify the Angular application loads correctly inside the webview panel.
