import * as vscode from 'vscode';

const CONFLICT_START = /^<{7} /m;

export interface ConflictInfo {
  count: number;
  firstLine: number; // 1-based
}

/** Returns conflict info if the text contains unresolved git merge markers, otherwise null. */
export function detectConflictMarkers(text: string): ConflictInfo | null {
  if (!CONFLICT_START.test(text)) { return null; }

  let count = 0;
  let firstLine = -1;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('<<<<<<< ')) {
      count++;
      if (firstLine === -1) { firstLine = i + 1; }
    }
  }
  return count > 0 ? { count, firstLine } : null;
}

/** Shows a blocking error and an "Open File" button that takes the user to the first conflict. */
export function showConflictError(uri: vscode.Uri, info: ConflictInfo): void {
  const fname = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
  const plural = info.count === 1 ? 'conflict' : 'conflicts';
  const msg = `OntoGraph: '${fname}' has ${info.count} unresolved git merge ${plural} (first at line ${info.firstLine}). Resolve them before loading.`;
  void vscode.window.showErrorMessage(msg, 'Open File').then(choice => {
    if (choice !== 'Open File') { return; }
    void vscode.workspace.openTextDocument(uri).then(doc => {
      void vscode.window.showTextDocument(doc, { selection: new vscode.Range(info.firstLine - 1, 0, info.firstLine - 1, 0) });
    });
  });
}
