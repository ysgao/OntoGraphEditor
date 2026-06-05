import type * as vscode from 'vscode';
import type { OntologyModel, EntityType } from '../model/OntologyModel.js';
import type { OntologyIndex } from '../model/OntologyIndex.js';
import type { ReasonerBridge } from '../reasoner/ReasonerBridge.js';
import { openDLQueryPanel } from '../views/DLQueryPanel.js';

export function openDLQuery(
  context: vscode.ExtensionContext,
  bridge: ReasonerBridge,
  model: OntologyModel | undefined,
  index: OntologyIndex | undefined,
  revealFn: (iri: string, entityType: EntityType) => void,
): void {
  openDLQueryPanel(
    context,
    bridge,
    model,
    index,
    (iri, entityType) => revealFn(iri, entityType as EntityType),
  );
}
