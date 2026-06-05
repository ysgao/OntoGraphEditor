import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { syncAnnotationsToDocument } from '../AnnotationSync';
import type { OWLClass } from '../../model/OntologyModel';
import { temporaryClassIris } from '../../views/DLQueryState';

// vi.hoisted ensures these are available to the vi.mock factory (which is hoisted
// before module-level variable declarations are evaluated).
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
    const editsMap = new Map<string, Array<{ range: unknown; newText: string }>>();
    const add = (uri: { toString?: () => string }, range: unknown, newText: string) => {
      const k = uri.toString?.() ?? String(uri);
      if (!editsMap.has(k)) editsMap.set(k, []);
      editsMap.get(k)!.push({ range, newText });
    };
    return {
      replace: (uri: { toString?: () => string }, range: unknown, newText: string) => add(uri, range, newText),
      insert: (uri: { toString?: () => string }, pos: unknown, newText: string) => add(uri, { start: pos, end: pos }, newText),
      delete: (uri: { toString?: () => string }, range: unknown) => add(uri, range, ''),
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
    showInformationMessage: vi.fn(),
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

const CAT = 'http://example.org#Cat';
const DEF = 'http://www.w3.org/2004/02/skos/core#definition';
const ALT = 'http://www.w3.org/2004/02/skos/core#altLabel';

function makeClass(labels: OWLClass['labels'], annotations: OWLClass['annotations']): OWLClass {
  return {
    iri: CAT,
    type: 'class',
    labels,
    annotations,
    superClassIris: [],
    equivalentClassIris: [],
    disjointClassIris: [],
    superClassExpressions: [],
    equivalentClassExpressions: [],
    gciExpressions: [],
  };
}

// ── Original integration test (preserved) ─────────────────────────────────────

describe('AnnotationSync Clustered Functional Syntax', () => {
  it('should sync annotations into an existing entity cluster', async () => {
    const content = `Ontology(<http://example.org/ont>
  Declaration(Class(<http://example.org#A>))

  # Class: <http://example.org#A> (Class A)
  AnnotationAssertion(rdfs:label <http://example.org#A> "Class A")

  SubClassOf(<http://example.org#A> <http://example.org#B>)
)`;

    setupContent(content);

    const entity: OWLClass = {
      iri: 'http://example.org#A',
      type: 'class',
      labels: { en: ['Updated Label'] },
      annotations: {},
      superClassIris: ['http://example.org#B'],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
    };

    const result = await syncAnnotationsToDocument(makeUri('test.ofn'), entity, 'functional');
    expect(result).not.toBeNull();
  });
});

// ── T002: syncFunctional idempotency ──────────────────────────────────────────
// These tests must FAIL before implementing the diff-based sync (Red phase).

describe('syncFunctional — idempotency (T002)', () => {
  it('does not apply any edit when model annotation matches file (same single label)', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  # Class: <${CAT}>`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(makeUri('test.ofn'), makeClass({ en: ['Cat'] }, {}), 'functional');

    expect(result).toBeNull();
  });

  it('does not apply any edit when annotations are identical but in non-model order (definition before label)', async () => {
    // File stores <definition> BEFORE rdfs:label — the opposite of model enumeration order.
    // A correct idempotent sync must NOT reorder them.
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  # Class: <${CAT}>`,
      `  AnnotationAssertion(<${DEF}> <${CAT}> "A domestic feline")`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'] }),
      'functional',
    );

    expect(result).toBeNull();
  });

  it('does not apply any edit when entity has no annotations and file has none', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  SubClassOf(<${CAT}> <http://example.org#Animal>)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(makeUri('test.ofn'), makeClass({}, {}), 'functional');

    expect(result).toBeNull();
  });

  it('does not apply any edit for multiple annotations in non-model order', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  AnnotationAssertion(<${ALT}> <${CAT}> "kitty")`,
      `  AnnotationAssertion(<${DEF}> <${CAT}> "A domestic feline")`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'], [ALT]: ['kitty'] }),
      'functional',
    );

    expect(result).toBeNull();
  });
});

// ── T003: syncFunctional order-preservation and minimal diff ──────────────────
// These tests must FAIL before implementing the diff-based sync (Red phase).

describe('syncFunctional — order-preservation and minimal diff (T003)', () => {
  it('inserts new annotation after last existing without reordering', async () => {
    // File: [definition (line 3), rdfs:label (line 4)] — non-model order.
    // Model adds altLabel.
    // Expected: exactly one insert at line 5, zero deletes, zero replaces.
    const content = [
      'Ontology(<http://example.org/ont>',                             // 0
      `  Declaration(Class(<${CAT}>))`,                                // 1
      `  # Class: <${CAT}>`,                                           // 2
      `  AnnotationAssertion(<${DEF}> <${CAT}> "A domestic feline")`,  // 3
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,           // 4
      `  SubClassOf(<${CAT}> <http://example.org#Animal>)`,            // 5
      ')',                                                              // 6
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'], [ALT]: ['kitty'] }),
      'functional',
    );

    expect(result).not.toBeNull();
    // Inserted text must contain the new altLabel annotation
    expect(result!.updatedText).toContain(`<${ALT}>`);
    expect(result!.updatedText).toContain('"kitty"');
  });

  it('deletes removed annotation without touching any other line', async () => {
    // File: [rdfs:label (line 3), definition (line 4)].
    // Model removes definition.
    // Expected: exactly one delete, zero inserts, zero replaces.
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  # Class: <${CAT}>`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,    // 3
      `  AnnotationAssertion(<${DEF}> <${CAT}> "A cat")`,       // 4
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, {}),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).not.toContain(`<${DEF}>`);
  });

  it('inserts first annotation to entity that had none', async () => {
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  SubClassOf(<${CAT}> <http://example.org#Animal>)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, {}),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain('rdfs:label');
  });

  it('simultaneously inserts added and deletes removed, preserving unchanged', async () => {
    // File: [rdfs:label, definition]. Model replaces definition with altLabel.
    // Expected: one insert (altLabel) + one delete (definition), zero replaces.
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,     // 2
      `  AnnotationAssertion(<${DEF}> <${CAT}> "A cat")`,        // 3
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, { [ALT]: ['kitty'] }),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain(`<${ALT}>`);
    expect(result!.updatedText).not.toContain(`<${DEF}>`);
  });
});

