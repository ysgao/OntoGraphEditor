import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadOntologyFile } from './loadOntologyFile';
import type { OntologyModel } from '../model/OntologyModel';

const {
  mockShowOpenDialog,
  mockReadFile,
  mockStat,
  mockWithProgress,
  mockShowInformationMessage,
  mockShowErrorMessage,
  mockParseAsync,
} = vi.hoisted(() => ({
  mockShowOpenDialog: vi.fn(),
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowInformationMessage: vi.fn(),
  mockShowErrorMessage: vi.fn(),
  mockParseAsync: vi.fn(),
}));

vi.mock('../parser/ParserRegistry', () => ({
  ParserRegistry: { parseAsync: mockParseAsync },
}));

vi.mock('vscode', () => ({
  window: {
    showOpenDialog: mockShowOpenDialog,
    showInformationMessage: mockShowInformationMessage,
    showErrorMessage: mockShowErrorMessage,
    withProgress: mockWithProgress,
  },
  workspace: {
    fs: { readFile: mockReadFile, stat: mockStat },
  },
  ProgressLocation: { Notification: 15 },
}));

const fakeUri = { fsPath: '/test/animals.ofn', toString: () => 'file:///test/animals.ofn' };
const fakeBytes = new TextEncoder().encode('Ontology(<http://example.org/animals>)');
const fakeModel = { sourceUri: 'file:///test/animals.ofn' } as unknown as OntologyModel;

describe('loadOntologyFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowOpenDialog.mockResolvedValue([fakeUri]);
    mockReadFile.mockResolvedValue(fakeBytes);
    mockStat.mockResolvedValue({ mtime: 1000, size: fakeBytes.length, type: 1, ctime: 0 });
    mockParseAsync.mockResolvedValue(fakeModel);
    mockWithProgress.mockImplementation(
      (_opts: unknown, task: () => Promise<void>) => task(),
    );
  });

  // T001 — file picker, read, parse, onLoaded, error paths, isLoading guard

  it('opens file picker with ontology extension filter', async () => {
    await loadOntologyFile(vi.fn());
    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { 'Ontology Files': ['owl', 'ofn', 'omn', 'ttl', 'owx', 'n3'] },
      }),
    );
  });

  it('reads the selected file via workspace.fs.readFile', async () => {
    await loadOntologyFile(vi.fn());
    expect(mockReadFile).toHaveBeenCalledWith(fakeUri);
  });

  it('always passes auto langId to parseAsync regardless of file extension', async () => {
    await loadOntologyFile(vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(
      'Ontology(<http://example.org/animals>)',
      'auto',
      fakeUri.toString(),
    );
  });

  it('passes auto langId for .owl file (content detection, not extension)', async () => {
    const owlUri = { fsPath: '/test/pizza.owl', toString: () => 'file:///test/pizza.owl' };
    mockShowOpenDialog.mockResolvedValueOnce([owlUri]);
    await loadOntologyFile(vi.fn());
    expect(mockParseAsync).toHaveBeenCalledWith(expect.any(String), 'auto', owlUri.toString());
  });

  it('calls onLoaded with parsed model on success', async () => {
    const onLoaded = vi.fn();
    await loadOntologyFile(onLoaded);
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(onLoaded).toHaveBeenCalledWith(fakeModel);
  });

  it('returns silently and does not read file when picker is cancelled (undefined)', async () => {
    mockShowOpenDialog.mockResolvedValueOnce(undefined);
    const onLoaded = vi.fn();
    await loadOntologyFile(onLoaded);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('returns silently and does not read file when picker returns empty array', async () => {
    mockShowOpenDialog.mockResolvedValueOnce([]);
    const onLoaded = vi.fn();
    await loadOntologyFile(onLoaded);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('shows info message and does not call parseAsync on second concurrent invocation', async () => {
    let resolveRead!: (v: Uint8Array) => void;
    const hangingRead = new Promise<Uint8Array>(res => { resolveRead = res; });
    mockReadFile.mockReturnValueOnce(hangingRead);

    const prefillUri = fakeUri;
    const onLoaded = vi.fn();

    const first = loadOntologyFile(onLoaded, prefillUri as never);
    // isLoading is now true (set synchronously before any await)
    const second = loadOntologyFile(onLoaded, prefillUri as never);

    await second;
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'OntoGraph: a load is already in progress.',
    );
    expect(mockParseAsync).not.toHaveBeenCalled();

    resolveRead(fakeBytes);
    await first;
  });

  it('shows named read error when workspace.fs.readFile throws', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));
    await loadOntologyFile(vi.fn());
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("failed to read 'animals.ofn'"),
    );
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('ENOENT: no such file'),
    );
  });

  it('shows format error when parseAsync throws "Could not detect"', async () => {
    mockParseAsync.mockRejectedValueOnce(
      new Error('Could not detect OWL serialisation format for: /test/animals.ofn'),
    );
    await loadOntologyFile(vi.fn());
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("cannot detect ontology format for 'animals.ofn'"),
    );
  });

  it('shows parse error when parseAsync throws for other reasons', async () => {
    mockParseAsync.mockRejectedValueOnce(new Error('syntax error at token @@'));
    await loadOntologyFile(vi.fn());
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse 'animals.ofn'"),
    );
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('syntax error at token @@'),
    );
  });

  it('skips file picker and uses prefillUri directly', async () => {
    const prefillUri = { fsPath: '/test/large.owl', toString: () => 'file:///test/large.owl' };
    await loadOntologyFile(vi.fn(), prefillUri as never);
    expect(mockShowOpenDialog).not.toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalledWith(prefillUri);
  });

  it('does not call onLoaded when read fails', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('permission denied'));
    const onLoaded = vi.fn();
    await loadOntologyFile(onLoaded);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('does not call onLoaded when parse fails', async () => {
    mockParseAsync.mockRejectedValueOnce(new Error('parse failure'));
    const onLoaded = vi.fn();
    await loadOntologyFile(onLoaded);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  // T002 — withProgress called with ProgressLocation.Notification and filename in title

  it('wraps load in withProgress with ProgressLocation.Notification and filename in title', async () => {
    await loadOntologyFile(vi.fn());
    expect(mockWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 15,
        title: expect.stringContaining('animals.ofn'),
      }),
      expect.any(Function),
    );
  });

  it('withProgress title contains filename from prefillUri', async () => {
    const prefillUri = { fsPath: '/large/snomed.owl', toString: () => 'file:///large/snomed.owl' };
    await loadOntologyFile(vi.fn(), prefillUri as never);
    expect(mockWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('snomed.owl') }),
      expect.any(Function),
    );
  });
});

