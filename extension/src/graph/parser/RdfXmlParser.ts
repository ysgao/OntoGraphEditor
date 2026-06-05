import { XMLParser } from 'fast-xml-parser';
import {
  createEmptyModel, OntologyModel,
  OWLClass, OWLObjectProperty, OWLDataProperty, OWLAnnotationProperty, OWLIndividual,
  BUILTIN_ANNOTATION_PROP_IRIS,
} from '../model/OntologyModel';

const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDFS_LABEL = `${RDFS}label`;
const RDF_TYPE = `${RDF}type`;
const OWL_CLASS = `${OWL}Class`;
const OWL_ONTOLOGY = `${OWL}Ontology`;
const OWL_NAMED_IND = `${OWL}NamedIndividual`;

const PROP_CHARACTERISTICS = new Set([
  `${OWL}TransitiveProperty`, `${OWL}FunctionalProperty`, `${OWL}InverseFunctionalProperty`,
  `${OWL}SymmetricProperty`, `${OWL}AsymmetricProperty`, `${OWL}ReflexiveProperty`,
  `${OWL}IrreflexiveProperty`,
]);

type Index = Map<string, Map<string, string[]>>;
type Sidecar = Map<string, { superExprs: string[]; equivExprs: string[] }>;

type ObjectValue =
  | { kind: 'named'; iri: string }
  | { kind: 'literal'; value: string; lang: string }
  | { kind: 'blank'; node: Record<string, unknown> };

const isNamed = (iri: string) => iri.startsWith('http') || iri.startsWith('urn') || iri.startsWith('file');

function getAll(idx: Index, s: string, p: string): string[] { return idx.get(s)?.get(p) ?? []; }
function namedVals(idx: Index, s: string, p: string): string[] { return getAll(idx, s, p).filter(isNamed); }
function flag(types: Set<string>, t: string): boolean | undefined { return types.has(t) || undefined; }

function addTriple(idx: Index, s: string, p: string, o: string): void {
  let preds = idx.get(s);
  if (!preds) { preds = new Map(); idx.set(s, preds); }
  let objs = preds.get(p);
  if (!objs) { objs = []; preds.set(p, objs); }
  objs.push(o);
}

function labelAnnotations(
  idx: Index, iri: string, annProps: Set<string>,
): { labels: Record<string, string[]>; annotations: Record<string, string[]> } {
  const labels: Record<string, string[]> = {};
  const annotations: Record<string, string[]> = {};
  for (const [pred, vals] of (idx.get(iri) ?? new Map())) {
    for (const v of vals) {
      const sep = v.indexOf('\x00');
      const raw = sep >= 0 ? v.slice(0, sep) : v;
      const lang = sep >= 0 ? v.slice(sep + 1) : '';
      if (pred === RDFS_LABEL) {
        (labels[lang] ??= []).push(raw);
      } else if (annProps.has(pred)) {
        (annotations[pred] ??= []).push(lang ? `${raw}@${lang}` : raw);
      }
    }
  }
  return { labels, annotations };
}

export class RdfXmlParser {
  private namespaces: Map<string, string> = new Map([
    ['rdf:', RDF],
    ['rdfs:', RDFS],
    ['owl:', OWL],
    ['xsd:', 'http://www.w3.org/2001/XMLSchema#'],
    ['xml:', 'http://www.w3.org/XML/1998/namespace'],
  ]);
  private defaultNs = '';
  private base = '';

  constructor(private readonly text: string, private readonly uri: string) {}

