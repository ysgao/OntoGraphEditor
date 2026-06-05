import { describe, it, expect } from 'vitest';
import { ParserRegistry } from '../parser/ParserRegistry';
import { buildModelSegmentIndex } from '../model/SegmentIndex';
import { computeLineDiff, canApplyIncremental } from './lineDiff';
import { applyIncrementalReload } from './incrementalReload';
import type { OntologyModel } from '../model/OntologyModel';

function makeFunctionalDoc(body: string): string {
  return [
    'Prefix(:=<http://example.org/>)',
    'Prefix(xsd:=<http://www.w3.org/2001/XMLSchema#>)',
    'Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)',
    'Ontology(<http://example.org/test>',
    body,
    ')',
    '',
  ].join('\n');
}

function load(text: string): OntologyModel {
  const model = ParserRegistry.parse(text, 'owl-functional', 'file:///test.ofn');
  buildModelSegmentIndex(model);
  return model;
}

function applyEdit(model: OntologyModel, oldText: string, newText: string): boolean {
  const diff = computeLineDiff(oldText, newText);
  if (!canApplyIncremental(oldText, newText, diff)) return false;
  return applyIncrementalReload(model, oldText.length, newText, diff, { mtime: 1, size: newText.length });
}

describe('applyIncrementalReload — happy paths', () => {
  it('annotation change in one entity replaces only that entity', () => {
    const oldText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :A "A original"@en)',
      'AnnotationAssertion(rdfs:label :B "B original"@en)',
      'SubClassOf(:A :B)',
    ].join('\n'));

    const model = load(oldText);

    const newText = oldText.replace('A original', 'A updated');

    const ok = applyEdit(model, oldText, newText);
    expect(ok).toBe(true);
    const a = model.classes.get('http://example.org/A');
    const b = model.classes.get('http://example.org/B');
    expect(a?.labels.en?.[0]).toBe('A updated');
    expect(b?.labels.en?.[0]).toBe('B original');
    expect(model.rawContent).toBe(newText);
  });

  it('adds a new SubClassOf axiom', () => {
    const oldText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
    ].join('\n'));

    const newText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'SubClassOf(:A :B)',
    ].join('\n'));

    const model = load(oldText);
    const ok = applyEdit(model, oldText, newText);
    expect(ok).toBe(true);
    const a = model.classes.get('http://example.org/A');
    expect(a?.superClassIris).toContain('http://example.org/B');
  });

  it('deletes an entity that was removed from the file', () => {
    const oldText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
      'Declaration(Class(:C))',
      'AnnotationAssertion(rdfs:label :C "C"@en)',
    ].join('\n'));

    const newText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
    ].join('\n'));

    const model = load(oldText);
    expect(model.classes.has('http://example.org/C')).toBe(true);
    const ok = applyEdit(model, oldText, newText);
    expect(ok).toBe(true);
    expect(model.classes.has('http://example.org/C')).toBe(false);
  });

  it('adds a brand new entity introduced in the diff region', () => {
    const oldText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
    ].join('\n'));

    const newText = makeFunctionalDoc([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'Declaration(Class(:NewOne))',
      'AnnotationAssertion(rdfs:label :NewOne "NewOne"@en)',
    ].join('\n'));

    const model = load(oldText);
    expect(model.classes.has('http://example.org/NewOne')).toBe(false);
    const ok = applyEdit(model, oldText, newText);
    expect(ok).toBe(true);
    const n = model.classes.get('http://example.org/NewOne');
    expect(n?.labels.en?.[0]).toBe('NewOne');
  });

  it('no-op when texts identical (still refreshes fingerprint)', () => {
    const text = makeFunctionalDoc('Declaration(Class(:A))');
    const model = load(text);
    const diff = computeLineDiff(text, text);
    const ok = applyIncrementalReload(model, text.length, text, diff, { mtime: 999, size: text.length });
    expect(ok).toBe(true);
    expect(model.sourceMtimeMs).toBe(999);
  });
});

describe('applyIncrementalReload — rejects unsafe inputs', () => {
  it('rejects when a Prefix declaration changes', () => {
    const oldText = makeFunctionalDoc('Declaration(Class(:A))');
    const newText = oldText.replace(
      'Prefix(:=<http://example.org/>)',
      'Prefix(:=<http://example.com/>)',
    );
    const diff = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, diff)).toBe(false);
  });

  it('rejects when the Ontology IRI changes', () => {
    const oldText = makeFunctionalDoc('Declaration(Class(:A))');
    const newText = oldText.replace(
      'Ontology(<http://example.org/test>',
      'Ontology(<http://example.org/other>',
    );
    const diff = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, diff)).toBe(false);
  });

  it('rejects giant diffs (above absolute floor + ratio)', () => {
    // Use clearly-distinct bodies so the diff covers almost the whole file.
    const oldText = makeFunctionalDoc('Declaration(Class(:A))\n'.repeat(5000));
    const newText = makeFunctionalDoc('Declaration(Class(:Z))\n'.repeat(5000));
    const diff = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, diff)).toBe(false);
  });
});
