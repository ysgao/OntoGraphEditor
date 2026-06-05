import { XMLParser } from 'fast-xml-parser';
import {
  createEmptyModel, OntologyModel,
  OWLClass, OWLObjectProperty, OWLDataProperty, OWLAnnotationProperty, OWLIndividual,
} from '../model/OntologyModel';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

export class OwlXmlParser {
  private readonly text: string;
  private readonly uri: string;
  private readonly prefixes: Map<string, string> = new Map([
    ['owl:', 'http://www.w3.org/2002/07/owl#'],
    ['rdf:', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
    ['rdfs:', 'http://www.w3.org/2000/01/rdf-schema#'],
    ['xsd:', 'http://www.w3.org/2001/XMLSchema#'],
  ]);
  private base = '';

  constructor(text: string, uri: string) {
    this.text = text;
    this.uri = uri;
  }

  parse(): OntologyModel {
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (_name, _jpath, _isLeafNode, isAttribute) => !isAttribute,
      textNodeName: '#text',
      parseAttributeValue: false,
    });

    const doc = xmlParser.parse(this.text);
    const ontology = doc?.Ontology?.[0];
    if (!ontology) throw new Error('No <Ontology> element found — expected OWL/XML format');

    const model = createEmptyModel(this.uri);

    const ontIri: string = ontology['@_ontologyIRI'] ?? '';
    const versionIri: string = ontology['@_versionIRI'] ?? '';
    const xmlBase: string = ontology['@_xml:base'] ?? '';
    this.base = xmlBase || ontIri;
    model.metadata.iri = ontIri || undefined;
    model.metadata.versionIri = versionIri || undefined;

    for (const prefix of (ontology.Prefix ?? []) as unknown[]) {
      const p = prefix as Record<string, string>;
      const name: string = p['@_name'] ?? '';
      const iri: string = p['@_IRI'] ?? '';
      if (name !== undefined && iri) {
        this.prefixes.set(name.endsWith(':') ? name : name + ':', iri);
      }
    }

    for (const decl of (ontology.Declaration ?? []) as unknown[]) {
      this.processDeclaration(decl as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.SubClassOf ?? []) as unknown[]) {
      this.processSubClassOf(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.EquivalentClasses ?? []) as unknown[]) {
      this.processEquivalentClasses(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.DisjointClasses ?? []) as unknown[]) {
      this.processDisjointClasses(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.SubObjectPropertyOf ?? []) as unknown[]) {
      this.processSubObjectPropertyOf(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.ObjectPropertyDomain ?? []) as unknown[]) {
      this.processObjectPropertyDomain(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.ObjectPropertyRange ?? []) as unknown[]) {
      this.processObjectPropertyRange(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.TransitiveObjectProperty ?? []) as unknown[]) {
      this.processTransitiveObjectProperty(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.FunctionalObjectProperty ?? []) as unknown[]) {
      this.processFunctionalObjectProperty(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.InverseFunctionalObjectProperty ?? []) as unknown[]) {
      this.processInverseFunctionalObjectProperty(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.SymmetricObjectProperty ?? []) as unknown[]) {
      this.processSymmetricObjectProperty(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.InverseObjectProperties ?? []) as unknown[]) {
      this.processInverseObjectProperties(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.SubDataPropertyOf ?? []) as unknown[]) {
      this.processSubDataPropertyOf(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.FunctionalDataProperty ?? []) as unknown[]) {
      this.processFunctionalDataProperty(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.ClassAssertion ?? []) as unknown[]) {
      this.processClassAssertion(ax as Record<string, unknown[]>, model);
    }

    for (const ax of (ontology.AnnotationAssertion ?? []) as unknown[]) {
      this.processAnnotationAssertion(ax as Record<string, unknown[]>, model);
    }

