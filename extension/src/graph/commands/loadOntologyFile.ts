import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { ParserRegistry } from '../parser/ParserRegistry';

const ONTOLOGY_EXTENSIONS = ['owl', 'ofn', 'omn', 'ttl', 'owx', 'n3'];

let isLoading = false;

export async function loadOntologyFile(
  onLoaded: (model: OntologyModel) => void,
  prefillUri?: vscode.Uri,
): Promise<void> {
  if (isLoading) {
    void vscode.window.showInformationMessage('OntoGraph: a load is already in progress.');
    return;
  }

  isLoading = true;
  try {
    let uri: vscode.Uri | undefined;
    if (prefillUri) {
      uri = prefillUri;
    } else {
      const result = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Ontology Files': ONTOLOGY_EXTENSIONS },
        title: 'Load Ontology File',
      });
      if (!result || result.length === 0) { return; }
      uri = result[0];
    }

    const filename = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `OntoGraph: loading ${filename}…`,
        cancellable: false,
      },
      async () => {
        let text: string;
        let stat: vscode.FileStat;
        try {
          const [bytes, fileStat] = await Promise.all([
            vscode.workspace.fs.readFile(uri!),
            vscode.workspace.fs.stat(uri!),
          ]);
          text = new TextDecoder().decode(bytes);
          stat = fileStat;
        } catch (readErr) {
          const msg = readErr instanceof Error ? readErr.message : String(readErr);
          void vscode.window.showErrorMessage(`OntoGraph: failed to read '${filename}' — ${msg}.`);
          return;
        }

        const langId = 'auto';
        try {
          const model = await ParserRegistry.parseAsync(text, langId, uri!.toString());
          model.sourceMtimeMs = stat.mtime;
          model.sourceSize = stat.size;
          onLoaded(model);
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          if (msg.toLowerCase().includes('could not detect') || msg.toLowerCase().includes('no parser registered')) {
            void vscode.window.showErrorMessage(`OntoGraph: cannot detect ontology format for '${filename}'.`);
          } else {
            void vscode.window.showErrorMessage(`OntoGraph: failed to parse '${filename}' — ${msg}.`);
          }
        }
      },
    );
  } finally {
    isLoading = false;
  }
}
