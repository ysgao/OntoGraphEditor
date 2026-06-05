import { test, expect } from 'vitest';
import { FunctionalParser } from './FunctionalParser';
import { serializeToFunctional } from '../serializer/FunctionalSerializer';

test('GCI round-trip: complex LHS, named RHS', () => {
  const input = `Ontology(<http://example.org>
  SubClassOf(ObjectSomeValuesFrom(<http://example.org#p> <http://example.org#A>) <http://example.org#B>)
)`;
  const model = new FunctionalParser(input, 'file:///test.ofn').parse();
  const clsB = model.classes.get('http://example.org#B');
  expect(clsB).toBeDefined();
  expect(clsB?.gciExpressions).toHaveLength(1);

  const output = serializeToFunctional(model);
  expect(output).toContain('SubClassOf(ObjectSomeValuesFrom(<http://example.org#p> <http://example.org#A>) <http://example.org#B>)');
});

test('GCI round-trip: complex LHS and complex RHS (standalone GCI)', () => {
  const input = `Ontology(<http://example.org>
  SubClassOf(ObjectIntersectionOf(<http://example.org#A> <http://example.org#B>) ObjectUnionOf(<http://example.org#C> <http://example.org#D>))
)`;
  const model = new FunctionalParser(input, 'file:///test.ofn').parse();
  expect(model.standaloneGcis).toHaveLength(1);

  const output = serializeToFunctional(model);
  expect(output).toContain('SubClassOf(ObjectIntersectionOf(<http://example.org#A> <http://example.org#B>) ObjectUnionOf(<http://example.org#C> <http://example.org#D>))');
});