export type EntityType = 'class' | 'objectProperty' | 'dataProperty' | 'annotationProperty' | 'individual';

export interface DLQueryResult {
  directSuperClasses: string[];
  superClasses:       string[];
  equivalentClasses:  string[];
  directSubClasses:   string[];
  subClasses:         string[];
  instances:          string[];
}

export interface OWLEntity {
  iri: string;
  type: EntityType;
  labels: Record<string, string[]>; // lang → [label, ...]
  annotations: Record<string, string[]>; // annotation property IRI → [value, ...]
}

export interface OWLClass extends OWLEntity {
  type: 'class';
  superClassIris: string[];
  equivalentClassIris: string[];
  disjointClassIris: string[];
  /** Blank-node complex expressions encoded as Manchester Syntax strings */
  superClassExpressions: string[];
  equivalentClassExpressions: string[];
  /** Left-hand complex expressions in GCI axioms where this class is the superclass */
  gciExpressions: string[];
}

export interface OWLProperty extends OWLEntity {
  superPropertyIris: string[];
  domainIris: string[];
  rangeIris: string[];
  isTransitive?: boolean;
  isSymmetric?: boolean;
  isFunctional?: boolean;
}

export interface OWLObjectProperty extends OWLProperty {
  type: 'objectProperty';
  isInverseFunctional?: boolean;
  isReflexive?: boolean;
  isIrreflexive?: boolean;
  isAsymmetric?: boolean;
  inverseOfIri?: string;
  equivalentPropertyIris?: string[];
  disjointPropertyIris?: string[];
  propertyChains?: string[][];
}

export interface OWLDataProperty extends OWLProperty {
  type: 'dataProperty';
}

export interface OWLAnnotationProperty extends OWLProperty {
  type: 'annotationProperty';
}

export interface OWLIndividual extends OWLEntity {
  type: 'individual';
  classIris: string[]; // rdf:type assertions
  objectPropertyAssertions: { propertyIri: string; targetIri: string }[];
  dataPropertyAssertions: { propertyIri: string; value: string; datatype?: string }[];
}

export type OWLEntityUnion =
  | OWLClass
  | OWLObjectProperty
  | OWLDataProperty
  | OWLAnnotationProperty
  | OWLIndividual;

export interface OntologyMetadata {
  iri?: string;
  versionIri?: string;
  imports: string[];
  annotations: Record<string, string[]>;
}

/** Char/line range of an entity's cluster in the source file (functional syntax only). */
export interface EntitySegment {
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  /** Exact absolute line indices of every axiom line for this entity (sorted ascending).
   *  Used when entity's axioms are scattered (e.g. SNOMED groups by axiom type, not entity)
   *  so sync iterates only the entity's lines instead of a wide chunk. */
  lineIndices?: Int32Array;
  /** Parallel to lineIndices: char offset (in rawContent) of each line's start. */
  lineCharStarts?: Int32Array;
}

export interface OntologyModel {
  metadata: OntologyMetadata;
  classes: Map<string, OWLClass>;
  objectProperties: Map<string, OWLObjectProperty>;
  dataProperties: Map<string, OWLDataProperty>;
  annotationProperties: Map<string, OWLAnnotationProperty>;
  individuals: Map<string, OWLIndividual>;
  /** Source file URI this model was parsed from */
  sourceUri: string;
  /** Original raw file content, used to pass the full ontology to the reasoner */
  rawContent: string;
  /** Format string for the Java reasoner: 'functional' | 'rdf-xml' | 'owl-xml' | 'turtle' | 'manchester' */
  sourceFormat: string;
  /** File mtime (ms since epoch) at parse time. Used for reload no-op detection
   *  — if stat matches both this and sourceSize, the file hasn't changed since
   *  this model was built. */
  sourceMtimeMs?: number;
  /** File size in bytes at parse time. Paired with sourceMtimeMs for fingerprinting. */
  sourceSize?: number;
  /** GCI axioms where both the subclass and superclass expressions are complex (no named anchor class) — stored as functional syntax strings */
  standaloneGcis: string[];
  /** Entity cluster segments for O(cluster) sync — functional format only, built after parse. */
  entitySegments?: Map<string, EntitySegment>;
  /** GCI line segments per class — functional format only, built after parse. */
  gciSegments?: Map<string, EntitySegment>;
  /** Line index of Ontology closing ')' — functional format only. */
  closingParenLine?: number;
  /** Line index for GCI/property-chain insertion — functional format only. */
  gciInsertLine?: number;
  /** Inferred class hierarchy populated after reasoning; parent IRI → Set of child IRIs */
  inferredSubClasses: Map<string, Set<string>>;
  /** Whether the ontology has been classified by a reasoner */
  isClassified: boolean;
  /** Whether saved ontology edits have made the current inferred hierarchy stale */
  classificationNeedsUpdate: boolean;
}

