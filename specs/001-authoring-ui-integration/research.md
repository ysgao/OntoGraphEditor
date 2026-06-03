# Research & Decisions: Angular Authoring UI Integration

This document outlines the technical research, architectural decisions, and rationale for integrating the Angular-based clinical terminology authoring interface into the VS Code extension environment.

## 1. Routing in Webview Sandbox

### Decision
Use Angular's **`HashLocationStrategy`** instead of the default `PathLocationStrategy`.

### Rationale
* **Webview Protocol**: VS Code webviews load local files using custom schemes like `vscode-webview://`. 
* **Path Resolution**: When using `PathLocationStrategy`, route transitions attempt to manipulate the URL path directly (e.g., `vscode-webview://.../concepts`). Because there is no real web server backing this, reloading or triggering direct routing actions would result in resource not found (404) errors.
* **Hash Fallback**: `HashLocationStrategy` keeps the base document at `index.html` and appends routes as hash fragments (`#/concepts`), preventing the browser frame from requesting new physical pages from the webview host.

### Alternatives Considered
* **MemoryRouting**: Keeps route states in memory without updating the URL. Rejected because it breaks back-button support and makes component deep-linking complex.

---

## 2. IPC Communication Bridge

### Decision
Implement a custom Angular injectable **`VsCodeService`** acting as an adapter.

### Rationale
* **Environment Detection**: The service must check if the VS Code API is present (`acquireVsCodeApi` exists) to safely distinguish execution in the extension webview vs. standalone browser debugging.
* **Message Propagation**: Encapsulates `window.parent.postMessage` or `vscode.postMessage` so components don't have direct dependencies on sandboxed browser environments.

### Alternatives Considered
* **Direct Webview Messaging in Components**: Spreading `postMessage` calls across individual Angular components. Rejected as it couples components to the VS Code API and prevents standalone local browser testing.

---

## 3. Monorepo Orchestration and Package Scripts

### Decision
Define simple npm scripts in the root `package.json` to orchestrate builds.

### Rationale
* **No Extra Tooling**: Avoids complex monorepo managers (Lerna, Nx) which increase build complexity and dependency sizes.
* **Simple Execution**: A single `npm run build-all` command will run cleanups, compile the Angular app into the target build folder, and run TypeScript compiler on the extension host files.