  parse(): OntologyModel {
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (_name, _jpath, _isLeafNode, isAttribute) => !isAttribute,
      textNodeName: '#text',
      parseAttributeValue: false,
    });

    let doc: Record<string, unknown>;
    try {
      doc = xmlParser.parse(this.text) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`RDF/XML parse error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const rootArr = doc['rdf:RDF'] as unknown[] | undefined;
    if (!rootArr?.[0]) {
      throw new Error('No <rdf:RDF> root element found — not valid RDF/XML');
    }
    const root = rootArr[0] as Record<string, unknown>;

    this.buildNamespaces(root);

    // When xml:base is absent, derive the base in priority order:
    // 1. xmlns="http://…onto#" → strip trailing # → "http://…onto"
    // 2. owl:Ontology/@_rdf:about (ontology IRI declared in file)
    // 3. document URI as last resort
    if (!this.base && this.defaultNs) {
      this.base = this.defaultNs.endsWith('#')
        ? this.defaultNs.slice(0, -1)
        : this.defaultNs;
    }
    if (!this.base) {
      const ontoArr = root['owl:Ontology'] as unknown[] | undefined;
      if (ontoArr?.[0]) {
        const about = (ontoArr[0] as Record<string, unknown>)['@_rdf:about'];
        if (about) this.base = String(about);
      }
    }
    if (!this.base) this.base = this.uri;

    const idx: Index = new Map();
    const sidecar: Sidecar = new Map();

    // First pass: collect annotation property IRIs so they're available when processing annotations
    const annProps = new Set<string>(BUILTIN_ANNOTATION_PROP_IRIS);
    for (const [tag, elements] of Object.entries(root)) {
      if (tag.startsWith('@')) continue;
      if (this.expandElementName(tag) === `${OWL}AnnotationProperty`) {
        for (const rawEl of elements as unknown[]) {
          const subj = this.subjectIri(rawEl as Record<string, unknown>);
          if (subj) annProps.add(subj);
        }
      }
    }

    // Second pass: build full triple index from all typed-node elements
    for (const [tag, elements] of Object.entries(root)) {
      if (tag.startsWith('@')) continue;
      const impliedType = this.expandElementName(tag);
      if (!impliedType) continue;

      for (const rawEl of elements as unknown[]) {
        const nodeEl = rawEl as Record<string, unknown>;
        const subj = this.subjectIri(nodeEl);
        if (!subj) continue;

        addTriple(idx, subj, RDF_TYPE, impliedType);

        for (const [propTag, propVals] of Object.entries(nodeEl)) {
          if (propTag.startsWith('@') || propTag === '#text') continue;
          const pred = this.expandElementName(propTag);
          if (!pred) continue;

          for (const propRaw of propVals as unknown[]) {
            const ov = this.objectValue(propRaw);
            if (ov.kind === 'named') {
              if (ov.iri) addTriple(idx, subj, pred, ov.iri);
            } else if (ov.kind === 'literal') {
              addTriple(idx, subj, pred, `${ov.value}\x00${ov.lang}`);
            } else {
              this.handleBlankNode(idx, sidecar, subj, pred, ov.node);
            }
          }
        }
      }
    }

    const model = createEmptyModel(this.uri);
    this.classify(idx, sidecar, annProps, model);
    return model;
  }

  private buildNamespaces(root: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(root)) {
      if (!key.startsWith('@_')) continue;
      const attr = key.slice(2);
      if (attr.startsWith('xmlns:')) {
        this.namespaces.set(attr.slice(6) + ':', String(value));
      } else if (attr === 'xmlns') {
        this.defaultNs = String(value);
      } else if (attr === 'xml:base') {
        this.base = String(value);
      }
    }
  }

  private expandElementName(tag: string): string | null {
    const colon = tag.indexOf(':');
    if (colon > 0) {
      const ns = this.namespaces.get(tag.slice(0, colon + 1));
      return ns ? ns + tag.slice(colon + 1) : null;
    }
    return this.defaultNs ? this.defaultNs + tag : null;
  }

  private expandIri(raw: string): string {
    if (!raw) return '';
    if (raw.startsWith('http') || raw.startsWith('urn') || raw.startsWith('file')) return raw;
    if (raw.startsWith('#')) return this.base + raw;
    const colon = raw.indexOf(':');
    if (colon > 0) {
      const ns = this.namespaces.get(raw.slice(0, colon + 1));
      if (ns) return ns + raw.slice(colon + 1);
    }
    return this.base ? `${this.base}#${raw}` : raw;
  }

  private subjectIri(node: Record<string, unknown>): string | null {
    const about = node['@_rdf:about'];
    if (about !== undefined) return this.expandIri(String(about));
    const id = node['@_rdf:ID'];
    if (id !== undefined) return `${this.base}#${String(id)}`;
    return null;
  }

  private objectValue(el: unknown): ObjectValue {
    if (typeof el !== 'object' || el === null) {
      return { kind: 'literal', value: String(el ?? ''), lang: '' };
    }
    const node = el as Record<string, unknown>;
    const resource = node['@_rdf:resource'];
    if (resource !== undefined) {
      return { kind: 'named', iri: this.expandIri(String(resource)) };
    }
    const text = node['#text'];
    if (text !== undefined) {
      const raw = Array.isArray(text) ? (text[0] ?? '') : text;
      const lang = node['@_xml:lang'];
      return { kind: 'literal', value: String(raw), lang: lang !== undefined ? String(lang) : '' };
    }
    return { kind: 'blank', node };
  }

  private handleBlankNode(
    idx: Index, sidecar: Sidecar,
    subj: string, pred: string, node: Record<string, unknown>,
  ): void {
    const RDFS_SUB = `${RDFS}subClassOf`;
    const OWL_EQ = `${OWL}equivalentClass`;
    if (pred === RDFS_SUB || pred === OWL_EQ) {
      const expr = this.buildClassExpression(node);
      if (expr) {
        let entry = sidecar.get(subj);
        if (!entry) { entry = { superExprs: [], equivExprs: [] }; sidecar.set(subj, entry); }
        (pred === RDFS_SUB ? entry.superExprs : entry.equivExprs).push(expr);
      }
    }
  }

  private buildClassExpression(node: Record<string, unknown>): string | null {
    const restrictionArr = node['owl:Restriction'] as unknown[] | undefined;
    if (restrictionArr?.[0]) {
      return this.buildRestriction(restrictionArr[0] as Record<string, unknown>);
    }
    const classArr = node['owl:Class'] as unknown[] | undefined;
    if (classArr?.[0]) {
      return this.buildBooleanClass(classArr[0] as Record<string, unknown>);
    }
    return null;
  }

  private buildRestriction(r: Record<string, unknown>): string | null {
    const propArr = r['owl:onProperty'] as unknown[] | undefined;
    const propEl = propArr?.[0] as Record<string, unknown> | undefined;
    const propIri = propEl ? this.expandIri(String(propEl['@_rdf:resource'] ?? '')) : '';
    if (!propIri) return null;

    const svArr = r['owl:someValuesFrom'] as unknown[] | undefined;
    if (svArr?.[0]) {
      const filler = this.resolveFillerNode(svArr[0]);
      return filler ? `${propIri} some ${filler}` : null;
    }
    const avArr = r['owl:allValuesFrom'] as unknown[] | undefined;
    if (avArr?.[0]) {
      const filler = this.resolveFillerNode(avArr[0]);
      return filler ? `${propIri} only ${filler}` : null;
    }
    const hvArr = r['owl:hasValue'] as unknown[] | undefined;
    if (hvArr?.[0]) {
      const ov = this.objectValue(hvArr[0]);
      if (ov.kind === 'named') return `${propIri} value ${ov.iri}`;
      if (ov.kind === 'literal') return `${propIri} value "${ov.value}"`;
      return null;
    }
    for (const [cardProp, label] of [
      ['owl:minCardinality', 'min'], ['owl:minQualifiedCardinality', 'min'],
      ['owl:maxCardinality', 'max'], ['owl:maxQualifiedCardinality', 'max'],
      ['owl:cardinality', 'exactly'], ['owl:qualifiedCardinality', 'exactly'],
    ] as [string, string][]) {
      const arr = r[cardProp] as unknown[] | undefined;
      if (arr?.[0]) {
        const el = arr[0] as Record<string, unknown>;
        const val = el['#text'] !== undefined
          ? (Array.isArray(el['#text']) ? el['#text'][0] : el['#text'])
          : arr[0];
        return `${propIri} ${label} ${String(val)}`;
      }
    }
    return null;
  }

  private buildBooleanClass(c: Record<string, unknown>): string | null {
    const intersect = c['owl:intersectionOf'] as unknown[] | undefined;
    if (intersect?.[0]) {
      const members = this.extractCollectionMembers(intersect[0] as Record<string, unknown>);
      return members.length ? members.join(' and ') : null;
    }
    const union = c['owl:unionOf'] as unknown[] | undefined;
    if (union?.[0]) {
      const members = this.extractCollectionMembers(union[0] as Record<string, unknown>);
      return members.length ? members.join(' or ') : null;
    }
    const complement = c['owl:complementOf'] as unknown[] | undefined;
    if (complement?.[0]) {
      const inner = this.resolveFillerNode(complement[0]);
      return inner ? `not (${inner})` : null;
    }
    const oneOf = c['owl:oneOf'] as unknown[] | undefined;
    if (oneOf?.[0]) {
      const members = this.extractCollectionMembers(oneOf[0] as Record<string, unknown>);
      return members.length ? `{${members.join(', ')}}` : null;
    }
    return null;
  }

  private resolveFillerNode(el: unknown): string | null {
    if (!el || typeof el !== 'object') return null;
    const node = el as Record<string, unknown>;
    const res = node['@_rdf:resource'];
    if (res !== undefined) return this.expandIri(String(res));
    return this.buildClassExpression(node);
  }

  private extractCollectionMembers(collNode: Record<string, unknown>): string[] {
    const members: string[] = [];
    const descs = collNode['rdf:Description'] as unknown[] | undefined;
    if (descs) {
      for (const d of descs) {
        const desc = d as Record<string, unknown>;
        const about = desc['@_rdf:about'];
        if (about !== undefined) {
          const iri = this.expandIri(String(about));
          if (iri) members.push(iri);
        } else {
          // Nested blank node member (e.g. restriction inside a union)
          const expr = this.buildClassExpression(desc);
          if (expr) members.push(`(${expr})`);
        }
      }
    }
    const classes = collNode['owl:Class'] as unknown[] | undefined;
    if (classes) {
      for (const c of classes) {
        const expr = this.buildClassExpression({ 'owl:Class': [c] });
        if (expr) members.push(`(${expr})`);
      }
    }
    return members;
  }

  private classify(idx: Index, sidecar: Sidecar, annProps: Set<string>, model: OntologyModel): void {
    for (const [iri, preds] of idx) {
      if (!isNamed(iri)) continue;
      const types = new Set(preds.get(RDF_TYPE) ?? []);

      if (types.has(OWL_ONTOLOGY)) {
        model.metadata.iri = iri;
        const vi = preds.get(`${OWL}versionIRI`);
        if (vi?.[0]) model.metadata.versionIri = vi[0];
        model.metadata.imports.push(...(preds.get(`${OWL}imports`) ?? []));
        for (const ap of annProps) {
          for (const v of (preds.get(ap) ?? [])) {
            const s = v.indexOf('\x00');
            const raw = s >= 0 ? v.slice(0, s) : v;
            const lang = s >= 0 ? v.slice(s + 1) : '';
            (model.metadata.annotations[ap] ??= []).push(lang ? `${raw}@${lang}` : raw);
          }
        }
        continue;
      }

      const isClass   = types.has(OWL_CLASS) || types.has(`${RDFS}Class`);
      const isObjProp = types.has(`${OWL}ObjectProperty`) || [...types].some(t => PROP_CHARACTERISTICS.has(t));
      const isDataProp = types.has(`${OWL}DatatypeProperty`);
      const isAnnProp  = types.has(`${OWL}AnnotationProperty`);
      const isInd      = types.has(OWL_NAMED_IND);
      if (!isClass && !isObjProp && !isDataProp && !isAnnProp && !isInd) continue;

      const { labels, annotations } = labelAnnotations(idx, iri, annProps);
      const base = { iri, labels, annotations };

      if (isClass) {
        const sc = sidecar.get(iri);
        model.classes.set(iri, {
          ...base, type: 'class',
          superClassIris: namedVals(idx, iri, `${RDFS}subClassOf`),
          equivalentClassIris: namedVals(idx, iri, `${OWL}equivalentClass`),
          disjointClassIris: namedVals(idx, iri, `${OWL}disjointWith`),
          superClassExpressions: sc?.superExprs ?? [],
          equivalentClassExpressions: sc?.equivExprs ?? [],
          gciExpressions: [],
        } satisfies OWLClass);
      } else if (isObjProp) {
        model.objectProperties.set(iri, {
          ...base, type: 'objectProperty',
          superPropertyIris: namedVals(idx, iri, `${RDFS}subPropertyOf`),
          domainIris: namedVals(idx, iri, `${RDFS}domain`),
          rangeIris: namedVals(idx, iri, `${RDFS}range`),
          inverseOfIri: namedVals(idx, iri, `${OWL}inverseOf`)[0],
          isTransitive: flag(types, `${OWL}TransitiveProperty`),
          isSymmetric: flag(types, `${OWL}SymmetricProperty`),
          isFunctional: flag(types, `${OWL}FunctionalProperty`),
          isInverseFunctional: flag(types, `${OWL}InverseFunctionalProperty`),
        } satisfies OWLObjectProperty);
      } else if (isDataProp) {
        model.dataProperties.set(iri, {
          ...base, type: 'dataProperty',
          superPropertyIris: namedVals(idx, iri, `${RDFS}subPropertyOf`),
          domainIris: namedVals(idx, iri, `${RDFS}domain`),
          rangeIris: namedVals(idx, iri, `${RDFS}range`),
          isFunctional: flag(types, `${OWL}FunctionalProperty`),
        } satisfies OWLDataProperty);
      } else if (isAnnProp) {
        model.annotationProperties.set(iri, {
          ...base, type: 'annotationProperty',
          superPropertyIris: namedVals(idx, iri, `${RDFS}subPropertyOf`),
          domainIris: namedVals(idx, iri, `${RDFS}domain`),
          rangeIris: namedVals(idx, iri, `${RDFS}range`),
        } satisfies OWLAnnotationProperty);
      } else if (isInd) {
        const classIris = [...types].filter(t => t !== OWL_NAMED_IND && isNamed(t));
        const objA: OWLIndividual['objectPropertyAssertions'] = [];
        const dataA: OWLIndividual['dataPropertyAssertions'] = [];
        for (const [pred, vals] of preds) {
          if (pred === RDF_TYPE || pred === RDFS_LABEL) continue;
          if (model.objectProperties.has(pred)) {
            vals.filter(isNamed).forEach(v => objA.push({ propertyIri: pred, targetIri: v }));
          } else if (model.dataProperties.has(pred)) {
            vals.forEach(v => {
              const s = v.indexOf('\x00');
              dataA.push({ propertyIri: pred, value: s >= 0 ? v.slice(0, s) : v });
            });
          }
        }
        model.individuals.set(iri, {
          ...base, type: 'individual', classIris,
          objectPropertyAssertions: objA, dataPropertyAssertions: dataA,
        } satisfies OWLIndividual);
      }
    }
  }
}