// ── T005: syncManchester idempotency ──────────────────────────────────────────
// These tests expose the trailing-newline mismatch in the Manchester idempotency
// check (existingBlock includes trailing empty lines; newAnnotBlock does not).

describe('syncManchester — idempotency (T005)', () => {
  it('does not apply edit when file already has the exact generated annotation block', async () => {
    // The generator produces: "    Annotations:\n        rdfs:label \"Cat\"@en"
    // followed by a SubClassOf section (no trailing empty line before it).
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      '        rdfs:label "Cat"@en',
      `    SubClassOf: <http://example.org#Animal>`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, {}),
      'manchester',
    );

    expect(result).toBeNull();
  });

  it('does not apply edit when file has annotation block followed by trailing empty line only', async () => {
    // No subsequent section — existingBlock ends with trailing newline from empty line.
    // This is the common case for the last entity in a file.
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      '        rdfs:label "Cat"@en',
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, {}),
      'manchester',
    );

    expect(result).toBeNull();
  });

  it('does not apply edit when multiple annotations match in file order', async () => {
    // Generator order: labels first, then other annotations.
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      `        rdfs:label "Cat"@en,`,
      `        <${DEF}> "A domestic feline"`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'] }),
      'manchester',
    );

    expect(result).toBeNull();
  });

  it('does apply edit when Manchester annotation is changed', async () => {
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      '        rdfs:label "OldCat"@en',
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, {}),
      'manchester',
    );

    expect(result).not.toBeNull();
  });
});

// ── T006: syncManchester file-order preservation ──────────────────────────────
// These tests must FAIL before the fix: the current full-text comparison
// generates a model-order block which differs from a file that stores
// annotations in a different order, causing a spurious rewrite.

describe('syncManchester — file-order preservation (T006)', () => {
  it('is idempotent when file annotation order differs from model order', async () => {
    // File: [definition, rdfs:label] — opposite of model iteration order.
    // Model iterates labels first, then annotations by IRI key.
    // A correct sync must recognise the key sets are equal and return null.
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      `        <${DEF}> "A domestic feline",`,
      `        rdfs:label "Cat"@en`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'] }),
      'manchester',
    );

    expect(result).toBeNull();
  });

  it('appends new annotation without reordering existing file-order annotations', async () => {
    // File: [definition, rdfs:label] — reverse model order.
    // Model adds altLabel. Existing two annotations must stay in file order.
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      `        <${DEF}> "A domestic feline",`,
      `        rdfs:label "Cat"@en`,
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'], [ALT]: ['kitty'] }),
      'manchester',
    );

    expect(result).not.toBeNull();
    // The replaced text must contain definition before rdfs:label (file order)
    // and altLabel appended at the end.
    const updatedText = result!.updatedText;
    const defIdx = updatedText.indexOf(`<${DEF}>`);
    const labelIdx = updatedText.indexOf('rdfs:label');
    const altIdx = updatedText.indexOf(`<${ALT}>`);
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(labelIdx).toBeGreaterThan(defIdx);
    expect(altIdx).toBeGreaterThan(labelIdx);
  });
});

