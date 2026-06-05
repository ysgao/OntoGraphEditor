import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from 'vitest';
import { FunctionalParser } from './FunctionalParser';
import { ManchesterParser } from './ManchesterParser';
import { OwlXmlParser } from './OwlXmlParser';
import { TurtleParser } from './TurtleParser';
import { RdfXmlParser } from './RdfXmlParser';

const ROOT = join(__dirname, '../../test-ontologies');
const EX = 'http://example.org/animals#';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const SKOS_ALT_LABEL = 'http://www.w3.org/2004/02/skos/core#altLabel';

function check(cond: boolean, msg: string): void {
  expect(cond, msg).toBe(true);
}

function expectLanguageTaggedAnnotations(
  annotations: Record<string, string[]> | undefined,
  source: string,
): void {
  expect(annotations?.[SKOS_PREF_LABEL]?.[0], `${source}: skos:prefLabel lang`).toBe('Preferred koala@en');
  expect(annotations?.[SKOS_ALT_LABEL]?.[0], `${source}: skos:altLabel lang`).toBe('Koala bear@en-gb');
  expect(annotations?.[RDFS_COMMENT]?.[0], `${source}: rdfs:comment lang`).toBe('Comment text@en');
}

test('Phase2: language-tagged prefLabel, altLabel, and comment annotations', () => {
  const functional = new FunctionalParser(`
Prefix(:=<${EX}>)
Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)
Prefix(skos:=<http://www.w3.org/2004/02/skos/core#>)
Ontology(<http://example.org/animals>
  Declaration(Class(:Koala))
  AnnotationAssertion(skos:prefLabel :Koala "Preferred koala"@en)
  AnnotationAssertion(skos:altLabel :Koala "Koala bear"@en-gb)
  AnnotationAssertion(rdfs:comment :Koala "Comment text"@en)
)
`, 'file:///annotations.ofn').parse();
  expectLanguageTaggedAnnotations(functional.classes.get(`${EX}Koala`)?.annotations, 'Functional');

  const manchester = new ManchesterParser(`
Prefix: : <${EX}>
Prefix: rdfs: <http://www.w3.org/2000/01/rdf-schema#>
Prefix: skos: <http://www.w3.org/2004/02/skos/core#>
Ontology: <http://example.org/animals>

Class: :Koala
  Annotations: skos:prefLabel "Preferred koala"@en,
    skos:altLabel "Koala bear"@en-gb,
    rdfs:comment "Comment text"@en
`, 'file:///annotations.omn').parse();
  expectLanguageTaggedAnnotations(manchester.classes.get(`${EX}Koala`)?.annotations, 'Manchester');

  const turtle = new TurtleParser(`
@prefix : <${EX}> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

:Koala a owl:Class ;
  skos:prefLabel "Preferred koala"@en ;
  skos:altLabel "Koala bear"@en-gb ;
  rdfs:comment "Comment text"@en .
`, 'file:///annotations.ttl').parse();
  expectLanguageTaggedAnnotations(turtle.classes.get(`${EX}Koala`)?.annotations, 'Turtle');

  const rdfXml = new RdfXmlParser(`
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:skos="http://www.w3.org/2004/02/skos/core#">
  <owl:Class rdf:about="${EX}Koala">
    <skos:prefLabel xml:lang="en">Preferred koala</skos:prefLabel>
    <skos:altLabel xml:lang="en-gb">Koala bear</skos:altLabel>
    <rdfs:comment xml:lang="en">Comment text</rdfs:comment>
  </owl:Class>
</rdf:RDF>
`, 'file:///annotations.rdf').parse();
  expectLanguageTaggedAnnotations(rdfXml.classes.get(`${EX}Koala`)?.annotations, 'RDF/XML');
});

// ── Manchester Syntax ────────────────────────────────────────────────────────

