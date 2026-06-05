import { describe, it, expect } from 'vitest';
import { createEmptyModel, OWLClass, OWLObjectProperty, OWLIndividual, OntologyModel } from '../model/OntologyModel';
import { generateEntityCluster, serializeToFunctional } from './FunctionalSerializer';
import { FunctionalParser } from '../parser/FunctionalParser';

describe('FunctionalSerializer Clustering', () => {
  it('should generate a cluster for a class with annotations and axioms', () => {
    const model = createEmptyModel('test.ofn');
    const cls: OWLClass = {
      iri: 'http://example.org#A',
      type: 'class',
      labels: { en: ['Class A'] },
      annotations: {
        'http://www.w3.org/2000/01/rdf-schema#comment': ['A comment@en']
      },
      superClassIris: ['http://example.org#B'],
      equivalentClassIris: ['http://example.org#C'],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: []
    };

    const cluster = generateEntityCluster(cls, model);

    expect(cluster).toEqual([
      '# Class: <http://example.org#A> (Class A)',
      'AnnotationAssertion(rdfs:label <http://example.org#A> "Class A"@en)',
      'AnnotationAssertion(rdfs:comment <http://example.org#A> "A comment"@en)',
      '',
      'EquivalentClasses(<http://example.org#A> <http://example.org#C>)',
      'SubClassOf(<http://example.org#A> <http://example.org#B>)'
    ]);
  });

  it('should generate a cluster for an object property', () => {
    const model = createEmptyModel('test.ofn');
    const prop: OWLObjectProperty = {
      iri: 'http://example.org#partOf',
      type: 'objectProperty',
      labels: { en: ['part of'] },
      annotations: {},
      superPropertyIris: ['http://example.org#componentOf'],
      domainIris: ['http://example.org#A'],
      rangeIris: ['http://example.org#B'],
      isTransitive: true,
      inverseOfIri: 'http://example.org#hasPart'
    };

    const cluster = generateEntityCluster(prop, model);

    expect(cluster).toEqual([
      '# ObjectProperty: <http://example.org#partOf> (part of)',
      'AnnotationAssertion(rdfs:label <http://example.org#partOf> "part of"@en)',
      '',
      'InverseObjectProperties(<http://example.org#partOf> <http://example.org#hasPart>)',
      'SubObjectPropertyOf(<http://example.org#partOf> <http://example.org#componentOf>)',
      'ObjectPropertyDomain(<http://example.org#partOf> <http://example.org#A>)',
      'ObjectPropertyRange(<http://example.org#partOf> <http://example.org#B>)',
      'TransitiveObjectProperty(<http://example.org#partOf>)'
    ]);
  });

  it('should generate a cluster for an individual', () => {
    const model = createEmptyModel('test.ofn');
    const ind: OWLIndividual = {
      iri: 'http://example.org#myInd',
      type: 'individual',
      labels: { en: ['My Individual'] },
      annotations: {},
      classIris: ['http://example.org#A'],
      objectPropertyAssertions: [{ propertyIri: 'http://example.org#partOf', targetIri: 'http://example.org#otherInd' }],
      dataPropertyAssertions: [{ propertyIri: 'http://example.org#hasAge', value: '25', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }]
    };

    const cluster = generateEntityCluster(ind, model);

    expect(cluster).toEqual([
      '# Individual: <http://example.org#myInd> (My Individual)',
      'AnnotationAssertion(rdfs:label <http://example.org#myInd> "My Individual"@en)',
      '',
      'ClassAssertion(<http://example.org#A> <http://example.org#myInd>)',
      'ObjectPropertyAssertion(<http://example.org#partOf> <http://example.org#myInd> <http://example.org#otherInd>)',
      'DataPropertyAssertion(<http://example.org#hasAge> <http://example.org#myInd> "25"^^<http://www.w3.org/2001/XMLSchema#integer>)'
    ]);
  });

  it('should abbreviate rdfs:seeAlso annotation property IRI', () => {
    const model = createEmptyModel('test.ofn');
    const cls: OWLClass = {
      iri: 'http://example.org#A',
      type: 'class',
      labels: {},
      annotations: {
        'http://www.w3.org/2000/01/rdf-schema#seeAlso': ['http://example.org#B'],
        'http://www.w3.org/2000/01/rdf-schema#isDefinedBy': ['http://example.org#ont'],
      },
      superClassIris: [],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
    };

    const cluster = generateEntityCluster(cls, model);

    expect(cluster.some(l => l.startsWith('AnnotationAssertion(rdfs:seeAlso '))).toBe(true);
    expect(cluster.some(l => l.startsWith('AnnotationAssertion(rdfs:isDefinedBy '))).toBe(true);
    expect(cluster.some(l => l.includes('<http://www.w3.org/2000/01/rdf-schema#'))).toBe(false);
  });

  it('should escape special characters in literals', () => {
    const model = createEmptyModel('test.ofn');
    const ind: OWLIndividual = {
      iri: 'http://example.org#escInd',
      type: 'individual',
      labels: { en: ['Label with "quotes" and \\backslashes\\'] },
      annotations: {},
      classIris: [],
      objectPropertyAssertions: [],
      dataPropertyAssertions: []
    };

    const cluster = generateEntityCluster(ind, model);
    expect(cluster[1]).toContain('"Label with \\"quotes\\" and \\\\backslashes\\\\"@en');
  });
});

