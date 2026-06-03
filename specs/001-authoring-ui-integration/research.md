# Research & Decisions: Angular Authoring UI Integration

This document outlines the technical research, architectural decisions, and rationale for integrating the Angular-based clinical terminology authoring interface into the VS Code extension environment.

## 0. Framework Version Verification (T018)

### Finding
**IHTSDO/authoring-ui is AngularJS 1.x (v1.4.14)**, not Angular 2+.

### Impact on Plan
* `HashLocationStrategy` (Angular 2+ class) does **not apply**. AngularJS 1.x uses hash-based routing by default — HTML5 mode must be explicitly opted-in via `$locationProvider.html5Mode(true)`, which this app does not do. No routing changes are required.
* `app-routing.module.ts` does not exist. AngularJS routing is configured via `$routeProvider` in `app/scripts/app.js`.
* `angular.json` does not exist. The build system is **Grunt** (not Angular CLI). Build output goes to `dist/`. The npm build script must invoke `npx grunt build` instead of `ng build --prod`.
* Tasks T005, T006, T014 must be adapted: T006/T014 are no-ops (routing already correct); T005 means verifying Grunt output path rather than configuring `angular.json`.
* `VsCodeService` must be an **AngularJS factory/service** (not an Angular 2+ `@Injectable`), registered with the AngularJS DI system.

---

## 1. Routing in Webview Sandbox

### Decision
No routing changes required. AngularJS 1.x hash-based routing (`#!/path`) is already the default.

### Rationale (updated)
AngularJS 1.x uses hash fragments natively unless `$locationProvider.html5Mode(true)` is called. IHTSDO/authoring-ui does not enable HTML5 mode, so it already uses `#!/`-prefixed routes compatible with VS Code's webview protocol.

### Rationale
* **Webview Protocol**: VS Code webviews load local files using custom schemes like `vscode-webview://`. 
* **Path Resolution**: When using `PathLocationStrategy`, route transitions attempt to manipulate the URL path directly (e.g., `vscode-webview://.../concepts`). Because there is no real web server backing this, reloading or triggering direct routing actions would result in resource not found (404) errors.
* **Hash Fallback**: `HashLocationStrategy` keeps the base document at `index.html` and appends routes as hash fragments (`#/concepts`), preventing the browser frame from requesting new physical pages from the webview host.

### Alternatives Considered
* **MemoryRouting**: Keeps route states in memory without updating the URL. Rejected because it breaks back-button support and makes component deep-linking complex.

---

## 2. IPC Communication Bridge

### Decision
Implement a custom **AngularJS factory** `vsCodeService` acting as an adapter (not an Angular 2+ `@Injectable`).

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
* **Simple Execution**: A single `npm run build-all` command will run cleanups, compile the AngularJS app via Grunt into `dist/`, and bundle the extension via esbuild.

### Adapted build:client script
Since IHTSDO/authoring-ui uses Grunt (not Angular CLI), `build:client` must invoke `npx grunt build` from the submodule directory, not `ng build --prod`. The root `package.json` `build:client` script is updated accordingly.