test('Phase2: Manchester Syntax (animals.omn)', () => {
  const omn = readFileSync(join(ROOT, 'animals.omn'), 'utf8');
  const mn = new ManchesterParser(omn, 'file:///animals.omn').parse();

  console.log('── Manchester Syntax (animals.omn) ─────────────────────────────');
  console.log(`  Classes: ${mn.classes.size}  ObjProps: ${mn.objectProperties.size}  Individuals: ${mn.individuals.size}`);

  const label = (m: typeof mn, name: string) =>
    [...m.classes.values(), ...m.objectProperties.values()]
      .find(e => Object.values(e.labels).flat().includes(name));

  check(mn.classes.size >= 7, `>= 7 classes (got ${mn.classes.size})`);
  check(mn.objectProperties.size >= 2, `>= 2 object properties (got ${mn.objectProperties.size})`);
  check(mn.metadata.iri === 'http://example.org/animals', `ontology IRI = ${mn.metadata.iri}`);

  const koala = label(mn, 'Koala');
  const marsupial = [...mn.classes.values()].find(c => Object.values(c.labels).flat().includes('Marsupial'));
  check(!!koala, 'Koala class exists');
  check(!!(koala && marsupial && (koala as typeof marsupial).superClassIris?.includes(marsupial.iri)),
    'Koala SubClassOf Marsupial');

  const hasPart = [...mn.objectProperties.values()].find(p => Object.values(p.labels).flat().includes('has part'));
  check(hasPart?.isTransitive === true, 'hasPart Transitive');

  const forest = [...mn.classes.values()].find(c => Object.values(c.labels).flat().includes('Forest'));
  const ocean  = [...mn.classes.values()].find(c => Object.values(c.labels).flat().includes('Ocean'));
  check(!!(forest && ocean && forest.disjointClassIris.includes(ocean.iri)), 'Forest DisjointWith Ocean');

  const mammal = [...mn.classes.values()].find(c => Object.values(c.labels).flat().includes('Mammal'));
  check((mammal?.superClassExpressions.length ?? 0) > 0, 'Mammal has superClassExpression (some restriction)');
  if (mammal?.superClassExpressions[0]) {
    console.log(`    expression: ${mammal.superClassExpressions[0]}`);
  }

  check(mn.individuals.size >= 1, `>= 1 individual (got ${mn.individuals.size})`);
});

// ── OWL/XML ─────────────────────────────────────────────────────────────────

test('Phase2: OWL/XML (animals.owx)', () => {
  const owx = readFileSync(join(ROOT, 'animals.owx'), 'utf8');
  const ox = new OwlXmlParser(owx, 'file:///animals.owx').parse();

  console.log('── OWL/XML (animals.owx) ──────────────────────────────────────');
  console.log(`  Classes: ${ox.classes.size}  ObjProps: ${ox.objectProperties.size}  Individuals: ${ox.individuals.size}`);

  check(ox.metadata.iri === 'http://example.org/animals', `ontology IRI = ${ox.metadata.iri}`);
  check(ox.classes.size >= 6, `>= 6 classes (got ${ox.classes.size})`);

  const oxKoala = ox.classes.get('http://example.org/animals#Koala');
  check(!!oxKoala, 'Koala class exists');
  check(oxKoala?.superClassIris.includes('http://example.org/animals#Marsupial') ?? false,
    'Koala SubClassOf Marsupial');
  check(oxKoala?.labels['en']?.[0] === 'Koala', `Koala label = "${oxKoala?.labels['en']?.[0]}"`);

  const oxHH = ox.objectProperties.get('http://example.org/animals#hasHabitat');
  check((oxHH?.domainIris.length ?? 0) > 0 && (oxHH?.rangeIris.length ?? 0) > 0,
    'hasHabitat has domain+range');
  check(oxHH?.labels['en']?.[0] === 'has habitat', `hasHabitat label = "${oxHH?.labels['en']?.[0]}"`);

  check(ox.individuals.get('http://example.org/animals#koko')
    ?.classIris.includes('http://example.org/animals#Koala') ?? false,
    'koko rdf:type Koala');

  const oxHasParent = ox.objectProperties.get('http://example.org/animals#hasParent');
  check(oxHasParent?.isTransitive === true, 'hasParent Transitive');
});

// ── Turtle ───────────────────────────────────────────────────────────────────

