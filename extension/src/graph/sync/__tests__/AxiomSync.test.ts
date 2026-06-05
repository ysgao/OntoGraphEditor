import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { syncAxiomsToDocument } from '../AxiomSync';
import type { OWLClass } from '../../model/OntologyModel';
import { temporaryClassIris } from '../../views/DLQueryState';

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('vscode', () => ({
  Range: vi.fn((s1, c1, s2, c2) => ({
    start: { line: s1, character: c1 },
    end: { line: s2, character: c2 },
  })),
  Position: vi.fn((l, c) => ({ line: l, character: c })),
  WorkspaceEdit: vi.fn(() => {
    const editsMap = new Map();
    const add = (uri: unknown, range: unknown, newText: string) => {
      const k = (uri as { toString?: () => string })?.toString?.() ?? String(uri);
      if (!editsMap.has(k)) editsMap.set(k, []);
      editsMap.get(k).push({ range, newText });
    };
    return {
      replace: (uri: unknown, range: unknown, newText: string) => add(uri, range, newText),
      insert: (uri: unknown, pos: unknown, newText: string) => add(uri, { start: pos, end: pos }, newText),
      delete: (uri: unknown, range: unknown) => add(uri, range, ''),
      entries: () => [...editsMap.entries()].map(([, v]) => [null, v]),
    };
  }),
  workspace: {
    fs: {
      readFile: mockReadFile,
      writeFile: mockWriteFile,
    },
    textDocuments: [],
    applyEdit: vi.fn().mockResolvedValue(true),
  },
  window: {
    showErrorMessage: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function setupContent(content: string): void {
  mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(content));
}

function makeUri(fsPath: string): vscode.Uri {
  return { fsPath, toString: () => `file:///${fsPath}` } as unknown as vscode.Uri;
}

const A = 'http://example.org#A';
const B = 'http://example.org#B';
const C = 'http://example.org#C';
const F = 'http://example.org#F';

function makeClass(
  superClassIris: string[],
  equivalentClassIris: string[] = [],
): OWLClass {
  return {
    iri: A,
    type: 'class',
    labels: {},
    annotations: {},
    superClassIris,
    equivalentClassIris,
    disjointClassIris: [],
    superClassExpressions: [],
    equivalentClassExpressions: [],
    gciExpressions: [],
  };
}

// ── Zero-indent style (bfo-core.ofn) ──────────────────────────────────────────

describe('syncAxiomsFunctional — zero-indent style', () => {
  it('inserts SubClassOf using detected zero indent when file has no indentation', async () => {
    // bfo-core.ofn style: axioms at column 0, no leading whitespace
    const content = [
      `Ontology(<http://example.org/ont>`,          // 0
      `Declaration(Class(<${A}>))`,                  // 1
      `AnnotationAssertion(rdfs:label <${A}> "A")`,  // 2
      `)`,                                           // 3
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([B]), 'functional');

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain(`<${B}>`);
    expect(result!.updatedText).toContain('SubClassOf');
  });

  it('does not apply edit when zero-indent file already has the axiom', async () => {
    const content = [
      `Ontology(<http://example.org/ont>`,           // 0
      `Declaration(Class(<${A}>))`,                   // 1
      `AnnotationAssertion(rdfs:label <${A}> "A")`,  // 2
      `SubClassOf(<${A}> <${B}>)`,                   // 3
      `)`,                                            // 4
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([B]), 'functional');
    expect(result).toBeNull();
  });

  it('adds new SubClassOf to zero-indent file with existing SubClassOf', async () => {
    const content = [
      `Ontology(<http://example.org/ont>`,           // 0
      `Declaration(Class(<${A}>))`,                   // 1
      `AnnotationAssertion(rdfs:label <${A}> "A")`,  // 2
      `SubClassOf(<${A}> <${B}>)`,                   // 3
      `)`,                                            // 4
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([B, C]), 'functional');

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain(`<${C}>`);
    expect(result!.updatedText).toContain('SubClassOf');
  });
});

// ── Original integration test (preserved) ─────────────────────────────────────

describe('AxiomSync Clustered Functional Syntax', () => {
  it('should sync axioms into an existing entity cluster (replace B→C)', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${A}>))`,
      `  AnnotationAssertion(rdfs:label <${A}> "Class A")`,
      '',
      `  SubClassOf(<${A}> <${B}>)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([C]), 'functional');
    expect(result).not.toBeNull();
  });
});

