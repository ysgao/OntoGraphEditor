/**
 * Principle IV benchmark — anatomy.owl (28 MB, ~302 k lines, OWL Functional Syntax).
 *
 * Verifies that entity-scoped sync functions remain sub-second on a SNOMED CT–scale
 * file.  The suite is skipped automatically when anatomy.owl is absent from the
 * repo (it is not committed; developers must obtain it separately).
 *
 * Both sync calls use a no-op fixture (model == file) so writeFile is never reached
 * and the timing captures only the scan-and-compare path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as vscode from 'vscode';
import { syncAnnotationsToDocument } from '../AnnotationSync';
import { syncAxiomsToDocument } from '../AxiomSync';
import type { OWLClass } from '../../model/OntologyModel';

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
      const k = (uri as { toString?: () => string }).toString?.() ?? String(uri);
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
    fs: { readFile: mockReadFile, writeFile: mockWriteFile },
    textDocuments: [],
    applyEdit: vi.fn().mockResolvedValue(true),
  },
  window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
}));

const ANATOMY_PATH = path.resolve(process.cwd(), 'test-ontologies/anatomy.owl');
const ANATOMY_EXISTS = fs.existsSync(ANATOMY_PATH);

const BENCH_IRI  = 'http://snomed.info/id/1003601008';
const SUPER_IRI  = 'http://snomed.info/id/244509003';
const SKOS_PREF  = 'http://www.w3.org/2004/02/skos/core#prefLabel';

const benchEntity: OWLClass = {
  iri: BENCH_IRI,
  type: 'class',
  labels: { en: ['All entire sutures of skull'] },
  annotations: { [SKOS_PREF]: ['All entire sutures of skull@en'] },
  superClassIris: [SUPER_IRI],
  equivalentClassIris: [],
  disjointClassIris: [],
  superClassExpressions: [],
  equivalentClassExpressions: [],
  gciExpressions: [],
};

function makeUri(fsPath: string): vscode.Uri {
  return { fsPath, toString: () => `file:///${fsPath}` } as unknown as vscode.Uri;
}

describe.skipIf(!ANATOMY_EXISTS)('Principle IV — anatomy.owl sync performance', () => {
  let anatomyBytes: Uint8Array;

  beforeAll(() => {
    anatomyBytes = fs.readFileSync(ANATOMY_PATH);
  });

  it('syncAnnotationsToDocument: no-op on 302k-line file completes in < 500 ms', async () => {
    mockReadFile.mockResolvedValueOnce(anatomyBytes);
    const t0 = performance.now();
    const result = await syncAnnotationsToDocument(makeUri('anatomy.ofn'), benchEntity, 'functional');
    const elapsed = performance.now() - t0;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(500);
  });

  it('syncAxiomsToDocument: no-op on 302k-line file completes in < 500 ms', async () => {
    mockReadFile.mockResolvedValueOnce(anatomyBytes);
    const t0 = performance.now();
    const result = await syncAxiomsToDocument(makeUri('anatomy.ofn'), benchEntity, 'functional');
    const elapsed = performance.now() - t0;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(500);
  });
});
