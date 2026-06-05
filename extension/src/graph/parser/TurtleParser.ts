import { Parser as N3Parser } from 'n3';
import {
  createEmptyModel,
  OntologyModel,
  OWLClass,
  OWLObjectProperty,
  OWLDataProperty,
  OWLAnnotationProperty,
  OWLIndividual,
  BUILTIN_ANNOTATION_PROP_IRIS,
} from '../model/OntologyModel';

const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const RDFS_LABEL = `${RDFS}label`;

const RDF_TYPE       = `${RDF}type`;
const OWL_CLASS      = `${OWL}Class`;
const OWL_ONTOLOGY   = `${OWL}Ontology`;
const OWL_NAMED_IND  = `${OWL}NamedIndividual`;

const PROP_CHARACTERISTICS = new Set([
  `${OWL}TransitiveProperty`, `${OWL}FunctionalProperty`, `${OWL}InverseFunctionalProperty`,
  `${OWL}SymmetricProperty`,  `${OWL}AsymmetricProperty`, `${OWL}ReflexiveProperty`,
  `${OWL}IrreflexiveProperty`,
]);

type Index = Map<string, Map<string, string[]>>;

const isNamed = (iri: string) => iri.startsWith('http') || iri.startsWith('urn') || iri.startsWith('file');

function getAll(idx: Index, s: string, p: string): string[] { return idx.get(s)?.get(p) ?? []; }

function namedVals(idx: Index, s: string, p: string): string[] { return getAll(idx, s, p).filter(isNamed); }

function flag(types: Set<string>, t: string): boolean | undefined { return types.has(t) || undefined; }

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

function readRdfList(idx: Index, head: string): string[] {
  const RDF_FIRST = `${RDF}first`;
  const RDF_REST  = `${RDF}rest`;
  const RDF_NIL   = `${RDF}nil`;
  const items: string[] = [];
  let cur = head;
  const seen = new Set<string>();
  while (cur && cur !== RDF_NIL && !seen.has(cur)) {
    seen.add(cur);
    const first = getAll(idx, cur, RDF_FIRST)[0];
    if (first && isNamed(first)) items.push(first);
    cur = getAll(idx, cur, RDF_REST)[0] ?? '';
  }
  return items;
}

export class TurtleParser {
  constructor(private readonly text: string, private readonly uri: string) {}

  parse(): OntologyModel {
    const model = createEmptyModel(this.uri);

    let quads;
    try {
      quads = new N3Parser().parse(this.text);
    } catch (e) {
      throw new Error(`Turtle parse error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const idx: Index = new Map();
    for (const { subject: s, predicate: p, object: o } of quads) {
      const sIri = s.value;
      const oVal = o.termType === 'Literal'
        ? `${o.value}\x00${(o as { language: string }).language ?? ''}`
        : o.value;
      ((idx.get(sIri) ?? idx.set(sIri, new Map()).get(sIri))!
        .get(p.value) ?? (idx.get(sIri)!.set(p.value, []).get(p.value))!
      ).push(oVal);
    }

    // Collect annotation property IRIs — seed with built-ins (rdfs:label, skos:*, etc.) so their
    // values are collected even when the ontology omits explicit owl:AnnotationProperty declarations
    const annProps = new Set<string>(BUILTIN_ANNOTATION_PROP_IRIS);
    for (const [iri, preds] of idx) {
      if (isNamed(iri) && (preds.get(RDF_TYPE) ?? []).includes(`${OWL}AnnotationProperty`)) {
        annProps.add(iri);
      }
    }

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
        model.classes.set(iri, {
          ...base, type: 'class',
          superClassIris: namedVals(idx, iri, `${RDFS}subClassOf`),
          equivalentClassIris: namedVals(idx, iri, `${OWL}equivalentClass`),
          disjointClassIris: namedVals(idx, iri, `${OWL}disjointWith`),
          superClassExpressions: [], equivalentClassExpressions: [], gciExpressions: [],
        } satisfies OWLClass);
      } else if (isObjProp) {
        const chainHeads = getAll(idx, iri, `${OWL}propertyChainAxiom`).filter(v => !isNamed(v));
        model.objectProperties.set(iri, {
          ...base, type: 'objectProperty',
          superPropertyIris: namedVals(idx, iri, `${RDFS}subPropertyOf`),
          domainIris: namedVals(idx, iri, `${RDFS}domain`),
          rangeIris: namedVals(idx, iri, `${RDFS}range`),
          inverseOfIri: namedVals(idx, iri, `${OWL}inverseOf`)[0],
          equivalentPropertyIris: namedVals(idx, iri, `${OWL}equivalentProperty`),
          disjointPropertyIris: namedVals(idx, iri, `${OWL}propertyDisjointWith`),
          propertyChains: chainHeads.map(h => readRdfList(idx, h)),
          isTransitive: flag(types, `${OWL}TransitiveProperty`),
          isSymmetric: flag(types, `${OWL}SymmetricProperty`),
          isFunctional: flag(types, `${OWL}FunctionalProperty`),
          isInverseFunctional: flag(types, `${OWL}InverseFunctionalProperty`),
          isReflexive: flag(types, `${OWL}ReflexiveProperty`),
          isIrreflexive: flag(types, `${OWL}IrreflexiveProperty`),
          isAsymmetric: flag(types, `${OWL}AsymmetricProperty`),
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
            vals.forEach(v => { const s = v.indexOf('\x00'); dataA.push({ propertyIri: pred, value: s >= 0 ? v.slice(0, s) : v }); });
          }
        }
        model.individuals.set(iri, { ...base, type: 'individual', classIris, objectPropertyAssertions: objA, dataPropertyAssertions: dataA } satisfies OWLIndividual);
      }
    }

    return model;
  }
}