test('Phase2: Turtle (animals.ttl)', () => {
  const ttl = readFileSync(join(ROOT, 'animals.ttl'), 'utf8');
  const tt = new TurtleParser(ttl, 'file:///animals.ttl').parse();

  console.log('── Turtle (animals.ttl) ────────────────────────────────────────');
  console.log(`  Classes: ${tt.classes.size}  ObjProps: ${tt.objectProperties.size}  Individuals: ${tt.individuals.size}`);

  check(tt.metadata.iri === 'http://example.org/animals', `ontology IRI = ${tt.metadata.iri}`);
  check(tt.classes.size >= 7, `>= 7 classes (got ${tt.classes.size})`);
  check(tt.objectProperties.size >= 2, `>= 2 object properties (got ${tt.objectProperties.size})`);

  const ttKoala = tt.classes.get('http://example.org/animals#Koala');
  check(ttKoala?.labels['en']?.[0] === 'Koala', `Koala label = "${ttKoala?.labels['en']?.[0]}"`);
  check(ttKoala?.superClassIris.includes('http://example.org/animals#Marsupial') ?? false,
    'Koala SubClassOf Marsupial');

  const ttHasPart = tt.objectProperties.get('http://example.org/animals#hasPart');
  check(ttHasPart?.isTransitive === true, 'hasPart Transitive');

  const ttKoko = tt.individuals.get('http://example.org/animals#koko');
  check(ttKoko?.classIris.includes('http://example.org/animals#Koala') ?? false, 'koko rdf:type Koala');
  check(ttKoko?.labels['en']?.[0] === 'Koko', `koko label = "${ttKoko?.labels['en']?.[0]}"`);
});

// ── RDF/XML ──────────────────────────────────────────────────────────────────

test('Phase2: RDF/XML (pizza.owl)', () => {
  const owl = readFileSync(join(ROOT, 'pizza.owl'), 'utf8');
  const rx = new RdfXmlParser(owl, 'file:///pizza.owl').parse();

  console.log('── RDF/XML (pizza.owl) ─────────────────────────────────────────');
  console.log(`  Classes: ${rx.classes.size}  ObjProps: ${rx.objectProperties.size}  AnnProps: ${rx.annotationProperties.size}  Individuals: ${rx.individuals.size}`);

  check(rx.metadata.iri === 'http://www.co-ode.org/ontologies/pizza', `ontology IRI = ${rx.metadata.iri}`);
  check(rx.metadata.versionIri === 'http://www.co-ode.org/ontologies/pizza/2.0.0', `version IRI = ${rx.metadata.versionIri}`);
  check(rx.classes.size >= 80, `>= 80 classes (got ${rx.classes.size})`);
  check(rx.objectProperties.size >= 7, `>= 7 object properties (got ${rx.objectProperties.size})`);
  check(rx.annotationProperties.size >= 7, `>= 7 annotation properties (got ${rx.annotationProperties.size})`);
  check(rx.individuals.size >= 5, `>= 5 individuals (got ${rx.individuals.size})`);

  const american = rx.classes.get('http://www.co-ode.org/ontologies/pizza/pizza.owl#American');
  check(!!american, 'American class exists');
  check(american?.superClassIris.includes('http://www.co-ode.org/ontologies/pizza/pizza.owl#NamedPizza') ?? false,
    'American SubClassOf NamedPizza');
  check((american?.superClassExpressions.length ?? 0) >= 4, `American has >= 4 restriction expressions (got ${american?.superClassExpressions.length})`);
  if (american?.superClassExpressions[0]) {
    console.log(`    expression[0]: ${american.superClassExpressions[0]}`);
  }

  const hasBase = rx.objectProperties.get('http://www.co-ode.org/ontologies/pizza/pizza.owl#hasBase');
  check(!!hasBase, 'hasBase property exists');
  check(hasBase?.isFunctional === true, 'hasBase isFunctional');
  check(hasBase?.isInverseFunctional === true, 'hasBase isInverseFunctional');
  check(hasBase?.inverseOfIri === 'http://www.co-ode.org/ontologies/pizza/pizza.owl#isBaseOf', 'hasBase inverseOf isBaseOf');

  const america = rx.individuals.get('http://www.co-ode.org/ontologies/pizza/pizza.owl#America');
  check(!!america, 'America individual exists');
  check(america?.classIris.includes('http://www.co-ode.org/ontologies/pizza/pizza.owl#Country') ?? false,
    'America rdf:type Country');
});