describe('FunctionalSerializer newline round-trip', () => {
  it('writes a real newline (not \\n escape) and round-trips through parse', () => {
    const SKOS_DEFINITION = 'http://www.w3.org/2004/02/skos/core#definition';
    const model = createEmptyModel('test.ofn');
    model.metadata.iri = 'http://example.org/ont';
    const cls: OWLClass = {
      iri: 'http://example.org#A',
      type: 'class',
      labels: {},
      annotations: { [SKOS_DEFINITION]: ['First line.\nSecond line.'] },
      superClassIris: [],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
    };
    model.classes.set(cls.iri, cls);

    const ofn = serializeToFunctional(model);

    // The OWL file must contain a real newline inside the string, not a \n escape.
    expect(ofn).not.toContain('\\n');
    expect(ofn).toMatch(/"First line\.\nSecond line\."/);

    const parser = new FunctionalParser(ofn, 'test.ofn');
    const parsed = parser.parse();
    const parsedCls = parsed.classes.get('http://example.org#A');
    expect(parsedCls).toBeDefined();
    const recovered = parsedCls!.annotations[SKOS_DEFINITION]?.[0];
    expect(recovered).toBe('First line.\nSecond line.');
  });
});

describe('FunctionalSerializer Full Serialization', () => {
  it('should serialize with correct order and clustering', () => {
    const model = createEmptyModel('test.ofn');
    model.metadata.iri = 'http://example.org/ontology';
    
    const clsA: OWLClass = {
      iri: 'http://example.org#A',
      type: 'class',
      labels: { en: ['Class A'] },
      annotations: {},
      superClassIris: ['http://example.org#B'],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: []
    };
    model.classes.set(clsA.iri, clsA);

    const propP: OWLObjectProperty = {
      iri: 'http://example.org#p',
      type: 'objectProperty',
      labels: { en: ['prop p'] },
      annotations: {},
      superPropertyIris: [],
      domainIris: [],
      rangeIris: [],
      propertyChains: [['http://example.org#p1', 'http://example.org#p2']]
    };
    model.objectProperties.set(propP.iri, propP);

    const clsC: OWLClass = {
      iri: 'http://example.org#C',
      type: 'class',
      labels: { en: ['Class C'] },
      annotations: {},
      superClassIris: [],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: ['http://example.org#p some http://example.org#A']
    };
    model.classes.set(clsC.iri, clsC);

    const output = serializeToFunctional(model);
    
    const lines = output.split('\n');
    
    // ... (previous checks)

    // GCI should be before Property chain
    const gciIdx = lines.findIndex(l => l.includes('SubClassOf(ObjectSomeValuesFrom'));
    const chainIdx = lines.findIndex(l => l.includes('SubObjectPropertyOf(ObjectPropertyChain'));
    
    expect(gciIdx).toBeGreaterThan(-1);
    expect(chainIdx).toBeGreaterThan(-1);
    expect(gciIdx).toBeLessThan(chainIdx);
    expect(lines[lines.length - 1]).toBe(')');
  });
});
