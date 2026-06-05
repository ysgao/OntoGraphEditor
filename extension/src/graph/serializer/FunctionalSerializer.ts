import { OWLEntity, OntologyModel, getLabel, OWLClass, OWLObjectProperty, OWLDataProperty, OWLIndividual } from '../model/OntologyModel';
import { manchesterToFunctional } from '../utils/ExpressionUtils';

const OWL = 'http://www.w3.org/2002/07/owl#';
const OWL_THING = `${OWL}Thing`;
const OWL_NOTHING = `${OWL}Nothing`;
const RDFS_PREFIX = 'http://www.w3.org/2000/01/rdf-schema#';
const RDFS_ANN_TO_TOKEN = new Map<string, string>([
  [`${RDFS_PREFIX}label`,       'rdfs:label'],
  [`${RDFS_PREFIX}comment`,     'rdfs:comment'],
  [`${RDFS_PREFIX}seeAlso`,     'rdfs:seeAlso'],
  [`${RDFS_PREFIX}isDefinedBy`, 'rdfs:isDefinedBy'],
]);

function iri(s: string): string {
  const token = RDFS_ANN_TO_TOKEN.get(s);
  if (token !== undefined) { return token; }
  return `<${s}>`;
}

function literal(value: string, lang?: string, datatype?: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (lang) { return `"${escaped}"@${lang}`; }
  if (datatype) { return `"${escaped}"^^<${datatype}>`; }
  return `"${escaped}"`;
}

/**
 * Generate a cluster of annotations and logical axioms for an entity.
 * Following Protege-style arrangement.
 */
export function generateEntityCluster(entity: OWLEntity, model: OntologyModel): string[] {
  const out: string[] = [];
  const label = getLabel(entity);
  const typeLabel = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
  out.push(`# ${typeLabel}: ${iri(entity.iri)} (${label})`);

  // Annotations (Labels first)
  for (const [lang, values] of Object.entries(entity.labels)) {
    for (const val of values) {
      out.push(`AnnotationAssertion(${iri(`${RDFS_PREFIX}label`)} ${iri(entity.iri)} ${literal(val, lang || undefined)})`);
    }
  }

  // Other annotations
  for (const [propIri, values] of Object.entries(entity.annotations)) {
    for (const val of values) {
      const atIdx = val.lastIndexOf('@');
      const haslang = atIdx > 0 && /^[A-Za-z][A-Za-z0-9\-]*$/.test(val.slice(atIdx + 1));
      const text = haslang ? val.slice(0, atIdx) : val;
      const lang = haslang ? val.slice(atIdx + 1) : undefined;
      out.push(`AnnotationAssertion(${iri(propIri)} ${iri(entity.iri)} ${literal(text, lang)})`);
    }
  }

  const axioms: string[] = [];
  if (entity.type === 'class') {
    const cls = entity as OWLClass;
    if (cls.equivalentClassIris.length > 0) {
      axioms.push(`EquivalentClasses(${[cls.iri, ...cls.equivalentClassIris].map(iri).join(' ')})`);
    }
    for (const sup of cls.superClassIris) {
      if (sup === OWL_THING) { continue; }
      axioms.push(`SubClassOf(${iri(cls.iri)} ${iri(sup)})`);
    }
    for (const dis of cls.disjointClassIris) {
      if (cls.iri < dis) {
        axioms.push(`DisjointClasses(${iri(cls.iri)} ${iri(dis)})`);
      }
    }
  } else if (entity.type === 'objectProperty') {
    const p = entity as OWLObjectProperty;
    if (p.inverseOfIri) {
      axioms.push(`InverseObjectProperties(${iri(p.iri)} ${iri(p.inverseOfIri)})`);
    }
    for (const sup of p.superPropertyIris) {
      axioms.push(`SubObjectPropertyOf(${iri(p.iri)} ${iri(sup)})`);
    }
    for (const d of p.domainIris) {
      axioms.push(`ObjectPropertyDomain(${iri(p.iri)} ${iri(d)})`);
    }
    for (const r of p.rangeIris) {
      axioms.push(`ObjectPropertyRange(${iri(p.iri)} ${iri(r)})`);
    }
    if (p.isTransitive)          { axioms.push(`TransitiveObjectProperty(${iri(p.iri)})`); }
    if (p.isSymmetric)           { axioms.push(`SymmetricObjectProperty(${iri(p.iri)})`); }
    if (p.isFunctional)          { axioms.push(`FunctionalObjectProperty(${iri(p.iri)})`); }
    if (p.isInverseFunctional)   { axioms.push(`InverseFunctionalObjectProperty(${iri(p.iri)})`); }
  } else if (entity.type === 'dataProperty') {
    const p = entity as OWLDataProperty;
    for (const sup of p.superPropertyIris) {
      axioms.push(`SubDataPropertyOf(${iri(p.iri)} ${iri(sup)})`);
    }
    for (const d of p.domainIris) {
      axioms.push(`DataPropertyDomain(${iri(p.iri)} ${iri(d)})`);
    }
    for (const r of p.rangeIris) {
      axioms.push(`DataPropertyRange(${iri(p.iri)} ${iri(r)})`);
    }
    if (p.isFunctional) { axioms.push(`FunctionalDataProperty(${iri(p.iri)})`); }
  } else if (entity.type === 'individual') {
    const ind = entity as OWLIndividual;
    for (const cls of ind.classIris) {
      axioms.push(`ClassAssertion(${iri(cls)} ${iri(ind.iri)})`);
    }
    for (const a of ind.objectPropertyAssertions) {
      axioms.push(`ObjectPropertyAssertion(${iri(a.propertyIri)} ${iri(ind.iri)} ${iri(a.targetIri)})`);
    }
    for (const a of ind.dataPropertyAssertions) {
      axioms.push(`DataPropertyAssertion(${iri(a.propertyIri)} ${iri(ind.iri)} ${literal(a.value, undefined, a.datatype)})`);
    }
  }

  if (axioms.length > 0) {
    out.push('');
    out.push(...axioms);
  }

  return out;
}

