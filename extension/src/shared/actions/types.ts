import * as vscode from 'vscode';

/**
 * Raw `metadata` object from authoring-services' `GET /projects/{projectKey}` — mirrors what
 * `apps/authoring-ui-vscode`'s `metadataService.js`'s `setExtensionMetadata()` consumes from the
 * same response. Known fields are typed; `requiredLanguageRefset.<lang>` dotted keys (dynamic,
 * one per extension language) fall through the index signature — see dialectMetadata.ts's
 * parseDialectMetadata(), which is the only place that scans for them.
 */
export interface ProjectMetadata {
  defaultModuleId?: string;
  expectedExtensionModules?: string[];
  multipleModuleEditingDisabled?: boolean | string;
  useInternationalLanguageRefsets?: boolean;
  requiredLanguageRefsets?: Array<Record<string, unknown>>;
  optionalLanguageRefsets?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Shared context every action handler receives — one instance owned by ControlServer. */
export interface ActionContext {
  vscodeContext: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  /** Keyed by projectKey — caches the raw metadata object fetched by fetchProjectMetadata()
   * (taskContext.ts), shared by moduleId resolution and dialect/acceptability resolution alike
   * so both draw from a single GET /projects/{projectKey} call. */
  projectMetadataCache: Map<string, ProjectMetadata>;
}

export interface ActionResult {
  statusCode: number;
  body: unknown;
}

export interface TaskContextInput {
  projectKey?: string;
  taskKey?: string;
  branchPath?: string;
}