function makeAnnProp(iri: string, label: string): OWLAnnotationProperty {
  return { iri, type: 'annotationProperty', labels: { en: [label] }, annotations: {}, superPropertyIris: [], domainIris: [], rangeIris: [] };
}

/** OWL 2 built-in annotation properties that are always available even without explicit Declaration. */
export const BUILTIN_ANNOTATION_PROP_IRIS: readonly string[] = [
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2000/01/rdf-schema#comment',
  'http://www.w3.org/2000/01/rdf-schema#seeAlso',
  'http://www.w3.org/2000/01/rdf-schema#isDefinedBy',
  'http://www.w3.org/2002/07/owl#deprecated',
  'http://www.w3.org/2002/07/owl#versionInfo',
  'http://www.w3.org/2002/07/owl#priorVersion',
  'http://www.w3.org/2002/07/owl#backwardCompatibleWith',
  'http://www.w3.org/2002/07/owl#incompatibleWith',
  'http://www.w3.org/2004/02/skos/core#prefLabel',
  'http://www.w3.org/2004/02/skos/core#altLabel',
  'http://www.w3.org/2004/02/skos/core#definition',
  'http://www.w3.org/2004/02/skos/core#example',
  'http://www.w3.org/2004/02/skos/core#note',
  'http://www.w3.org/2004/02/skos/core#scopeNote',
  'http://www.w3.org/2004/02/skos/core#editorialNote',
  'http://www.w3.org/2004/02/skos/core#historyNote',
  'http://www.w3.org/2004/02/skos/core#changeNote',
];

const BUILTIN_ANNOTATION_PROPS: Map<string, OWLAnnotationProperty> = new Map([
  ['http://www.w3.org/2000/01/rdf-schema#label',             makeAnnProp('http://www.w3.org/2000/01/rdf-schema#label',             'label')],
  ['http://www.w3.org/2000/01/rdf-schema#comment',           makeAnnProp('http://www.w3.org/2000/01/rdf-schema#comment',           'comment')],
  ['http://www.w3.org/2000/01/rdf-schema#seeAlso',           makeAnnProp('http://www.w3.org/2000/01/rdf-schema#seeAlso',           'seeAlso')],
  ['http://www.w3.org/2000/01/rdf-schema#isDefinedBy',       makeAnnProp('http://www.w3.org/2000/01/rdf-schema#isDefinedBy',       'isDefinedBy')],
  ['http://www.w3.org/2002/07/owl#deprecated',               makeAnnProp('http://www.w3.org/2002/07/owl#deprecated',               'deprecated')],
  ['http://www.w3.org/2002/07/owl#versionInfo',              makeAnnProp('http://www.w3.org/2002/07/owl#versionInfo',              'versionInfo')],
  ['http://www.w3.org/2002/07/owl#priorVersion',             makeAnnProp('http://www.w3.org/2002/07/owl#priorVersion',             'priorVersion')],
  ['http://www.w3.org/2002/07/owl#backwardCompatibleWith',   makeAnnProp('http://www.w3.org/2002/07/owl#backwardCompatibleWith',   'backwardCompatibleWith')],
  ['http://www.w3.org/2002/07/owl#incompatibleWith',         makeAnnProp('http://www.w3.org/2002/07/owl#incompatibleWith',         'incompatibleWith')],
  ['http://www.w3.org/2004/02/skos/core#prefLabel',          makeAnnProp('http://www.w3.org/2004/02/skos/core#prefLabel',          'prefLabel')],
  ['http://www.w3.org/2004/02/skos/core#altLabel',           makeAnnProp('http://www.w3.org/2004/02/skos/core#altLabel',           'altLabel')],
  ['http://www.w3.org/2004/02/skos/core#definition',         makeAnnProp('http://www.w3.org/2004/02/skos/core#definition',         'definition')],
  ['http://www.w3.org/2004/02/skos/core#example',            makeAnnProp('http://www.w3.org/2004/02/skos/core#example',            'example')],
  ['http://www.w3.org/2004/02/skos/core#note',               makeAnnProp('http://www.w3.org/2004/02/skos/core#note',               'note')],
  ['http://www.w3.org/2004/02/skos/core#scopeNote',          makeAnnProp('http://www.w3.org/2004/02/skos/core#scopeNote',          'scopeNote')],
  ['http://www.w3.org/2004/02/skos/core#editorialNote',      makeAnnProp('http://www.w3.org/2004/02/skos/core#editorialNote',      'editorialNote')],
  ['http://www.w3.org/2004/02/skos/core#historyNote',        makeAnnProp('http://www.w3.org/2004/02/skos/core#historyNote',        'historyNote')],
  ['http://www.w3.org/2004/02/skos/core#changeNote',         makeAnnProp('http://www.w3.org/2004/02/skos/core#changeNote',         'changeNote')],
]);

