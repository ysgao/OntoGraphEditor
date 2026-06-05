import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from 'vitest';
import { FunctionalParser } from './FunctionalParser';

test('FunctionalParser: BFO core ontology', () => {
  const ofnPath = join(__dirname, '../../test-ontologies/bfo-core.ofn');
  const text = readFileSync(ofnPath, 'utf8');

  const model = new FunctionalParser(text, 'file:///bfo-core.ofn').parse();

  console.log('── Ontology metadata ──────────────────────────');
  console.log('IRI:        ', model.metadata.iri);
  console.log('Version:    ', model.metadata.versionIri);
  console.log('Imports:    ', model.metadata.imports.length);

  console.log('\n── Entities ────────────────────────────────────');
  console.log('Classes:    ', model.classes.size);
  console.log('Obj props:  ', model.objectProperties.size);
  console.log('Data props: ', model.dataProperties.size);
  console.log('Ann props:  ', model.annotationProperties.size);
  console.log('Individuals:', model.individuals.size);

  console.log('\n── Sample classes ──────────────────────────────');
  let shown = 0;
  for (const cls of model.classes.values()) {
    if (shown++ >= 5) break;
    const label = Object.values(cls.labels)[0]?.[0] ?? '(no label)';
    const parents = cls.superClassIris.length
      ? cls.superClassIris.map(p => model.classes.get(p)
          ? (Object.values(model.classes.get(p)!.labels)[0]?.[0] ?? p.split(/[#/]/).pop()!)
          : p.split(/[#/]/).pop()!).join(', ')
      : '(root)';
    console.log(`  ${label.padEnd(35)} parent: ${parents}`);
    if (cls.superClassExpressions.length) {
      console.log(`    expressions: ${cls.superClassExpressions[0]}`);
    }
  }

  console.log('\n── Sample object properties ────────────────────');
  shown = 0;
  for (const prop of model.objectProperties.values()) {
    if (shown++ >= 5) break;
    const label = Object.values(prop.labels)[0]?.[0] ?? '(no label)';
    const flags = [
      prop.isTransitive ? 'transitive' : '',
      prop.isFunctional ? 'functional' : '',
      prop.isInverseFunctional ? 'inv-functional' : '',
      prop.inverseOfIri ? `inverse of ${prop.inverseOfIri.split(/[#/]/).pop()}` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${label.padEnd(35)} ${flags}`);
  }

  const EXPECTED_CLASSES = 35;
  const EXPECTED_OBJ_PROPS = 30;

  expect(model.classes.size, `expected >= ${EXPECTED_CLASSES} classes, got ${model.classes.size}`)
    .toBeGreaterThanOrEqual(EXPECTED_CLASSES);
  expect(model.objectProperties.size, `expected >= ${EXPECTED_OBJ_PROPS} object properties, got ${model.objectProperties.size}`)
    .toBeGreaterThanOrEqual(EXPECTED_OBJ_PROPS);

  const noLabel = [...model.classes.values()].filter(c => Object.keys(c.labels).length === 0);
  expect(noLabel.length, `${noLabel.length} classes have no rdfs:label`).toBe(0);
});
