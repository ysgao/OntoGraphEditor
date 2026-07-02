import * as vscode from 'vscode';
import type {
  EntityType,
  OntologyModel,
  OWLClass,
  OWLObjectProperty,
  OWLDataProperty,
  OWLAnnotationProperty,
  OWLIndividual,
  OWLEntityUnion,
} from '../model/OntologyModel';
import type { OntologyIndex } from '../model/OntologyIndex';
import { resolveNamespace, validateLocalName, constructIri } from '../utils/namespaceUtils';
import { insertNewEntity } from '../sync/EntityCreationSync';
import { queueSyncWrite } from '../sync/reloadGuard';
import { buildModelSegmentIndexAsync } from '../model/SegmentIndex';
import { writeTextStreamed } from '../sync/streamWrite';
import { highlightSyncedRanges } from '../views/syncHighlight';

/** Legacy stub — preserved so the existing command registration compiles. */
export async function addEntity(model: OntologyModel | undefined): Promise<void> {
  if (!model) {
    vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
    return;
  }
  vscode.window.showInformationMessage('OntoGraph: Use the panel toolbar buttons to add entities.');
}

/**
 * Full entity-creation flow. Called by each per-type command registration.
 *
 * @param entityType - The OWL entity type to create.
 * @param parentIri  - IRI of the focused entity to use as parent, or undefined.
 * @param context    - VS Code extension context.
 * @param model      - The active ontology model (mutated in place).
 * @param index      - The active ontology index (used for duplicate-IRI check).
 * @param onCreated  - Called after the entity is written; should refresh views
 *                     and open the entity editor.
 */
export async function createEntity(
  entityType: EntityType,
  parentIri: string | undefined,
  context: vscode.ExtensionContext,
  model: OntologyModel,
  index: OntologyIndex,
  onCreated: (model: OntologyModel, iri: string) => void,
): Promise<void> {
  // 1. Resolve namespace silently — no separate popup
  const cfg = vscode.workspace.getConfiguration('ontograph');
  const settingNs = cfg.get<string>('entity.defaultNamespace') ?? '';
  const namespace = resolveNamespace(model, settingNs);
  if (namespace === undefined) {
    void vscode.window.showWarningMessage(
      'OntoGraph: No namespace available. Set `ontograph.entity.defaultNamespace` in Settings, or open an ontology that declares a namespace IRI.',
    );
    return;
  }

  // 2. Single local-name popup — namespace shown in prompt for context
  const localName = await vscode.window.showInputBox({
    prompt: `Local name for the new ${entityType} (namespace: ${namespace})`,
    placeHolder: 'MyEntity',
    validateInput: (name) => {
      const result = validateLocalName(name);
      if (result !== true) { return result.reason; }
      const iri = constructIri(namespace, name);
      if (index.getByIri(iri) !== undefined) {
        return `An entity with IRI <${iri}> already exists in this ontology.`;
      }
      return undefined;
    },
  });
  if (!localName) { return; }

  const iri = constructIri(namespace, localName);

  // 3. Build minimal entity object — no rdfs:label is set; the user adds it
  //    later via the Entity Editor.
  const entity = buildEntity(entityType, iri, parentIri);

  // 4. Insert into source text; collect the inserted line ranges for highlighting.
  const insertedRanges: vscode.Range[] = [];
  const newText = insertNewEntity(model.rawContent, entity, model, insertedRanges);
  if (model.sourceFormat !== 'functional') {
    // insertNewEntity showed a warning for non-functional formats; bail out
    return;
  }

  // 5. Write to file with reload suppression
  const uri = vscode.Uri.parse(model.sourceUri);
  await queueSyncWrite(uri.toString(), async () => {
    model.rawContent = newText;

    // Add entity to the correct model Map
    switch (entity.type) {
      case 'class':
        model.classes.set(entity.iri, entity);
        break;
      case 'objectProperty':
        model.objectProperties.set(entity.iri, entity);
        break;
      case 'dataProperty':
        model.dataProperties.set(entity.iri, entity);
        break;
      case 'annotationProperty':
        model.annotationProperties.set(entity.iri, entity);
        break;
      case 'individual':
        model.individuals.set(entity.iri, entity);
        break;
    }

    // Force segment index rebuild so subsequent syncs find the new entity
    model.entitySegments = undefined;
    if (model.sourceFormat === 'functional') {
      await buildModelSegmentIndexAsync(model);
    }

    await writeTextStreamed(uri, newText);
  });

  // 6. Refresh views and open entity editor
  onCreated(model, iri);

  // 7. Highlight the newly inserted lines (display-only; does not alter the file).
  highlightSyncedRanges(uri, insertedRanges);
}

function buildEntity(
  entityType: EntityType,
  iri: string,
  parentIri: string | undefined,
): OWLEntityUnion {
  const base = { iri, labels: {}, annotations: {} };
  switch (entityType) {
    case 'class':
      return {
        ...base,
        type: 'class',
        superClassIris: parentIri ? [parentIri] : [],
        equivalentClassIris: [],
        disjointClassIris: [],
        superClassExpressions: [],
        equivalentClassExpressions: [],
        gciExpressions: [],
      } satisfies OWLClass;
    case 'objectProperty':
      return {
        ...base,
        type: 'objectProperty',
        superPropertyIris: parentIri ? [parentIri] : [],
        domainIris: [],
        rangeIris: [],
      } satisfies OWLObjectProperty;
    case 'dataProperty':
      return {
        ...base,
        type: 'dataProperty',
        superPropertyIris: parentIri ? [parentIri] : [],
        domainIris: [],
        rangeIris: [],
      } satisfies OWLDataProperty;
    case 'annotationProperty':
      return {
        ...base,
        type: 'annotationProperty',
        superPropertyIris: parentIri ? [parentIri] : [],
        domainIris: [],
        rangeIris: [],
      } satisfies OWLAnnotationProperty;
    case 'individual':
      return {
        ...base,
        type: 'individual',
        classIris: [],
        objectPropertyAssertions: [],
        dataPropertyAssertions: [],
      } satisfies OWLIndividual;
  }
}
