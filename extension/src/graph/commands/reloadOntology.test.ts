import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reloadOntology } from './reloadOntology';
import type { OntologyModel } from '../model/OntologyModel';

/**
 * T012 — Regression tests for the reloadOntology refactor (T013).
 * After T013, reloadOntology MUST:
 *   - Use vscode.workspace.fs.readFile (not openTextDocument) for all file reads
 *   - Derive language ID from sourceUri path (not from TextDocument.languageId)
 *
 * Also documents the Regression Safety scenarios from plan.md:
 *   Scenario 1: fs.readFile called; openTextDocument NOT called; model updated
 *   Scenario 2: After reload, rawContent on model matches file content
 *                → handleDocument's rawContent check can skip re-parse (verified by model.rawContent)
 *   Scenario 3: After reload with changed content, model.rawContent reflects new content
 *   Scenarios 4/5: reloadGuard and parsedDocVersions are not touched by reloadOntology itself
 *                  (they are wired in extension.ts); verified by their own unit tests
 */

const {
  mockReadFile,
  mockStat,
  mockShowErrorMessage,
  mockParseAsync,
  mockOpenTextDocument,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockShowErrorMessage: vi.fn(),
  mockParseAsync: vi.fn(),
  mockOpenTextDocument: vi.fn(),
}));

vi.mock('../parser/ParserRegistry', () => ({
  ParserRegistry: { parseAsync: mockParseAsync },
}));

vi.mock('vscode', () => ({
  workspace: {
    fs: { readFile: mockReadFile, stat: mockStat },
    openTextDocument: mockOpenTextDocument,
  },
  window: {
    showErrorMessage: mockShowErrorMessage,
  },
  Uri: {
    parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s, path: s })),
  },
}));

const fileContent = 'Prefix(:=<http://example.org/animals#>)\nOntology(<http://example.org/animals>)';
const fileBytes = new TextEncoder().encode(fileContent);

function makeModel(sourceUri: string, sourceFormat = 'functional'): OntologyModel {
  return { sourceUri, sourceFormat } as unknown as OntologyModel;
}

function makeParsedModel(sourceUri: string, rawContent: string): OntologyModel {
  return { sourceUri, rawContent } as unknown as OntologyModel;
}

describe('reloadOntology — T012 regression tests (post-T013)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(fileBytes);
    mockStat.mockResolvedValue({ mtime: 1000, size: fileBytes.length, type: 1, ctime: 0 });
    mockParseAsync.mockResolvedValue(makeParsedModel('file:///test/animals.ofn', fileContent));
  });

  // --- Scenario 1: workspace.fs.readFile replaces openTextDocument ---

  it('calls workspace.fs.readFile with URI derived from sourceUri', async () => {
    const model = makeModel('file:///test/animals.ofn');
    await reloadOntology(model, vi.fn());
    expect(mockReadFile).toHaveBeenCalledOnce();
    const calledUri = mockReadFile.mock.calls[0][0];
    expect(calledUri.toString()).toBe('file:///test/animals.ofn');
  });

  it('does NOT call openTextDocument', async () => {
    const model = makeModel('file:///test/animals.ofn');
    await reloadOntology(model, vi.fn());
    expect(mockOpenTextDocument).not.toHaveBeenCalled();
  });

  it('calls parseAsync with decoded text content', async () => {
    const model = makeModel('file:///test/animals.ofn');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(
      fileContent,
      expect.any(String),
      'file:///test/animals.ofn',
    );
  });

  it('calls onReloaded with the parsed model on success', async () => {
    const model = makeModel('file:///test/animals.ofn');
    const onReloaded = vi.fn();
    await reloadOntology(model, onReloaded);
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  // --- Language ID derived from model.sourceFormat (set at initial load, not re-detected) ---

  it('passes owl-functional langId for sourceFormat=functional', async () => {
    const model = makeModel('file:///test/animals.ofn', 'functional');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'owl-functional', expect.any(String));
  });

  it('passes manchester langId for sourceFormat=manchester', async () => {
    const model = makeModel('file:///test/animals.omn', 'manchester');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'manchester', expect.any(String));
  });

  it('passes owl-xml langId for sourceFormat=owl-xml (direct dispatch, no re-detection)', async () => {
    const model = makeModel('file:///test/pizza.owl', 'owl-xml');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'owl-xml', expect.any(String));
  });

  it('passes owl-xml langId for sourceFormat=rdf-xml (detectOwlFormat identifies <rdf:RDF in ≤2000 bytes)', async () => {
    const model = makeModel('file:///test/ont.rdf', 'rdf-xml');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'owl-xml', expect.any(String));
  });

  it('passes turtle langId for sourceFormat=turtle', async () => {
    const model = makeModel('file:///test/ont.ttl', 'turtle');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'turtle', expect.any(String));
  });

  it('passes auto langId for unknown sourceFormat (falls back to content detection)', async () => {
    const model = makeModel('file:///test/ont.unknown', 'unknown-format');
    await reloadOntology(model, vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'auto', expect.any(String));
  });

  // --- Scenario 2: rawContent on reloaded model matches file content ---
  // This allows handleDocument's rawContent check to skip re-parse when file content unchanged

  it('reloaded model has rawContent matching the decoded file bytes (enables rawContent guard)', async () => {
    const updatedContent = 'Ontology(<http://example.org/updated>)';
    const updatedBytes = new TextEncoder().encode(updatedContent);
    mockReadFile.mockResolvedValueOnce(updatedBytes);
    mockParseAsync.mockResolvedValueOnce(makeParsedModel('file:///test/animals.ofn', updatedContent));

    const model = makeModel('file:///test/animals.ofn');
    let reloadedModel: OntologyModel | undefined;
    await reloadOntology(model, m => { reloadedModel = m; });

    expect(reloadedModel?.rawContent).toBe(updatedContent);
  });

  // --- Scenario 3: changed content → new rawContent reflects change ---

  it('successive reloads with different content produce different rawContent', async () => {
    const content1 = 'Ontology(<http://example.org/v1>)';
    const content2 = 'Ontology(<http://example.org/v2>)';

    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(content1));
    mockParseAsync.mockResolvedValueOnce(makeParsedModel('file:///test/ont.ofn', content1));
    const model = makeModel('file:///test/ont.ofn');
    let m1: OntologyModel | undefined;
    await reloadOntology(model, m => { m1 = m; });

    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(content2));
    mockParseAsync.mockResolvedValueOnce(makeParsedModel('file:///test/ont.ofn', content2));
    let m2: OntologyModel | undefined;
    await reloadOntology(model, m => { m2 = m; });

    expect(m1?.rawContent).toBe(content1);
    expect(m2?.rawContent).toBe(content2);
    expect(m1?.rawContent).not.toBe(m2?.rawContent);
  });

  // --- Error handling ---

  it('shows error and does not call onReloaded when readFile throws', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: file not found'));
    const onReloaded = vi.fn();
    await reloadOntology(makeModel('file:///test/missing.ofn'), onReloaded);
    expect(onReloaded).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('ENOENT: file not found'),
    );
  });

  it('shows error and does not call onReloaded when parseAsync throws', async () => {
    mockParseAsync.mockRejectedValueOnce(new Error('syntax error'));
    const onReloaded = vi.fn();
    await reloadOntology(makeModel('file:///test/broken.ofn'), onReloaded);
    expect(onReloaded).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('syntax error'),
    );
  });
});