// ── T008: syncTurtle file-order preservation ──────────────────────────────────
// Same class of bug: model-order annotation segs in rebuilt block differ from
// a file that stores annotations in a different order.

describe('syncTurtle — file-order preservation (T008)', () => {
  it('is idempotent when file annotation order differs from model order', async () => {
    // File: [definition, rdfs:label] — opposite of model iteration order.
    const content = TTL_PREFIX + [
      `<${CAT}> rdf:type owl:Class ;`,
      `    <${DEF}> "A domestic feline" ;`,
      `    rdfs:label "Cat"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ttl'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'] }),
      'turtle',
    );

    expect(result).toBeNull();
  });

  it('appends new annotation without reordering existing file-order annotations', async () => {
    // File: [definition, rdfs:label]. Model adds altLabel.
    const content = TTL_PREFIX + [
      `<${CAT}> rdf:type owl:Class ;`,
      `    <${DEF}> "A domestic feline" ;`,
      `    rdfs:label "Cat"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ttl'),
      makeClass({ en: ['Cat'] }, { [DEF]: ['A domestic feline'], [ALT]: ['kitty'] }),
      'turtle',
    );

    expect(result).not.toBeNull();
    const updatedText = result!.updatedText;
    const defIdx = updatedText.indexOf(`<${DEF}>`);
    const labelIdx = updatedText.indexOf('rdfs:label');
    const altIdx = updatedText.indexOf(`<${ALT}>`);
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(labelIdx).toBeGreaterThan(defIdx);
    expect(altIdx).toBeGreaterThan(labelIdx);
  });
});

// ── T002 (US1): rdfs:comment abbreviated IRI — Red phase ─────────────────────
// These tests must FAIL before the fix: abbreviateIri only handles rdfs:label.

const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

describe('syncFunctional — rdfs:comment abbreviated (T004)', () => {
  it('writes rdfs:comment abbreviated token when adding a new rdfs:comment annotation', async () => {
    // File has only rdfs:label. Model adds rdfs:comment.
    // Expected: written line contains "rdfs:comment", not "<http://...#comment>".
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  # Class: <${CAT}>`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, { [RDFS_COMMENT]: ['A domestic feline'] }),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain('rdfs:comment');
    expect(result!.updatedText).not.toContain('<http://www.w3.org/2000/01/rdf-schema#comment>');
  });
});

describe('syncManchester — rdfs:comment abbreviated (T006)', () => {
  it('writes rdfs:comment abbreviated token when adding a new rdfs:comment annotation', async () => {
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      '        rdfs:label "Cat"@en',
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, { [RDFS_COMMENT]: ['A domestic feline'] }),
      'manchester',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).toContain('rdfs:comment');
    expect(result!.updatedText).not.toContain('<http://www.w3.org/2000/01/rdf-schema#comment>');
  });
});

// ── T010/T012 (US2): round-trip fidelity when file already has rdfs:comment ──
// These tests must FAIL before the read-path fix: parsers don't recognise
// the 'rdfs:comment' abbreviated token unless the rdfs: prefix is in the map.

describe('syncFunctional — idempotent with rdfs:comment in file (T010)', () => {
  it('is a no-op when file already contains AnnotationAssertion(rdfs:comment ...) with no prefix map', async () => {
    // No Prefix(rdfs:=<...>) declaration in this file — relies on RDFS_TOKEN_TO_IRI map.
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  # Class: <${CAT}>`,
      `  AnnotationAssertion(rdfs:label <${CAT}> "Cat"@en)`,
      `  AnnotationAssertion(rdfs:comment <${CAT}> "A domestic feline")`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({ en: ['Cat'] }, { [RDFS_COMMENT]: ['A domestic feline'] }),
      'functional',
    );

    expect(result).toBeNull();
  });
});

describe('syncManchester — idempotent with rdfs:comment in file (T012)', () => {
  it('is a no-op when file already contains rdfs:comment abbreviated token with no prefix map', async () => {
    // No Prefix: rdfs: <...> declaration — relies on RDFS_TOKEN_TO_IRI map.
    const content = [
      `Class: <${CAT}>`,
      '    Annotations:',
      '        rdfs:label "Cat"@en,',
      '        rdfs:comment "A domestic feline"',
      '',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.omn'),
      makeClass({ en: ['Cat'] }, { [RDFS_COMMENT]: ['A domestic feline'] }),
      'manchester',
    );

    expect(result).toBeNull();
  });
});

// ── T007: syncTurtle annotation idempotency ───────────────────────────────────

// Minimal prefix header used by all Turtle tests — matches what real .ttl files have.
const TTL_PREFIX = [
  '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
  '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
  '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
  '',
].join('\n');

