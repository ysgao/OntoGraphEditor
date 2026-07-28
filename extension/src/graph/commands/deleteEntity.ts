import * as vscode from 'vscode';
import type { OntologyModel, OWLEntityUnion } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';
import type { OntologyIndex } from '../model/OntologyIndex';
import { getDirectSubtypes, getTransitiveSubtypes } from '../model/OntologyIndex';
import {
  isProtectedEntity,
  clearEntityAxiomBearingFields,
  reparentSubtype,
  ownSuperIris,
  findDeclarationAndHeaderLines,
  collapseDoubleBlankLines,
} from '../sync/EntityDeletionSync';
import { computeUpdatedText, closeEntityEditorIfShowing } from '../views/EntityEditorPanel';
import { queueSyncWrite } from '../sync/reloadGuard';
import { writeTextStreamed } from '../sync/streamWrite';
import { buildModelSegmentIndexAsync, applyIncrementalSegmentUpdate } from '../model/SegmentIndex';

function lookupEntity(model: OntologyModel, iri: string): OWLEntityUnion | undefined {
  return model.classes.get(iri)
    ?? model.objectProperties.get(iri)
    ?? model.dataProperties.get(iri)
    ?? model.annotationProperties.get(iri)
    ?? model.individuals.get(iri);
}

function removeFromModelMaps(model: OntologyModel, iri: string): void {
  model.classes.delete(iri);
  model.objectProperties.delete(iri);
  model.dataProperties.delete(iri);
  model.annotationProperties.delete(iri);
  model.individuals.delete(iri);
}

/**
 * Best-effort scan (FR-011) for references to `iris` outside the hierarchy
 * relationship this delete operation already handles: a property's domain/range,
 * an individual's asserted type, or a substring match inside another entity's
 * complex class expression. Returns human-readable warning lines, or [] if none.
 */
function findExternalReferenceWarnings(model: OntologyModel, iris: ReadonlySet<string>): string[] {
  const warnings: string[] = [];
  for (const prop of [...model.objectProperties.values(), ...model.dataProperties.values()]) {
    if (iris.has(prop.iri)) { continue; }
    if (prop.domainIris.some(d => iris.has(d)) || prop.rangeIris.some(r => iris.has(r))) {
      warnings.push(`"${getLabel(prop)}" uses one of these entities as a domain/range — that reference will be left dangling.`);
    }
  }
  for (const ind of model.individuals.values()) {
    if (ind.classIris.some(c => iris.has(c))) {
      warnings.push(`Individual "${getLabel(ind)}" asserts one of these entities as its type — that assertion will be left dangling.`);
    }
  }
  for (const cls of model.classes.values()) {
    if (iris.has(cls.iri)) { continue; }
    const expressions = [...cls.superClassExpressions, ...cls.equivalentClassExpressions, ...cls.gciExpressions];
    for (const iri of iris) {
      if (expressions.some(expr => expr.includes(iri))) {
        warnings.push(`"${getLabel(cls)}" references one of these entities inside a class expression — that reference will be left dangling.`);
        break;
      }
    }
  }
  return warnings;
}

interface DeletionPlan {
  targetIri: string;
  entity: OWLEntityUnion;
  directSubtypeIris: string[];
}

/**
 * Main entry point for the `ontograph.deleteEntity` command. Resolves the
 * selected entity, offers the entity-only-vs-cascade mode choice when the
 * entity has subtypes, confirms, then performs the deletion (or reparenting)
 * and rewrites the source file in place.
 */
