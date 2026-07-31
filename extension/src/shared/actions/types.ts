import * as vscode from 'vscode';

/** Shared context every action handler receives — one instance owned by ControlServer. */
export interface ActionContext {
  vscodeContext: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  moduleIdCache: Map<string, string>;
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
