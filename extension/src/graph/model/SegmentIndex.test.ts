import { describe, it, expect } from 'vitest';
import {
  buildModelSegmentIndex,
  shiftSegmentsAfter,
  applyIncrementalSegmentUpdate,
  type EditSummary,
} from './SegmentIndex';
import { createEmptyModel } from './OntologyModel';
import type { OWLClass, OntologyModel } from './OntologyModel';
import { ParserRegistry } from '../parser/ParserRegistry';

function makeClass(iri: string): OWLClass {
  return {
    iri, type: 'class', labels: {}, annotations: {},
    superClassIris: [], equivalentClassIris: [], disjointClassIris: [],
    superClassExpressions: [], equivalentClassExpressions: [], gciExpressions: [],
  };
}

const A = 'http://example.org/A';
const B = 'http://example.org/B';

const OFN = `Prefix(owl:=<http://www.w3.org/2002/07/owl#>)
Ontology(<http://example.org/>
  Declaration(Class(<${A}>))
  AnnotationAssertion(rdfs:label <${A}> "Class A"@en)
  SubClassOf(<${A}> <${B}>)
  Declaration(Class(<${B}>))
  AnnotationAssertion(<http://www.w3.org/2000/01/rdf-schema#comment> <${B}> "Class B")
)`;

describe('buildModelSegmentIndex', () => {
  it('clears fields for non-functional format', () => {
    const model = createEmptyModel('file.omn');
    model.sourceFormat = 'manchester';
    model.rawContent = 'Class: Foo\n';
    buildModelSegmentIndex(model);
    expect(model.entitySegments).toBeUndefined();
    expect(model.closingParenLine).toBeUndefined();
  });

  it('builds segment for each entity in a functional file', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    model.classes.set(B, makeClass(B));
    buildModelSegmentIndex(model);

    expect(model.entitySegments).toBeDefined();
    const segA = model.entitySegments!.get(A)!;
    const segB = model.entitySegments!.get(B)!;
    expect(segA).toBeDefined();
    expect(segB).toBeDefined();

    // A starts before B
    expect(segA.startLine).toBeLessThan(segB.startLine);
    // A ends before B starts
    expect(segA.endLine).toBeLessThan(segB.startLine);
  });

  it('sets closingParenLine to the line index of the closing )', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    buildModelSegmentIndex(model);

    const lines = OFN.split('\n');
    const closingLine = lines.findIndex(l => l.trim() === ')');
    expect(model.closingParenLine).toBe(closingLine);
  });

  it('startChar is the byte offset of the segment start line', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    buildModelSegmentIndex(model);

    const seg = model.entitySegments!.get(A)!;
    // Extract chunk using startChar and verify it contains the Declaration
    const chunk = OFN.slice(seg.startChar, seg.endChar + 1);
    expect(chunk).toContain(`<${A}>`);
  });

  it('handles abbreviated annotation property (rdfs:label)', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    buildModelSegmentIndex(model);

    const seg = model.entitySegments!.get(A)!;
    // Segment must cover the rdfs:label AnnotationAssertion line
    const lines = OFN.split('\n');
    const annotLine = lines.findIndex(l => l.includes('rdfs:label') && l.includes(`<${A}>`));
    expect(annotLine).toBeGreaterThanOrEqual(seg.startLine);
    expect(annotLine).toBeLessThanOrEqual(seg.endLine);
  });

  it('does not hang on multiline annotation continuation lines containing >', () => {
    const rawContent = `Prefix(:=<http://example.org/>)
Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)
Ontology(
Declaration(Class(:A))
AnnotationAssertion(rdfs:comment :A "first line
continuation with > delimiter and no opening quote on this physical line"@en)
)`;
    const model = ParserRegistry.parse(rawContent, 'owl-xml', 'file.ofn');
    model.rawContent = rawContent;

    buildModelSegmentIndex(model);

    const seg = model.entitySegments!.get(A);
    expect(seg).toBeDefined();
    expect(seg!.lineIndices?.length).toBe(2);
  });

  it('records GCI lines in gciSegments not entitySegments', () => {
    const rawContent = `Prefix(owl:=<http://www.w3.org/2002/07/owl#>)
Ontology(<http://example.org/>
  Declaration(Class(<${A}>))
  SubClassOf(ObjectSomeValuesFrom(<http://example.org/prop> <http://example.org/filler>) <${A}>)
)`;
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = rawContent;
    model.classes.set(A, makeClass(A));
    buildModelSegmentIndex(model);

    // GCI line should not extend A's main cluster into GCI territory
    const segA = model.entitySegments!.get(A);
    expect(segA).toBeDefined();
    // GCI segment for A should be captured
    const gciSeg = model.gciSegments?.get(A);
    expect(gciSeg).toBeDefined();
  });
});