/**
 * Serialize an OntologyModel to OWL Functional Syntax (.ofn).
 * Complex class expressions stored as Manchester strings are omitted — the
 * asserted named-class hierarchy is sufficient for reasoner classification.
 */
export function serializeToFunctional(model: OntologyModel): string {
  const out: string[] = [];

  // 1. Prefixes
  const ontIri = model.metadata.iri ?? 'http://example.org/ontology';
  out.push(`Prefix(:=<${ontIri}#>)`);
  out.push(`Prefix(owl:=<${OWL}>)`);
  out.push(`Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)`);
  out.push(`Prefix(rdf:=<http://www.w3.org/1999/02/22-rdf-syntax-ns#>)`);
  out.push(`Prefix(xsd:=<http://www.w3.org/2001/XMLSchema#>)`);
  out.push('');

  // 2. Ontology header
  const header = model.metadata.versionIri
    ? `${iri(ontIri)}\n  ${iri(model.metadata.versionIri)}`
    : iri(ontIri);
  out.push(`Ontology(${header}`);

  // 3. Imports
  for (const imp of model.metadata.imports) {
    out.push(`  Import(${iri(imp)})`);
  }
  if (model.metadata.imports.length > 0) {
    out.push('');
  }

  // 4. Declarations
  const declarations: string[] = [];
  for (const cls of model.classes.values()) {
    declarations.push(`  Declaration(Class(${iri(cls.iri)}))`);
  }
  for (const p of model.objectProperties.values()) {
    declarations.push(`  Declaration(ObjectProperty(${iri(p.iri)}))`);
  }
  for (const p of model.dataProperties.values()) {
    declarations.push(`  Declaration(DataProperty(${iri(p.iri)}))`);
  }
  for (const p of model.annotationProperties.values()) {
    declarations.push(`  Declaration(AnnotationProperty(${iri(p.iri)}))`);
  }
  for (const ind of model.individuals.values()) {
    declarations.push(`  Declaration(NamedIndividual(${iri(ind.iri)}))`);
  }
  
  if (declarations.length > 0) {
    out.push(...declarations);
    out.push('');
  }

  // 5. Object Property Clusters
  for (const p of model.objectProperties.values()) {
    out.push(...generateEntityCluster(p, model).map(line => '  ' + line));
    out.push('');
  }

  // 6. Data Property Clusters
  for (const p of model.dataProperties.values()) {
    out.push(...generateEntityCluster(p, model).map(line => '  ' + line));
    out.push('');
  }

  // 7. Annotation Property Clusters
  for (const p of model.annotationProperties.values()) {
    const cluster = generateEntityCluster(p, model);
    if (cluster.length > 1) {
      out.push(...cluster.map(line => '  ' + line));
      out.push('');
    }
  }

  // 8. Class Clusters
  for (const cls of model.classes.values()) {
    out.push(...generateEntityCluster(cls, model).map(line => '  ' + line));
    out.push('');
  }

  // 9. Individual Clusters
  for (const ind of model.individuals.values()) {
    out.push(...generateEntityCluster(ind, model).map(line => '  ' + line));
    out.push('');
  }

  // 10. General Class Axioms (GCIs)
  const gciAxioms: string[] = [];
  for (const cls of model.classes.values()) {
    if (cls.gciExpressions) {
      for (const expr of cls.gciExpressions) {
        const functionalExpr = manchesterToFunctional(expr);
        gciAxioms.push(`  SubClassOf(${functionalExpr} ${iri(cls.iri)})`);
      }
    }
  }
  for (const axiom of model.standaloneGcis) {
    gciAxioms.push(`  ${axiom}`);
  }

  if (gciAxioms.length > 0) {
    out.push(...gciAxioms);
    out.push('');
  }
  
  // 11. Property Chain Axioms
  let chainAxioms: string[] = [];
  for (const p of model.objectProperties.values()) {
    if (p.propertyChains) {
      for (const chain of p.propertyChains) {
        chainAxioms.push(`  SubObjectPropertyOf(ObjectPropertyChain(${chain.map(iri).join(' ')}) ${iri(p.iri)})`);
      }
    }
  }

  if (chainAxioms.length > 0) {
    out.push(...chainAxioms);
    out.push('');
  }

  // Closing parenthesis
  out.push(')');
  return out.join('\n');
}

/** Detect the source format from sourceUri for the bridge format parameter */
export function detectFormat(sourceUri: string): string {
  const lower = sourceUri.toLowerCase();
  if (lower.endsWith('.ofn') || lower.endsWith('.owf')) { return 'functional'; }
  if (lower.endsWith('.omn')) { return 'manchester'; }
  if (lower.endsWith('.ttl')) { return 'turtle'; }
  if (lower.endsWith('.rdf')) { return 'rdf-xml'; }
  return 'functional'; // default: send as functional syntax
}