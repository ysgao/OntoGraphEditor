import * as vscode from 'vscode';
import * as path from 'path';
import type { ReasonerBridge } from '../reasoner/ReasonerBridge';
import type { OntologyModel } from '../model/OntologyModel';
import { serializeToFunctional } from '../serializer/FunctionalSerializer';

interface FormatOption extends vscode.QuickPickItem {
  format: string;
  ext: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    label: 'OWL Functional Syntax',
    description: '.ofn  (no Java required)',
    format: 'functional',
    ext: '.ofn',
  },
  {
    label: 'OWL/XML',
    description: '.owl  (requires Java reasoner)',
    format: 'owl-xml',
    ext: '.owl',
  },
  {
    label: 'Manchester Syntax',
    description: '.omn  (requires Java reasoner)',
    format: 'manchester',
    ext: '.omn',
  },
  {
    label: 'Turtle',
    description: '.ttl  (requires Java reasoner)',
    format: 'turtle',
    ext: '.ttl',
  },
  {
    label: 'RDF/XML',
    description: '.rdf  (requires Java reasoner)',
    format: 'rdf-xml',
    ext: '.rdf',
  },
];

export async function exportOntology(
  model: OntologyModel | undefined,
  bridge: ReasonerBridge,
): Promise<void> {
  if (!model) {
    void vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
    return;
  }

  const picked = await vscode.window.showQuickPick(FORMAT_OPTIONS, {
    placeHolder: 'Select export format',
    matchOnDescription: true,
  });
  if (!picked) { return; }

  // Suggest a save path based on the source file
  const srcUri = vscode.Uri.parse(model.sourceUri);
  const srcDir = path.dirname(srcUri.fsPath);
  const srcBase = path.basename(srcUri.fsPath, path.extname(srcUri.fsPath));
  const defaultUri = vscode.Uri.file(path.join(srcDir, `${srcBase}-export${picked.ext}`));

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'OWL Ontology': [picked.ext.slice(1)] },
    title: `Export Ontology as ${picked.label}`,
  });
  if (!saveUri) { return; }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `OntoGraph: Exporting as ${picked.label}…`, cancellable: false },
    async () => {
      try {
        let content: string;

        if (picked.format === 'functional') {
          // Pure TypeScript path — no Java required
          content = serializeToFunctional(model);
        } else {
          // Serialize to Functional first, then let OWLAPI convert to the target format
          const functional = serializeToFunctional(model);
          content = await bridge.convertFormat(functional, 'functional', picked.format);
        }

        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));

        const action = await vscode.window.showInformationMessage(
          `OntoGraph: Exported to ${path.basename(saveUri.fsPath)}`,
          'Open File',
        );
        if (action === 'Open File') {
          await vscode.window.showTextDocument(saveUri);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`OntoGraph export failed: ${msg}`);
      }
    },
  );
}