describe('shiftSegmentsAfter', () => {
  it('shifts segments whose startLine > afterLine', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    model.classes.set(B, makeClass(B));
    buildModelSegmentIndex(model);

    const segBefore = { ...model.entitySegments!.get(B)! };
    const segA = model.entitySegments!.get(A)!;

    // Simulate 2 lines inserted at end of A's cluster
    shiftSegmentsAfter(model, segA.endLine, 2, 100);

    const segBAfter = model.entitySegments!.get(B)!;
    expect(segBAfter.startLine).toBe(segBefore.startLine + 2);
    expect(segBAfter.startChar).toBe(segBefore.startChar + 100);
  });

  it('does not shift segments before afterLine', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    model.classes.set(B, makeClass(B));
    buildModelSegmentIndex(model);

    const segABefore = { ...model.entitySegments!.get(A)! };
    const segB = model.entitySegments!.get(B)!;

    shiftSegmentsAfter(model, segB.startLine + 1, 3, 200);

    const segAAfter = model.entitySegments!.get(A)!;
    expect(segAAfter.startLine).toBe(segABefore.startLine);
  });

  it('shifts closingParenLine and gciInsertLine', () => {
    const model = createEmptyModel('file.ofn');
    model.sourceFormat = 'functional';
    model.rawContent = OFN;
    model.classes.set(A, makeClass(A));
    buildModelSegmentIndex(model);

    const cpBefore = model.closingParenLine!;
    shiftSegmentsAfter(model, 0, 5, 300);
    expect(model.closingParenLine).toBe(cpBefore + 5);
  });
});

// ── Incremental segment update vs. full rebuild ─────────────────────────────

function wrapOnt(body: string): string {
  return [
    'Prefix(:=<http://example.org/>)',
    'Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)',
    'Ontology(<http://example.org/test>',
    body,
    ')',
    '',
  ].join('\n');
}

function loadOnt(text: string): OntologyModel {
  const m = ParserRegistry.parse(text, 'owl-functional', 'file:///t.ofn');
  buildModelSegmentIndex(m);
  return m;
}

function snap(m: OntologyModel): {
  closingParenLine: number | undefined;
  gciInsertLine: number | undefined;
  entities: Record<string, unknown>;
  gci: Record<string, unknown>;
} {
  const ent: Record<string, unknown> = {};
  for (const [iri, seg] of m.entitySegments ?? []) {
    ent[iri] = {
      startLine: seg.startLine, endLine: seg.endLine,
      startChar: seg.startChar,
      lineIndices: Array.from(seg.lineIndices ?? []),
      lineCharStarts: Array.from(seg.lineCharStarts ?? []),
    };
  }
  const gci: Record<string, unknown> = {};
  for (const [iri, seg] of m.gciSegments ?? []) {
    gci[iri] = {
      startLine: seg.startLine, endLine: seg.endLine,
      startChar: seg.startChar,
      lineIndices: Array.from(seg.lineIndices ?? []),
      lineCharStarts: Array.from(seg.lineCharStarts ?? []),
    };
  }
  return { closingParenLine: m.closingParenLine, gciInsertLine: m.gciInsertLine, entities: ent, gci };
}

function makeSummary(
  oldText: string,
  oldStartLine: number,
  oldEndLine: number,
  newText: string,
  segmentMap: 'entity' | 'gci' = 'entity',
): EditSummary {
  let pos = 0, line = 0;
  while (line < oldStartLine && pos < oldText.length) {
    if (oldText.charCodeAt(pos) === 10) line++;
    pos++;
  }
  const oldStartChar = pos;
  while (line < oldEndLine && pos < oldText.length) {
    if (oldText.charCodeAt(pos) === 10) line++;
    pos++;
  }
  return { oldStartLine, oldEndLine, oldStartChar, oldEndChar: pos, newText, segmentMap };
}