// ── Idempotency ────────────────────────────────────────────────────────────────

describe('syncAxiomsFunctional — idempotency', () => {
  it('does not apply any edit when axioms are unchanged', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${A}>))`,
      `  SubClassOf(<${A}> <${B}>)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([B]), 'functional');
    expect(result).toBeNull();
  });

  it('does not apply any edit when EquivalentClasses + SubClassOf are both unchanged', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${A}>))`,
      `  EquivalentClasses(<${A}> <${F}>)`,
      `  SubClassOf(<${A}> <${B}>)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ofn'),
      makeClass([B], [F]),
      'functional',
    );
    expect(result).toBeNull();
  });

  it('does not apply any edit when entity has no axioms and model has none', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${A}>))`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([]), 'functional');
    expect(result).toBeNull();
  });
});

// ── Minimal diff ───────────────────────────────────────────────────────────────

describe('syncAxiomsFunctional — minimal diff', () => {
  it('inserts first SubClassOf for entity with no existing axioms', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',   // 0
      `  Declaration(Class(<${A}>))`,         // 1
      `  AnnotationAssertion(rdfs:label <${A}> "A"@en)`,  // 2
      ')',                                    // 3
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([B]), 'functional');

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain(`<${B}>`);
    expect(result!.updatedText).toContain('SubClassOf');
  });

  it('adds new SubClassOf after existing SubClassOf without touching EquivalentClasses', async () => {
    // File: EquivalentClasses (line 2), SubClassOf B (line 3)
    // Model adds SubClassOf C
    const content = [
      'Ontology(<http://example.org/ont>',    // 0
      `  Declaration(Class(<${A}>))`,          // 1
      `  EquivalentClasses(<${A}> <${F}>)`,   // 2
      `  SubClassOf(<${A}> <${B}>)`,          // 3
      ')',                                     // 4
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ofn'),
      makeClass([B, C], [F]),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain(`<${C}>`);
    expect(result!.updatedText).toContain('SubClassOf');
    expect(result!.updatedText).not.toContain(`SubClassOf(<${A}> <${F}>`);
  });

  it('adds EquivalentClasses before existing SubClassOf', async () => {
    // File: SubClassOf B (line 2). Model adds EquivalentClasses F.
    const content = [
      'Ontology(<http://example.org/ont>',   // 0
      `  Declaration(Class(<${A}>))`,         // 1
      `  SubClassOf(<${A}> <${B}>)`,         // 2
      ')',                                    // 3
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ofn'),
      makeClass([B], [F]),
      'functional',
    );

    expect(result).not.toBeNull();
    // EquivalentClasses must appear before SubClassOf in the output
    expect(result!.updatedText.indexOf('EquivalentClasses')).toBeLessThan(
      result!.updatedText.indexOf('SubClassOf'),
    );
    expect(result!.updatedText).toContain('EquivalentClasses');
    expect(result!.updatedText).toContain(`<${F}>`);
  });

  it('removes a SubClassOf without touching EquivalentClasses', async () => {
    // File: EquivalentClasses F (line 2), SubClassOf B (line 3).
    // Model removes SubClassOf B.
    const content = [
      'Ontology(<http://example.org/ont>',    // 0
      `  Declaration(Class(<${A}>))`,          // 1
      `  EquivalentClasses(<${A}> <${F}>)`,   // 2
      `  SubClassOf(<${A}> <${B}>)`,          // 3
      ')',                                     // 4
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ofn'),
      makeClass([], [F]),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).not.toContain(`SubClassOf(<${A}> <${B}>)`);
    expect(result!.updatedText).toContain(`EquivalentClasses`);
  });

  it('replaces SubClassOf B with SubClassOf C at the same position', async () => {
    // File: SubClassOf B (line 2). Model changes B → C.
    const content = [
      'Ontology(<http://example.org/ont>',   // 0
      `  Declaration(Class(<${A}>))`,         // 1
      `  SubClassOf(<${A}> <${B}>)`,         // 2
      ')',                                    // 3
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), makeClass([C]), 'functional');

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain(`<${C}>`);
    expect(result!.updatedText).not.toContain(`<${B}>`);
  });
});

// ── Manchester axiom sync (T012) ───────────────────────────────────────────────

describe('syncAxiomsManchester — idempotency (T012)', () => {
  it('does not apply edit when SubClassOf is unchanged (full-IRI form)', async () => {
    // The sync generates full-IRI form; idempotency fires when file already uses full IRIs.
    const content = [
      `Class: <${A}>`,
      `    SubClassOf: <${B}>`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.omn'), makeClass([B]), 'manchester');
    expect(result).toBeNull();
  });

  it('does not apply edit when SubClassOf and EquivalentTo are both unchanged', async () => {
    // Generator emits SubClassOf before EquivalentTo; use that order in the file.
    const content = [
      `Class: <${A}>`,
      `    SubClassOf: <${B}>`,
      `    EquivalentTo: <${F}>`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.omn'),
      makeClass([B], [F]),
      'manchester',
    );
    expect(result).toBeNull();
  });

  it('does not apply edit when class has no axioms and model has none', async () => {
    const content = [
      `Class: <${A}>`,
      `    Annotations: rdfs:label "A"@en`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.omn'), makeClass([]), 'manchester');
    expect(result).toBeNull();
  });

  it('applies edit when SubClassOf changes', async () => {
    // File has SubClassOf B; model changes to SubClassOf C.
    const content = [
      `Class: <${A}>`,
      `    SubClassOf: <${B}>`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(makeUri('test.omn'), makeClass([C]), 'manchester');
    expect(result).not.toBeNull();
  });
});

// ── Turtle combined sync — idempotency (T014) ─────────────────────────────────

function makeClassWithLabel(
  superClassIris: string[],
  label: string,
  lang = 'en',
): OWLClass {
  return {
    iri: A,
    type: 'class',
    labels: { [lang]: [label] },
    annotations: {},
    superClassIris,
    equivalentClassIris: [],
    disjointClassIris: [],
    superClassExpressions: [],
    equivalentClassExpressions: [],
    gciExpressions: [],
  };
}

describe('syncAxiomsTurtle — idempotency (T014)', () => {
  it('does not apply edit when structural and annotation content is unchanged', async () => {
    const content = [
      `<${A}> rdf:type owl:Class ;`,
      `    rdfs:subClassOf <${B}> ;`,
      `    rdfs:label "A"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ttl'),
      makeClassWithLabel([B], 'A'),
      'turtle',
    );
    expect(result).toBeNull();
  });

  it('applies edit when SubClassOf target changes', async () => {
    const content = [
      `<${A}> rdf:type owl:Class ;`,
      `    rdfs:subClassOf <${B}> ;`,
      `    rdfs:label "A"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ttl'),
      makeClassWithLabel([C], 'A'),
      'turtle',
    );
    expect(result).not.toBeNull();
  });

  it('does not apply edit when class has no label and no axioms beyond rdf:type', async () => {
    const content = [
      `<${A}> rdf:type owl:Class .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ttl'),
      makeClass([]),
      'turtle',
    );
    expect(result).toBeNull();
  });
});

