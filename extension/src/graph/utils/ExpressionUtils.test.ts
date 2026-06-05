import { test, expect } from 'vitest';
import { manchesterToFunctional } from './ExpressionUtils';

test('manchesterToFunctional: ObjectComplementOf spacing', () => {
  const input = 'not http://example.org#A';
  const expected = 'ObjectComplementOf(<http://example.org#A>)';
  expect(manchesterToFunctional(input)).toBe(expected);
});

test('manchesterToFunctional: ObjectComplementOf with parentheses', () => {
  const input = 'not (http://example.org#A and http://example.org#B)';
  const expected = 'ObjectComplementOf(ObjectIntersectionOf(<http://example.org#A> <http://example.org#B>))';
  expect(manchesterToFunctional(input)).toBe(expected);
});