describe('applyIncrementalSegmentUpdate matches full rebuild', () => {
  it('single-line annotation replace', () => {
    const oldText = wrapOnt([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A old"@en)',
      'SubClassOf(:A :B)',
    ].join('\n'));
    const newText = oldText.replace('A old', 'A NEW');
    const m = loadOnt(oldText);
    const summary = makeSummary(oldText, 4, 5, 'AnnotationAssertion(rdfs:label :A "A NEW"@en)\n');
    m.rawContent = newText;
    applyIncrementalSegmentUpdate(m, 'http://example.org/A', [summary]);
    expect(snap(m).entities).toEqual(snap(loadOnt(newText)).entities);
  });

  it('insert one axiom line', () => {
    const oldText = wrapOnt([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
    ].join('\n'));
    const newText = wrapOnt([
      'Declaration(Class(:A))',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'SubClassOf(:A :B)',
    ].join('\n'));
    const m = loadOnt(oldText);
    const summary = makeSummary(oldText, 6, 6, 'SubClassOf(:A :B)\n');
    m.rawContent = newText;
    applyIncrementalSegmentUpdate(m, 'http://example.org/A', [summary]);
    const full = snap(loadOnt(newText));
    expect(snap(m).entities).toEqual(full.entities);
    expect(snap(m).closingParenLine).toBe(full.closingParenLine);
  });

  it('delete one axiom line', () => {
    const oldText = wrapOnt([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'SubClassOf(:A :B)',
    ].join('\n'));
    const newText = wrapOnt([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
    ].join('\n'));
    const m = loadOnt(oldText);
    const summary = makeSummary(oldText, 5, 6, '');
    m.rawContent = newText;
    applyIncrementalSegmentUpdate(m, 'http://example.org/A', [summary]);
    const full = snap(loadOnt(newText));
    expect(snap(m).entities).toEqual(full.entities);
    expect(snap(m).closingParenLine).toBe(full.closingParenLine);
  });

  it('delete annotation line before existing axioms', () => {
    const oldText = wrapOnt([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:comment :A "temporary"@en)',
      'EquivalentClasses(:A :C)',
      'SubClassOf(:A :B)',
    ].join('\n'));
    const newText = wrapOnt([
      'Declaration(Class(:A))',
      'EquivalentClasses(:A :C)',
      'SubClassOf(:A :B)',
    ].join('\n'));
    const m = loadOnt(oldText);
    const summary = makeSummary(oldText, 4, 5, '');
    m.rawContent = newText;
    applyIncrementalSegmentUpdate(m, 'http://example.org/A', [summary]);
    const full = snap(loadOnt(newText));
    expect(snap(m).entities).toEqual(full.entities);
    expect(snap(m).closingParenLine).toBe(full.closingParenLine);
  });

  it('GCI insert updates gciSegments and shifts closing paren', () => {
    const oldText = wrapOnt([
      'Declaration(Class(:A))',
      'Declaration(Class(:P))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
    ].join('\n'));
    const newText = wrapOnt([
      'Declaration(Class(:A))',
      'Declaration(Class(:P))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'SubClassOf(ObjectSomeValuesFrom(:P :A) :A)',
    ].join('\n'));
    const m = loadOnt(oldText);
    const summary = makeSummary(
      oldText, 6, 6,
      'SubClassOf(ObjectSomeValuesFrom(:P :A) :A)\n',
      'gci',
    );
    m.rawContent = newText;
    applyIncrementalSegmentUpdate(m, 'http://example.org/A', [summary]);
    const full = snap(loadOnt(newText));
    expect(snap(m).gci).toEqual(full.gci);
    expect(snap(m).closingParenLine).toBe(full.closingParenLine);
  });

  it('shifts entities AFTER the edit point', () => {
    const oldText = wrapOnt([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :B "B"@en)',
    ].join('\n'));
    const newText = wrapOnt([
      'Declaration(Class(:A))',
      'AnnotationAssertion(rdfs:label :A "A"@en)',
      'AnnotationAssertion(rdfs:comment :A "C"@en)',
      'Declaration(Class(:B))',
      'AnnotationAssertion(rdfs:label :B "B"@en)',
    ].join('\n'));
    const m = loadOnt(oldText);
    const summary = makeSummary(oldText, 5, 5, 'AnnotationAssertion(rdfs:comment :A "C"@en)\n');
    m.rawContent = newText;
    applyIncrementalSegmentUpdate(m, 'http://example.org/A', [summary]);
    expect(snap(m).entities).toEqual(snap(loadOnt(newText)).entities);
  });
});