// ── Turtle — annotation file-order preservation ────────────────────────────────
// These tests must FAIL before the fix: syncAxiomsTurtle rebuilds the block
// with annotation segs in model iteration order, so when the file stores
// annotations in a different order the idempotency check fails.

const DEF = 'http://www.w3.org/2004/02/skos/core#definition';
const ALT = 'http://www.w3.org/2004/02/skos/core#altLabel';

function makeClassWithLabelAndAnnot(
  superClassIris: string[],
  label: string,
  annotations: Record<string, string[]>,
): ReturnType<typeof makeClass> {
  return {
    ...makeClass(superClassIris),
    labels: { en: [label] },
    annotations,
  };
}

describe('syncAxiomsTurtle — annotation file-order preservation', () => {
  it('is idempotent when file annotation order differs from model order', async () => {
    // File: [definition, rdfs:label] — opposite of model order (labels first).
    // Model has same content. Sync must recognise key sets are equal → no edit.
    const content = [
      `<${A}> rdf:type owl:Class ;`,
      `    rdfs:subClassOf <${B}> ;`,
      `    <${DEF}> "An animal" ;`,
      `    rdfs:label "A"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ttl'),
      makeClassWithLabelAndAnnot([B], 'A', { [DEF]: ['An animal'] }),
      'turtle',
    );
    expect(result).toBeNull();
  });

  it('appends new annotation without reordering existing file-order annotations', async () => {
    // File: [definition, rdfs:label]. Model adds altLabel.
    // After sync: definition then rdfs:label (original file order), altLabel appended.
    const content = [
      `<${A}> rdf:type owl:Class ;`,
      `    rdfs:subClassOf <${B}> ;`,
      `    <${DEF}> "An animal" ;`,
      `    rdfs:label "A"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ttl'),
      makeClassWithLabelAndAnnot([B], 'A', { [DEF]: ['An animal'], [ALT]: ['creature'] }),
      'turtle',
    );
    expect(result).not.toBeNull();

    const defIdx = result!.updatedText.indexOf(`<${DEF}>`);
    const labelIdx = result!.updatedText.indexOf('rdfs:label');
    const altIdx = result!.updatedText.indexOf(`<${ALT}>`);
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(labelIdx).toBeGreaterThan(defIdx);
    expect(altIdx).toBeGreaterThan(labelIdx);
  });
});

