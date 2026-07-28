import type {
  OntologyModel,
  OWLClass,
  OWLObjectProperty,
  OWLDataProperty,
  OWLAnnotationProperty,
  OWLIndividual,
  OWLEntityUnion,
} from '../model/OntologyModel';

const OWL = 'http://www.w3.org/2002/07/owl#';
export const OWL_THING = `${OWL}Thing`;
export const OWL_NOTHING = `${OWL}Nothing`;

/** Built-in root entities that must never be deleted (FR-009). */
export function isProtectedEntity(iri: string): boolean {
  return iri === OWL_THING || iri === OWL_NOTHING;
}

const CLUSTER_TYPE_LABEL: Record<OWLEntityUnion['type'], string> = {
  class: 'Class',
  objectProperty: 'ObjectProperty',
  dataProperty: 'DataProperty',
  annotationProperty: 'AnnotationProperty',
  individual: 'Individual',
};

/**
 * Clear every axiom/annotation-bearing field on an entity so that a subsequent
 * `computeUpdatedText` call (from `EntityEditorPanel.ts`) regenerates zero
 * lines for it — the diff against the existing file then removes every axiom,
 * GCI, and annotation line already synced for this entity. Declaration and any
 * cluster header comment are NOT touched here (`computeUpdatedText` never
 * manages those) — see {@link removeDeclarationAndHeaderLines}.
 */
export function clearEntityAxiomBearingFields(entity: OWLEntityUnion): void {
  entity.labels = {};
  entity.annotations = {};
  switch (entity.type) {
    case 'class': {
      const cls = entity as OWLClass;
      cls.superClassIris = [];
      cls.equivalentClassIris = [];
      cls.disjointClassIris = [];
      cls.superClassExpressions = [];
      cls.equivalentClassExpressions = [];
      cls.gciExpressions = [];
      break;
    }
    case 'objectProperty': {
      const prop = entity as OWLObjectProperty;
      prop.superPropertyIris = [];
      prop.domainIris = [];
      prop.rangeIris = [];
      prop.isTransitive = undefined;
      prop.isSymmetric = undefined;
      prop.isFunctional = undefined;
      prop.isInverseFunctional = undefined;
      prop.isReflexive = undefined;
      prop.isIrreflexive = undefined;
      prop.isAsymmetric = undefined;
      prop.inverseOfIri = undefined;
      prop.equivalentPropertyIris = [];
      prop.disjointPropertyIris = [];
      prop.propertyChains = [];
      break;
    }
    case 'dataProperty': {
      const prop = entity as OWLDataProperty;
      prop.superPropertyIris = [];
      prop.domainIris = [];
      prop.rangeIris = [];
      prop.isFunctional = undefined;
      break;
    }
    case 'annotationProperty': {
      const prop = entity as OWLAnnotationProperty;
      prop.superPropertyIris = [];
      prop.domainIris = [];
      prop.rangeIris = [];
      break;
    }
    case 'individual': {
      const ind = entity as OWLIndividual;
      ind.classIris = [];
      ind.objectPropertyAssertions = [];
      ind.dataPropertyAssertions = [];
      break;
    }
  }
}

/**
 * Replace `targetIri` in a direct subtype's own super-IRI array with the
 * target's super-IRIs, deduplicated (data-model.md's reparenting rule).
 * Only handles the plain-array relationship (`superClassIris`/`superPropertyIris`)
 * — a subtype reachable only via a named conjunct inside a complex expression
 * (conjunction-elimination case) is NOT auto-reparented; callers should warn
 * instead. Returns true if a plain-array reparent was applied.
 */
export function reparentSubtype(
  subtype: OWLEntityUnion,
  targetIri: string,
  targetSuperIris: readonly string[],
): boolean {
  const field = subtype.type === 'class' ? (subtype as OWLClass).superClassIris
    : 'superPropertyIris' in subtype ? subtype.superPropertyIris
    : undefined;
  if (!field || !field.includes(targetIri)) { return false; }

  const merged = new Set(field);
  merged.delete(targetIri);
  for (const s of targetSuperIris) { merged.add(s); }
  const result = [...merged];

  if (subtype.type === 'class') {
    (subtype as OWLClass).superClassIris = result;
  } else if ('superPropertyIris' in subtype) {
    subtype.superPropertyIris = result;
  }
  return true;
}

/** This entity's own direct super-IRIs, used as the reparenting target set. */
export function ownSuperIris(entity: OWLEntityUnion): readonly string[] {
  if (entity.type === 'class') { return entity.superClassIris; }
  if ('superPropertyIris' in entity) { return entity.superPropertyIris; }
  return [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the line indices to remove for an entity's Declaration line and (if
 * present) its cluster header comment, once `clearEntityAxiomBearingFields`
 * + a `computeUpdatedText` sync have already stripped its axioms/annotations.
 *
 * Declaration line: the entity's remaining `entitySegments` lines (Declaration
 * is tracked there alongside axioms/annotations by `SegmentIndex.ts`; after
 * clearing, only the Declaration line should remain).
 * Header comment: `generateEntityCluster` always emits `# TypeLabel: <iri> (label)`
 * with the entity's full IRI in bracket form, so it can be found directly by
 * text search — best-effort, since hand-authored files may omit it.
 */
export function findDeclarationAndHeaderLines(
  model: OntologyModel,
  iri: string,
  entity: OWLEntityUnion,
  lines: readonly string[],
): number[] {
  const result = new Set<number>();

  const seg = model.entitySegments?.get(iri);
  if (seg?.lineIndices) {
    for (const l of seg.lineIndices) { result.add(l); }
  }

  const typeLabel = CLUSTER_TYPE_LABEL[entity.type];
  const headerRe = new RegExp(`^\\s*#\\s*${typeLabel}:\\s*<${escapeRegExp(iri)}>\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i] ?? '')) { result.add(i); break; }
  }

  return [...result];
}

/** Collapse any run of 2+ consecutive blank lines down to exactly 1. */
export function collapseDoubleBlankLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) { continue; }
    out.push(line);
    prevBlank = isBlank;
  }
  return out;
}