export function createEmptyModel(sourceUri: string): OntologyModel {
  return {
    metadata: { imports: [], annotations: {} },
    classes: new Map(),
    objectProperties: new Map(),
    dataProperties: new Map(),
    annotationProperties: new Map(BUILTIN_ANNOTATION_PROPS),
    individuals: new Map(),
    sourceUri,
    rawContent: '',
    sourceFormat: 'functional',
    standaloneGcis: [],
    inferredSubClasses: new Map(),
    isClassified: false,
    classificationNeedsUpdate: false,
  };
}

const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const SKOS_ALT_LABEL  = 'http://www.w3.org/2004/02/skos/core#altLabel';

function pickSkosLabel(values: string[], preferredLang: string): string | undefined {
  // Prefer a value whose language tag matches preferredLang, then 'en', then any
  let fallback: string | undefined;
  for (const raw of values) {
    const { text, lang } = parseStoredAnnotationValue(raw);
    if (lang === preferredLang) { return text; }
    if (lang === 'en' || lang === '') { fallback ??= text; }
    fallback ??= text;
  }
  return fallback;
}

function parseStoredAnnotationValue(raw: string): { text: string; lang: string } {
  const quoted = /^"((?:\\.|[^"\\])*)"@([A-Za-z][A-Za-z0-9-]*)$/.exec(raw);
  if (quoted) {
    return {
      text: quoted[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\'),
      lang: quoted[2],
    };
  }
  const at = raw.lastIndexOf('@');
  const hasLang = at > 0 && /^[A-Za-z][A-Za-z0-9-]*$/.test(raw.slice(at + 1));
  return {
    text: hasLang ? raw.slice(0, at) : raw,
    lang: hasLang ? raw.slice(at + 1) : '',
  };
}

export function getLabel(entity: OWLEntity, preferredLang = 'en'): string {
  const labels = entity.labels[preferredLang]
    ?? entity.labels['en']
    ?? entity.labels['']
    ?? Object.values(entity.labels)[0];
  if (labels?.length) {
    return labels[0];
  }
  // Fall back to SKOS prefLabel, then altLabel
  for (const annotIri of [SKOS_PREF_LABEL, SKOS_ALT_LABEL]) {
    const values = entity.annotations[annotIri];
    if (values?.length) {
      const picked = pickSkosLabel(values, preferredLang);
      if (picked) { return picked; }
    }
  }
  // Last resort: local name from IRI
  const hash = entity.iri.lastIndexOf('#');
  const slash = entity.iri.lastIndexOf('/');
  const pos = Math.max(hash, slash);
  return pos >= 0 ? entity.iri.slice(pos + 1) : entity.iri;
}