    return model;
  }

  private expandIri(el: Record<string, string>): string | null {
    const iri: string | undefined = el['@_IRI'];
    if (iri !== undefined) {
      if (iri.startsWith('http') || iri.startsWith('urn') || iri.startsWith('file')) {
        return iri;
      }
      return this.base + iri;
    }
    const abbr: string | undefined = el['@_abbreviatedIRI'];
    if (abbr !== undefined) {
      const colon = abbr.indexOf(':');
      if (colon >= 0) {
        const prefix = abbr.slice(0, colon + 1);
        const local = abbr.slice(colon + 1);
        const ns = this.prefixes.get(prefix);
        if (ns !== undefined) return ns + local;
      }
      return abbr;
    }
    return null;
  }

  private firstIri(elements: unknown[] | undefined): string | null {
    if (!elements?.length) return null;
    return this.expandIri(elements[0] as Record<string, string>);
  }

  private secondIri(elements: unknown[] | undefined): string | null {
    if (!elements || elements.length < 2) return null;
    return this.expandIri(elements[1] as Record<string, string>);
  }

  private ensureClass(iri: string, model: OntologyModel): OWLClass {
    let cls = model.classes.get(iri);
    if (!cls) {
      cls = {
        iri,
        type: 'class',
        labels: {},
        annotations: {},
        superClassIris: [],
        equivalentClassIris: [],
        disjointClassIris: [],
        superClassExpressions: [],
        equivalentClassExpressions: [],
        gciExpressions: [],
      };
      model.classes.set(iri, cls);
    }
    return cls;
  }

  private ensureObjectProperty(iri: string, model: OntologyModel): OWLObjectProperty {
    let prop = model.objectProperties.get(iri);
    if (!prop) {
      prop = {
        iri,
        type: 'objectProperty',
        labels: {},
        annotations: {},
        superPropertyIris: [],
        domainIris: [],
        rangeIris: [],
      };
      model.objectProperties.set(iri, prop);
    }
    return prop;
  }

  private ensureDataProperty(iri: string, model: OntologyModel): OWLDataProperty {
    let prop = model.dataProperties.get(iri);
    if (!prop) {
      prop = {
        iri,
        type: 'dataProperty',
        labels: {},
        annotations: {},
        superPropertyIris: [],
        domainIris: [],
        rangeIris: [],
      };
      model.dataProperties.set(iri, prop);
    }
    return prop;
  }

  private ensureAnnotationProperty(iri: string, model: OntologyModel): OWLAnnotationProperty {
    let prop = model.annotationProperties.get(iri);
    if (!prop) {
      prop = {
        iri,
        type: 'annotationProperty',
        labels: {},
        annotations: {},
        superPropertyIris: [],
        domainIris: [],
        rangeIris: [],
      };
      model.annotationProperties.set(iri, prop);
    }
    return prop;
  }

  private ensureIndividual(iri: string, model: OntologyModel): OWLIndividual {
    let ind = model.individuals.get(iri);
    if (!ind) {
      ind = {
        iri,
        type: 'individual',
        labels: {},
        annotations: {},
        classIris: [],
        objectPropertyAssertions: [],
        dataPropertyAssertions: [],
      };
      model.individuals.set(iri, ind);
    }
    return ind;
  }

  private processDeclaration(decl: Record<string, unknown[]>, model: OntologyModel): void {
    const classEls = decl['Class'];
    if (classEls?.length) {
      const iri = this.firstIri(classEls);
      if (iri) this.ensureClass(iri, model);
      return;
    }
    const objPropEls = decl['ObjectProperty'];
    if (objPropEls?.length) {
      const iri = this.firstIri(objPropEls);
      if (iri) this.ensureObjectProperty(iri, model);
      return;
    }
    const dataPropEls = decl['DataProperty'];
    if (dataPropEls?.length) {
      const iri = this.firstIri(dataPropEls);
      if (iri) this.ensureDataProperty(iri, model);
      return;
    }
    const annPropEls = decl['AnnotationProperty'];
    if (annPropEls?.length) {
      const iri = this.firstIri(annPropEls);
      if (iri) this.ensureAnnotationProperty(iri, model);
      return;
    }
    const indEls = decl['NamedIndividual'];
    if (indEls?.length) {
      const iri = this.firstIri(indEls);
      if (iri) this.ensureIndividual(iri, model);
    }
  }

  private processSubClassOf(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const classEls = ax['Class'];
    if (!classEls || classEls.length < 2) return;
    const childIri = this.firstIri(classEls);
    const parentIri = this.secondIri(classEls);
    if (!childIri || !parentIri) return;
    const child = this.ensureClass(childIri, model);
    this.ensureClass(parentIri, model);
    if (!child.superClassIris.includes(parentIri)) {
      child.superClassIris.push(parentIri);
    }
  }

  private processEquivalentClasses(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const classEls = ax['Class'];
    if (!classEls || classEls.length < 2) return;
    const iris: string[] = [];
    for (const el of classEls) {
      const iri = this.expandIri(el as Record<string, string>);
      if (iri) iris.push(iri);
    }
    for (let i = 0; i < iris.length; i++) {
      const cls = this.ensureClass(iris[i], model);
      for (let j = 0; j < iris.length; j++) {
        if (i === j) continue;
        this.ensureClass(iris[j], model);
        if (!cls.equivalentClassIris.includes(iris[j])) {
          cls.equivalentClassIris.push(iris[j]);
        }
      }
    }
  }

  private processDisjointClasses(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const classEls = ax['Class'];
    if (!classEls || classEls.length < 2) return;
    const iris: string[] = [];
    for (const el of classEls) {
      const iri = this.expandIri(el as Record<string, string>);
      if (iri) iris.push(iri);
    }
    for (let i = 0; i < iris.length; i++) {
      const cls = this.ensureClass(iris[i], model);
      for (let j = 0; j < iris.length; j++) {
        if (i === j) continue;
        this.ensureClass(iris[j], model);
        if (!cls.disjointClassIris.includes(iris[j])) {
          cls.disjointClassIris.push(iris[j]);
        }
      }
    }
  }

  private processSubObjectPropertyOf(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    if (!propEls || propEls.length < 2) return;
    const childIri = this.firstIri(propEls);
    const parentIri = this.secondIri(propEls);
    if (!childIri || !parentIri) return;
    const child = this.ensureObjectProperty(childIri, model);
    this.ensureObjectProperty(parentIri, model);
    if (!child.superPropertyIris.includes(parentIri)) {
      child.superPropertyIris.push(parentIri);
    }
  }

  private processObjectPropertyDomain(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    const classEls = ax['Class'];
    if (!propEls?.length || !classEls?.length) return;
    const propIri = this.firstIri(propEls);
    const classIri = this.firstIri(classEls);
    if (!propIri || !classIri) return;
    const prop = this.ensureObjectProperty(propIri, model);
    this.ensureClass(classIri, model);
    if (!prop.domainIris.includes(classIri)) {
      prop.domainIris.push(classIri);
    }
  }

  private processObjectPropertyRange(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    const classEls = ax['Class'];
    if (!propEls?.length || !classEls?.length) return;
    const propIri = this.firstIri(propEls);
    const classIri = this.firstIri(classEls);
    if (!propIri || !classIri) return;
    const prop = this.ensureObjectProperty(propIri, model);
    this.ensureClass(classIri, model);
    if (!prop.rangeIris.includes(classIri)) {
      prop.rangeIris.push(classIri);
    }
  }

  private processTransitiveObjectProperty(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    if (!propEls?.length) return;
    const iri = this.firstIri(propEls);
    if (!iri) return;
    this.ensureObjectProperty(iri, model).isTransitive = true;
  }

  private processFunctionalObjectProperty(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    if (!propEls?.length) return;
    const iri = this.firstIri(propEls);
    if (!iri) return;
    this.ensureObjectProperty(iri, model).isFunctional = true;
  }

  private processInverseFunctionalObjectProperty(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    if (!propEls?.length) return;
    const iri = this.firstIri(propEls);
    if (!iri) return;
    this.ensureObjectProperty(iri, model).isInverseFunctional = true;
  }

  private processSymmetricObjectProperty(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    if (!propEls?.length) return;
    const iri = this.firstIri(propEls);
    if (!iri) return;
    this.ensureObjectProperty(iri, model).isSymmetric = true;
  }

  private processInverseObjectProperties(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['ObjectProperty'];
    if (!propEls || propEls.length < 2) return;
    const iri1 = this.firstIri(propEls);
    const iri2 = this.secondIri(propEls);
    if (!iri1 || !iri2) return;
    const prop1 = this.ensureObjectProperty(iri1, model);
    this.ensureObjectProperty(iri2, model);
    prop1.inverseOfIri = iri2;
  }

  private processSubDataPropertyOf(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['DataProperty'];
    if (!propEls || propEls.length < 2) return;
    const childIri = this.firstIri(propEls);
    const parentIri = this.secondIri(propEls);
    if (!childIri || !parentIri) return;
    const child = this.ensureDataProperty(childIri, model);
    this.ensureDataProperty(parentIri, model);
    if (!child.superPropertyIris.includes(parentIri)) {
      child.superPropertyIris.push(parentIri);
    }
  }

  private processFunctionalDataProperty(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const propEls = ax['DataProperty'];
    if (!propEls?.length) return;
    const iri = this.firstIri(propEls);
    if (!iri) return;
    this.ensureDataProperty(iri, model).isFunctional = true;
  }

  private processClassAssertion(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const classEls = ax['Class'];
    const indEls = ax['NamedIndividual'];
    if (!classEls?.length || !indEls?.length) return;
    const classIri = this.firstIri(classEls);
    const indIri = this.firstIri(indEls);
    if (!classIri || !indIri) return;
    this.ensureClass(classIri, model);
    const ind = this.ensureIndividual(indIri, model);
    if (!ind.classIris.includes(classIri)) {
      ind.classIris.push(classIri);
    }
  }

  private processAnnotationAssertion(ax: Record<string, unknown[]>, model: OntologyModel): void {
    const annPropEls = ax['AnnotationProperty'];
    if (!annPropEls?.length) return;
    const propIri = this.expandIri(annPropEls[0] as Record<string, string>);
    if (!propIri) return;

    // Ensure annotation property is registered in the model
    if (!model.annotationProperties.has(propIri)) {
      model.annotationProperties.set(propIri, {
        iri: propIri, type: 'annotationProperty', labels: {}, annotations: {},
        superPropertyIris: [], domainIris: [], rangeIris: [],
      });
    }

    const iriEls = ax['IRI'];
    if (!iriEls?.length) return;
    const rawSubject = iriEls[0];
    let subjectIri: string | null = null;
    if (typeof rawSubject === 'string') {
      subjectIri = rawSubject;
    } else if (rawSubject && typeof rawSubject === 'object') {
      const rec = rawSubject as Record<string, unknown>;
      const text = rec['#text'];
      if (typeof text === 'string') subjectIri = text;
    }
    if (!subjectIri) return;

    if (!subjectIri.startsWith('http') && !subjectIri.startsWith('urn') && !subjectIri.startsWith('file')) {
      subjectIri = this.base + subjectIri;
    }

    const literalEls = ax['Literal'];
    if (!literalEls?.length) return;
    const literalEl = literalEls[0] as Record<string, unknown>;

    let literalValue: string | null = null;
    let lang = '';

    if (typeof literalEl === 'string') {
      literalValue = literalEl;
    } else if (literalEl && typeof literalEl === 'object') {
      const text = literalEl['#text'];
      if (typeof text === 'string') literalValue = text;
      const langAttr = literalEl['@_xml:lang'];
      if (typeof langAttr === 'string') lang = langAttr;
    }

    if (!literalValue) return;

    const entity =
      model.classes.get(subjectIri) ??
      model.objectProperties.get(subjectIri) ??
      model.dataProperties.get(subjectIri) ??
      model.annotationProperties.get(subjectIri) ??
      model.individuals.get(subjectIri);

    if (!entity) return;

    if (propIri === RDFS_LABEL) {
      if (!entity.labels[lang]) entity.labels[lang] = [];
      if (!entity.labels[lang].includes(literalValue)) {
        entity.labels[lang].push(literalValue);
      }
    } else {
      const val = lang ? `${literalValue}@${lang}` : literalValue;
      (entity.annotations[propIri] ??= []).push(val);
    }
  }
}
