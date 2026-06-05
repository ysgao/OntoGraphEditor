import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';

export async function addEntity(model: OntologyModel | undefined): Promise<void> {
  if (!model) {
    vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
    return;
  }
  vscode.window.showInformationMessage('OntoGraph: Add entity will be available in Phase 5.');
}