// T014 — benchmark (skip if bfo-core.ofn absent)
import * as fs from 'fs';
import * as path from 'path';

const bfoPath = path.join(__dirname, '../../test-ontologies/bfo-core.ofn');
const hasBfo = fs.existsSync(bfoPath);

describe.skipIf(!hasBfo)('loadOntologyFile benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithProgress.mockImplementation(
      (_opts: unknown, task: () => Promise<void>) => task(),
    );
  });

  it('loads bfo-core.ofn in under 5 seconds using real parser', async () => {
    const { ParserRegistry: RealRegistry } =
      await vi.importActual<typeof import('../parser/ParserRegistry')>('../parser/ParserRegistry');

    const bfoBytes = new Uint8Array(fs.readFileSync(bfoPath));
    mockReadFile.mockResolvedValueOnce(bfoBytes);
    mockParseAsync.mockImplementationOnce(
      (text: string, langId: string, uri: string) =>
        RealRegistry.parseAsync(text, langId, uri),
    );

    const bfoUri = { fsPath: bfoPath, toString: () => `file://${bfoPath}` };
    mockShowOpenDialog.mockResolvedValueOnce([bfoUri]);

    let loadedModel: OntologyModel | undefined;
    const start = Date.now();
    await loadOntologyFile(m => { loadedModel = m; });
    const elapsed = Date.now() - start;

    expect(loadedModel).toBeDefined();
    expect(loadedModel!.classes.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);
  });
});