describe('syncTurtle — annotation idempotency (T007)', () => {
  it('does not apply edit when annotation is unchanged', async () => {
    const content = TTL_PREFIX + [
      `<${CAT}> rdf:type owl:Class ;`,
      `    rdfs:label "Cat"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ttl'),
      makeClass({ en: ['Cat'] }, {}),
      'turtle',
    );

    expect(result).toBeNull();
  });

  it('does not apply edit when annotation and structural segs are both unchanged', async () => {
    const content = TTL_PREFIX + [
      `<${CAT}> rdf:type owl:Class ;`,
      `    rdfs:subClassOf <http://example.org#Animal> ;`,
      `    rdfs:label "Cat"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ttl'),
      makeClass({ en: ['Cat'] }, {}),
      'turtle',
    );

    expect(result).toBeNull();
  });

  it('does not apply edit when entity has no annotations and file has none', async () => {
    const content = TTL_PREFIX + [
      `<${CAT}> rdf:type owl:Class .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ttl'),
      makeClass({}, {}),
      'turtle',
    );

    expect(result).toBeNull();
  });

  it('does apply edit when annotation label changes', async () => {
    const content = TTL_PREFIX + [
      `<${CAT}> rdf:type owl:Class ;`,
      `    rdfs:label "OldCat"@en .`,
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ttl'),
      makeClass({ en: ['Cat'] }, {}),
      'turtle',
    );

    expect(result).not.toBeNull();
  });
});

// ── Multi-line annotation value (real newlines, no \n escape) ─────────────────

describe('syncFunctional — multi-line annotation values', () => {
  it('is idempotent when a multi-line annotation already matches the model', async () => {
    const multiLineValue = 'First line.\nSecond line.';
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      `  AnnotationAssertion(<${DEF}> <${CAT}> "First line.`,
      `Second line.")`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({}, { [DEF]: [multiLineValue] }),
      'functional',
    );

    expect(result).toBeNull();
  });

  it('inserts a multi-line annotation value with real newlines (no \\n escape)', async () => {
    const multiLineValue = 'First line.\nSecond line.';
    const content = [
      'Ontology(<http://example.org/ont>',
      `  Declaration(Class(<${CAT}>))`,
      ')',
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({}, { [DEF]: [multiLineValue] }),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).not.toContain('\\n');
    expect(result!.updatedText).toContain('First line.\nSecond line.');
  });

  it('deletes a multi-line annotation that spans two physical lines', async () => {
    // The annotation "First line.\nSecond line." occupies lines 2 and 3 (0-indexed).
    const content = [
      'Ontology(<http://example.org/ont>',   // 0
      `  Declaration(Class(<${CAT}>))`,       // 1
      `  AnnotationAssertion(<${DEF}> <${CAT}> "First line.`,  // 2
      `Second line.")`,                        // 3
      ')',                                     // 4
    ].join('\n');

    setupContent(content);
    const result = await syncAnnotationsToDocument(
      makeUri('test.ofn'),
      makeClass({}, {}),
      'functional',
    );

    expect(result).not.toBeNull();
    expect(result!.updatedText).not.toContain(`<${DEF}>`);
  });
});

// ── T032: DL Query sync inhibition guard ──────────────────────────────────────

const GUARD_IRI = 'http://example.org#A';
const GUARD_CONTENT = `Ontology(<http://example.org/ont>
  Declaration(Class(<${GUARD_IRI}>))

  # Class: <${GUARD_IRI}> (Original)
  AnnotationAssertion(rdfs:label <${GUARD_IRI}> "Original")
)`;

function makeGuardEntity(label: string): OWLClass {
  return {
    iri: GUARD_IRI,
    type: 'class',
    labels: { '': [label] },
    annotations: {},
    superClassIris: [],
    equivalentClassIris: [],
    disjointClassIris: [],
    superClassExpressions: [],
    equivalentClassExpressions: [],
    gciExpressions: [],
  };
}

describe('syncAnnotationsToDocument — DL query sync inhibition guard', () => {
  afterEach(() => { temporaryClassIris.clear(); });

  it('T032a: returns null without calling writeFile when entity IRI is in temporaryClassIris', async () => {
    const entity = makeGuardEntity('Updated');

    temporaryClassIris.add(GUARD_IRI);
    const result = await syncAnnotationsToDocument(makeUri('test.ofn'), entity, 'functional');

    expect(result).toBeNull();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('T032b: proceeds normally when entity IRI is NOT in temporaryClassIris', async () => {
    setupContent(GUARD_CONTENT);
    const entity = makeGuardEntity('Updated');

    const result = await syncAnnotationsToDocument(makeUri('test.ofn'), entity, 'functional');

    expect(mockWriteFile).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });
});