// ── T008 (US1): syncAxiomsTurtle writes rdfs:comment abbreviated ──────────────
// These tests must FAIL before the write-path fix: abbreviateIri only handles rdfs:label.

const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

describe('syncAxiomsTurtle — rdfs:comment abbreviated (T008)', () => {
  it('writes rdfs:comment abbreviated token when adding a new rdfs:comment annotation', async () => {
    // File has only rdfs:label. Model adds rdfs:comment.
    // Expected: rebuilt block contains "rdfs:comment", not "<http://...#comment>".
    const content = [
      `<${A}> rdf:type owl:Class ;`,
      `    rdfs:subClassOf <${B}> ;`,
      `    rdfs:label "A"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAxiomsToDocument(
      makeUri('test.ttl'),
      makeClassWithLabelAndAnnot([B], 'A', { [RDFS_COMMENT]: ['An animal class'] }),
      'turtle',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain('rdfs:comment');
    expect(result!.updatedText).not.toContain('<http://www.w3.org/2000/01/rdf-schema#comment>');
  });
});

// ── T032: DL Query sync inhibition guard ──────────────────────────────────────

const GUARD_CONTENT_AX = [
  `Ontology(<http://example.org/ont>`,
  `Declaration(Class(<${A}>))`,
  `AnnotationAssertion(rdfs:label <${A}> "A")`,
  `)`,
].join('\n');

describe('syncAxiomsToDocument — DL query sync inhibition guard', () => {
  afterEach(() => { temporaryClassIris.clear(); });

  it('T032a: returns null without calling applyEdit when entity IRI is in temporaryClassIris', async () => {
    setupContent(GUARD_CONTENT_AX);
    const entity = makeClass([B]);

    temporaryClassIris.add(A);
    const result = await syncAxiomsToDocument(makeUri('test.ofn'), entity, 'functional');

    expect(result).toBeNull();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('T032b: proceeds normally when entity IRI is NOT in temporaryClassIris', async () => {
    setupContent(GUARD_CONTENT_AX);
    const entity = makeClass([B]);

    const result = await syncAxiomsToDocument(makeUri('test.ofn'), entity, 'functional');

    expect(mockWriteFile).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });
});
