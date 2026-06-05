import * as vscode from 'vscode';
import type { ReasonerBridge } from '../reasoner/ReasonerBridge';
import type { OntologyModel } from '../model/OntologyModel';
import { serializeToFunctional } from '../serializer/FunctionalSerializer';

let explanationPanel: vscode.WebviewPanel | undefined;

export async function checkConsistency(
  model: OntologyModel | undefined,
  bridge: ReasonerBridge,
  context: vscode.ExtensionContext,
): Promise<void> {
  if (!model) {
    void vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
    return;
  }

  const sourceDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === model.sourceUri);
  const { content, format } = sourceDoc
    ? { content: sourceDoc.getText(), format: model.sourceFormat }
    : model.rawContent
      ? { content: model.rawContent, format: model.sourceFormat }
      : { content: serializeToFunctional(model), format: 'functional' };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'OntoGraph: Checking consistency…', cancellable: false },
    async () => {
      try {
        const result = await bridge.checkConsistency(format, content);
        if (result.consistent) {
          void vscode.window.showInformationMessage('OntoGraph: Ontology is consistent.');
        } else if (result.explanation?.length) {
          showExplanationPanel(result.explanation, context);
        } else {
          void vscode.window.showErrorMessage(
            'OntoGraph: Ontology is INCONSISTENT. Enable the Java reasoner for a detailed explanation.',
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`OntoGraph: Consistency check failed — ${msg}`);
      }
    },
  );
}

function showExplanationPanel(explanation: string[], context: vscode.ExtensionContext): void {
  if (explanationPanel) {
    explanationPanel.title = 'Inconsistency Explanation';
    explanationPanel.webview.html = buildExplanationHtml(explanation);
    explanationPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  explanationPanel = vscode.window.createWebviewPanel(
    'ontograph.explanation',
    'Inconsistency Explanation',
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: false },
  );
  explanationPanel.webview.html = buildExplanationHtml(explanation);
  explanationPanel.onDidDispose(() => { explanationPanel = undefined; }, null, context.subscriptions);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildExplanationHtml(axioms: string[]): string {
  const rows = axioms.map(a => `<li><code>${esc(a)}</code></li>`).join('\n');
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #d4d4d4);
    padding: 20px;
    max-width: 900px;
  }
  h1 { font-size: 1.2em; color: var(--vscode-errorForeground, #f44); margin-bottom: 6px; }
  p  { color: var(--vscode-descriptionForeground, #999); margin-bottom: 16px; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; }
  code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
    background: var(--vscode-textCodeBlock-background, #2d2d2d);
    padding: 2px 6px;
    border-radius: 3px;
    word-break: break-all;
  }
</style>
</head>
<body>
  <h1>Ontology is INCONSISTENT</h1>
  <p>The following axioms form a minimal justification (explanation) for the inconsistency:</p>
  <ul>${rows}</ul>
</body>
</html>`;
}