export async function deleteEntity(
  iri: string | undefined,
  model: OntologyModel | undefined,
  index: OntologyIndex | undefined,
  onDeleted: (model: OntologyModel) => void,
): Promise<void> {
  if (!iri) {
    void vscode.window.showWarningMessage('OntoGraph: Right-click an entity to delete it.');
    return;
  }
  if (!model || !index) {
    void vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
    return;
  }
  if (isProtectedEntity(iri)) {
    void vscode.window.showWarningMessage('OntoGraph: The ontology root cannot be deleted.');
    return;
  }

  const entity = lookupEntity(model, iri);
  if (!entity || index.getByIri(iri) === undefined) {
    void vscode.window.showWarningMessage('OntoGraph: This entity no longer exists — it may have been changed by an external edit.');
    return;
  }

  const plan: DeletionPlan = {
    targetIri: iri,
    entity,
    directSubtypeIris: getDirectSubtypes(iri, model),
  };

  const label = getLabel(entity);

  let cascade = false;
  if (plan.directSubtypeIris.length > 0) {
    const entityOnlyLabel = `Delete entity only (reparent ${plan.directSubtypeIris.length} subtype${plan.directSubtypeIris.length === 1 ? '' : 's'})`;
    const cascadeLabel = 'Delete entity and all subtypes';
    const picked = await vscode.window.showQuickPick(
      [
        { label: entityOnlyLabel, cascade: false },
        { label: cascadeLabel, cascade: true },
      ],
      {
        title: `Delete "${label}" — choose how to handle its subtypes`,
        placeHolder: entityOnlyLabel,
      },
    );
    if (!picked) { return; }
    cascade = picked.cascade;
  }

  const transitiveSubtypeIris = cascade ? getTransitiveSubtypes(iri, model) : [];
  const allIrisToDelete = cascade ? [iri, ...transitiveSubtypeIris] : [iri];

  const affectedSet = new Set(allIrisToDelete);
  const externalWarnings = findExternalReferenceWarnings(model, affectedSet);

  const countMessage = cascade
    ? `Delete "${label}" and ${transitiveSubtypeIris.length} subtype${transitiveSubtypeIris.length === 1 ? '' : 's'} (${allIrisToDelete.length} entities total)?`
    : plan.directSubtypeIris.length > 0
      ? `Delete "${label}" only? Its ${plan.directSubtypeIris.length} direct subtype${plan.directSubtypeIris.length === 1 ? '' : 's'} will be reparented.`
      : `Delete "${label}"?`;

  const detail = externalWarnings.length > 0
    ? `\n\nWarning:\n${externalWarnings.slice(0, 5).join('\n')}${externalWarnings.length > 5 ? `\n…and ${externalWarnings.length - 5} more.` : ''}`
    : '';

  const confirmed = await vscode.window.showWarningMessage(
    countMessage + detail,
    { modal: true },
    'Delete',
  );
  if (confirmed !== 'Delete') { return; }

  const uri = vscode.Uri.parse(model.sourceUri);
  const fmt = model.sourceFormat;

  await queueSyncWrite(uri.toString(), async () => {
    let baseContent: string | undefined = model.rawContent || undefined;

    // Phase A (entity-only mode): reparent each direct subtype that is related
    // via the plain super-IRI array; expression-only relationships were already
    // surfaced as an external-reference-style warning above and are left as-is.
    if (!cascade) {
      const targetSupers = ownSuperIris(entity);
      for (const subIri of plan.directSubtypeIris) {
        const subtype = lookupEntity(model, subIri);
        if (!subtype) { continue; }
        const applied = reparentSubtype(subtype, iri, targetSupers);
        if (!applied) { continue; }

        const seg = model.entitySegments?.get(subIri);
        const gciSeg = subtype.type === 'class' ? model.gciSegments?.get(subIri) : undefined;
        const { text, annotEditSummaries, axiomEditSummaries } = await computeUpdatedText(
          uri, subtype, fmt, baseContent, seg, gciSeg, model.closingParenLine, model.gciInsertLine,
        );
        if (text !== undefined) {
          baseContent = text;
          model.rawContent = text;
          if (annotEditSummaries.length > 0) { applyIncrementalSegmentUpdate(model, subIri, annotEditSummaries); }
          if (axiomEditSummaries.length > 0) { applyIncrementalSegmentUpdate(model, subIri, axiomEditSummaries); }
        }
      }
    }

    // Phase B: strip axioms/annotations/GCIs for every entity being deleted.
    for (const delIri of allIrisToDelete) {
      const delEntity = lookupEntity(model, delIri);
      if (!delEntity) { continue; }
      clearEntityAxiomBearingFields(delEntity);

      const seg = model.entitySegments?.get(delIri);
      const gciSeg = delEntity.type === 'class' ? model.gciSegments?.get(delIri) : undefined;
      const { text, annotEditSummaries, axiomEditSummaries } = await computeUpdatedText(
        uri, delEntity, fmt, baseContent, seg, gciSeg, model.closingParenLine, model.gciInsertLine,
      );
      if (text !== undefined) {
        baseContent = text;
        model.rawContent = text;
        if (annotEditSummaries.length > 0) { applyIncrementalSegmentUpdate(model, delIri, annotEditSummaries); }
        if (axiomEditSummaries.length > 0) { applyIncrementalSegmentUpdate(model, delIri, axiomEditSummaries); }
      }
    }

    // Phase C: remove each deleted entity's Declaration line + cluster header
    // comment (never managed by computeUpdatedText), then collapse blank runs.
    if (baseContent !== undefined && fmt === 'functional') {
      const lines = baseContent.split('\n');
      const removeLineSet = new Set<number>();
      for (const delIri of allIrisToDelete) {
        const delEntity = lookupEntity(model, delIri);
        if (!delEntity) { continue; }
        for (const l of findDeclarationAndHeaderLines(model, delIri, delEntity, lines)) {
          removeLineSet.add(l);
        }
      }
      const kept = lines.filter((_, idx) => !removeLineSet.has(idx));
      baseContent = collapseDoubleBlankLines(kept).join('\n');
      model.rawContent = baseContent;
    }

    // Phase D: model + disk + segment index.
    for (const delIri of allIrisToDelete) { removeFromModelMaps(model, delIri); }

    if (baseContent !== undefined) {
      await writeTextStreamed(uri, baseContent);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        model.sourceMtimeMs = stat.mtime;
        model.sourceSize = stat.size;
      } catch { /* non-fatal */ }
    }
    await buildModelSegmentIndexAsync(model);
  });

  for (const delIri of allIrisToDelete) { closeEntityEditorIfShowing(delIri); }
  onDeleted(model);
}
