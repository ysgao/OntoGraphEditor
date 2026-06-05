import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPostMessage,
  mockReveal,
  mockOnDispose,
  mockOnMessage,
  mockCreateWebviewPanel,
  mockDlQuery,
} = vi.hoisted(() => {
  const mockPostMessage        = vi.fn();
  const mockReveal             = vi.fn();
  const mockOnDispose          = vi.fn();
  const mockOnMessage          = vi.fn();
  const mockDlQuery            = vi.fn();
  const mockCreateWebviewPanel = vi.fn(() => ({
    webview: {
      html: '',
      postMessage:         mockPostMessage,
      onDidReceiveMessage: mockOnMessage,
      asWebviewUri:        vi.fn((u: unknown) => u),
      cspSource:           'vscode-resource:',
    },
    reveal:       mockReveal,
    onDidDispose: mockOnDispose,
  }));
  return { mockPostMessage, mockReveal, mockOnDispose, mockOnMessage, mockCreateWebviewPanel, mockDlQuery };
});

vi.mock('vscode', () => ({
  window: { createWebviewPanel: mockCreateWebviewPanel },
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: vi.fn((_base: unknown, ...parts: string[]) => parts.join('/')) },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })), textDocuments: [] },
}));

vi.mock('../reasoner/ReasonerBridge.js', () => ({
  ReasonerBridge: vi.fn().mockImplementation(() => ({ dlQuery: mockDlQuery })),
}));

import { openDLQueryPanel, updateDLQueryModel } from './DLQueryPanel.js';
import type { DLQueryWebviewToExt } from './DLQueryMessages.js';
import type { OntologyModel } from '../model/OntologyModel.js';
import type { ReasonerBridge } from '../reasoner/ReasonerBridge.js';
import type { ExtensionContext } from 'vscode';

const fakeContext = { extensionUri: 'fake-uri', subscriptions: [] } as unknown as ExtensionContext;
const fakeBridge  = { dlQuery: mockDlQuery } as unknown as ReasonerBridge;
const fakeReveal  = vi.fn();
const fakeModel: OntologyModel   = {
  classes: new Map(), individuals: new Map(),
  objectProperties: new Map(), dataProperties: new Map(), annotationProperties: new Map(),
  metadata: { imports: [], annotations: {} },
  sourceUri: '', rawContent: '', sourceFormat: 'functional',
  standaloneGcis: [], inferredSubClasses: new Map(),
  isClassified: false, classificationNeedsUpdate: false,
} as unknown as OntologyModel;

function getMessageHandler(): (msg: DLQueryWebviewToExt) => void {
  const [[handler]] = mockOnMessage.mock.calls as [[(msg: DLQueryWebviewToExt) => void]];
  return handler;
}

describe('DLQueryPanel', () => {
  beforeEach(() => {
    // Fire dispose BEFORE clearing mocks so the singleton resets its panel variable
    if (mockOnDispose.mock.calls.length > 0) {
      const disposeCallback = (mockOnDispose.mock.calls[0] as [() => void])[0];
      if (typeof disposeCallback === 'function') { disposeCallback(); }
    }
    vi.clearAllMocks();
    mockCreateWebviewPanel.mockReturnValue({
      webview: {
        html: '',
        postMessage:         mockPostMessage,
        onDidReceiveMessage: mockOnMessage,
        asWebviewUri:        vi.fn((u: unknown) => u),
        cspSource:           'vscode-resource:',
      },
      reveal:       mockReveal,
      onDidDispose: mockOnDispose,
    });
  });

  it('creates a webview panel with viewType ontograph.dlQuery', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    expect(mockCreateWebviewPanel).toHaveBeenCalledOnce();
    const [viewType] = mockCreateWebviewPanel.mock.calls[0] as unknown as [string, ...unknown[]];
    expect(viewType).toBe('ontograph.dlQuery');
  });

  it('reveals existing panel instead of creating a new one on second call', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    expect(mockCreateWebviewPanel).toHaveBeenCalledOnce();
    expect(mockReveal).toHaveBeenCalledOnce();
  });

  it('posts ontologyStatus hasOntology:true on ready when model is loaded', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'ready' });
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ontologyStatus', hasOntology: true }),
    );
  });

  it('posts ontologyStatus hasOntology:false on ready when model is undefined', () => {
    openDLQueryPanel(fakeContext, fakeBridge, undefined, undefined, fakeReveal);
    getMessageHandler()({ type: 'ready' });
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ontologyStatus', hasOntology: false }),
    );
  });

  it('posts dlQueryLoading immediately on execute message', () => {
    mockDlQuery.mockResolvedValueOnce({
      directSuperClasses: [], superClasses: [], equivalentClasses: [],
      directSubClasses: [], subClasses: [], instances: [],
    });
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });
    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'dlQueryLoading' });
  });

  it('calls bridge.dlQuery with classExpression and queryTypes on execute', async () => {
    mockDlQuery.mockResolvedValueOnce({
      directSuperClasses: ['http://example.org/Animal'],
      superClasses: [], equivalentClasses: [], directSubClasses: [], subClasses: [], instances: [],
    });
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(
      ([m]) => (m as { type: string }).type === 'dlQueryResult',
    ));

    expect(mockDlQuery).toHaveBeenCalledWith(
      expect.any(String), expect.anything(), null, 'Dog', ['directSuperClasses'], 'auto',
    );
  });

  it('posts dlQueryResult with grouped entities after execute succeeds', async () => {
    mockDlQuery.mockResolvedValueOnce({
      directSuperClasses: ['http://example.org/Animal'],
      superClasses: [], equivalentClasses: [], directSubClasses: [], subClasses: [], instances: [],
    });
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(
      ([m]) => (m as { type: string }).type === 'dlQueryResult',
    ));

    const [resultMsg] = mockPostMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'dlQueryResult',
    )! as [{ type: string; groups: { queryType: string; entities: { iri: string }[] }[] }];
    expect(resultMsg.groups[0]!.queryType).toBe('directSuperClasses');
    expect(resultMsg.groups[0]!.entities[0]!.iri).toBe('http://example.org/Animal');
  });

  it('posts dlQueryError when bridge.dlQuery rejects', async () => {
    mockDlQuery.mockRejectedValueOnce(new Error('Parse error: unexpected token'));
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'BadExpr', queryTypes: ['subClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(
      ([m]) => (m as { type: string }).type === 'dlQueryError',
    ));

    const [errMsg] = mockPostMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'dlQueryError',
    )! as [{ type: string; message: string }];
    expect(errMsg.message).toContain('Parse error');
  });

  it('calls revealFn with iri and entityType on navigate for a class', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'navigate', iri: 'http://example.org/Dog', entityType: 'class' });
    expect(fakeReveal).toHaveBeenCalledWith('http://example.org/Dog', 'class');
  });

  it('calls revealFn with individual entityType on navigate for an instance', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'navigate', iri: 'http://example.org/fido', entityType: 'individual' });
    expect(fakeReveal).toHaveBeenCalledWith('http://example.org/fido', 'individual');
  });

  it('updateDLQueryModel posts ontologyStatus with hasOntology:false when model cleared', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    mockPostMessage.mockClear();
    updateDLQueryModel(undefined, undefined);
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ontologyStatus', hasOntology: false }),
    );
  });

  // ── T027: TypeScript TempClass lifecycle (Phase 8) ──────────────────────────

  it('T027a: concurrent Execute — second execute message while first is in flight calls dlQuery only once', async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise(res => { resolveFirst = res; });
    mockDlQuery.mockReturnValueOnce(firstPromise);

    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    const handler = getMessageHandler();

    // First Execute fires
    handler({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });
    // Second Execute arrives while first is still pending
    handler({ type: 'execute', classExpression: 'Cat', queryTypes: ['directSuperClasses'] });

    // Resolve the first
    resolveFirst({ directSuperClasses: [], superClasses: [], equivalentClasses: [], directSubClasses: [], subClasses: [], instances: [] });
    await vi.waitUntil(() => mockPostMessage.mock.calls.some(([m]) => (m as { type: string }).type === 'dlQueryResult'));

    expect(mockDlQuery).toHaveBeenCalledOnce();
  });

  it('T027b: temporaryClassIris contains TempClass IRI during dlQuery call', async () => {
    const { temporaryClassIris } = await import('./DLQueryPanel.js');
    const TEMP_IRI = 'urn:ontograph:dlquery#TempQuery';
    let irisWereSet = false;

    mockDlQuery.mockImplementationOnce(async () => {
      irisWereSet = temporaryClassIris.has(TEMP_IRI);
      return { directSuperClasses: [], superClasses: [], equivalentClasses: [], directSubClasses: [], subClasses: [], instances: [] };
    });

    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(([m]) => (m as { type: string }).type === 'dlQueryResult'));
    expect(irisWereSet).toBe(true);
  });

  it('T027c: temporaryClassIris is empty after dlQuery resolves successfully', async () => {
    const { temporaryClassIris } = await import('./DLQueryPanel.js');
    mockDlQuery.mockResolvedValueOnce({ directSuperClasses: [], superClasses: [], equivalentClasses: [], directSubClasses: [], subClasses: [], instances: [] });

    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(([m]) => (m as { type: string }).type === 'dlQueryResult'));
    expect(temporaryClassIris.size).toBe(0);
  });

  it('T027d: temporaryClassIris is empty and executing resets after dlQuery rejects', async () => {
    const { temporaryClassIris } = await import('./DLQueryPanel.js');
    mockDlQuery.mockRejectedValueOnce(new Error('Parse error'));

    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'BadExpr', queryTypes: ['subClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(([m]) => (m as { type: string }).type === 'dlQueryError'));
    expect(temporaryClassIris.size).toBe(0);

    // Verify executing was reset: a subsequent Execute should call dlQuery again
    mockDlQuery.mockResolvedValueOnce({ directSuperClasses: [], superClasses: [], equivalentClasses: [], directSubClasses: [], subClasses: [], instances: [] });
    mockPostMessage.mockClear();
    getMessageHandler()({ type: 'execute', classExpression: 'Dog', queryTypes: ['directSuperClasses'] });
    await vi.waitUntil(() => mockPostMessage.mock.calls.some(([m]) => (m as { type: string }).type === 'dlQueryResult'));
    expect(mockDlQuery).toHaveBeenCalledTimes(2);
  });

  it('updateDLQueryModel posts ontologyStatus with hasOntology:true when model set', () => {
    openDLQueryPanel(fakeContext, fakeBridge, undefined, undefined, fakeReveal);
    mockPostMessage.mockClear();
    updateDLQueryModel(fakeModel, undefined);
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ontologyStatus', hasOntology: true }),
    );
  });

  it('requestCompletion with no index returns empty completionResult', () => {
    openDLQueryPanel(fakeContext, fakeBridge, undefined, undefined, fakeReveal);
    getMessageHandler()({ type: 'requestCompletion', requestId: 42, prefix: 'dog' });
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'completionResult', requestId: 42, items: [] }),
    );
  });

  it('validate returns empty validationResult for valid expression', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'validate', requestId: 7, text: 'owl:Thing' });
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'validationResult', requestId: 7 }),
    );
  });

  it('validate posts validationResult with correct requestId', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'validate', requestId: 8, text: 'Dog and Cat' });
    const call = mockPostMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'validationResult',
    );
    expect(call).toBeDefined();
    const msg = call![0] as { type: string; requestId: number; errors: unknown[] };
    expect(msg.requestId).toBe(8);
    expect(Array.isArray(msg.errors)).toBe(true);
  });

  it('validate returns no errors for formatted multi-line expression with continuation "and" line', () => {
    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'validate', requestId: 99, text: 'Dog\n    and Cat' });
    const call = mockPostMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'validationResult' &&
               (m as { requestId: number }).requestId === 99,
    );
    expect(call).toBeDefined();
    const msg = call![0] as { type: string; requestId: number; errors: unknown[] };
    expect(msg.errors).toEqual([]);
  });

  // ── T031: TypeScript-side label resolution ───────────────────────────────────

  it('T031a: resolves unquoted label name to angle-bracket IRI before calling dlQuery', async () => {
    const modelWithClass: OntologyModel = {
      classes: new Map([
        ['http://example.org/Animal', {
          iri: 'http://example.org/Animal',
          type: 'class',
          labels: { en: ['Animal'] },
          annotations: {},
          superClassIris: [],
          equivalentClassIris: [],
          disjointClassIris: [],
          superClassExpressions: [],
          equivalentClassExpressions: [],
          gciExpressions: [],
        }],
      ]),
      individuals: new Map(),
      objectProperties: new Map(),
      dataProperties: new Map(),
      annotationProperties: new Map(),
      metadata: { imports: [], annotations: {} },
      sourceUri: '',
      rawContent: '',
      sourceFormat: 'functional',
      standaloneGcis: [],
      inferredSubClasses: new Map(),
      isClassified: false,
      classificationNeedsUpdate: false,
    } as unknown as OntologyModel;

    mockDlQuery.mockResolvedValueOnce({
      directSuperClasses: [], superClasses: [], equivalentClasses: [],
      directSubClasses: [], subClasses: [], instances: [],
    });

    openDLQueryPanel(fakeContext, fakeBridge, modelWithClass, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Animal', queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(
      ([m]) => (m as { type: string }).type === 'dlQueryResult',
    ));

    expect(mockDlQuery).toHaveBeenCalledWith(
      expect.any(String), expect.anything(), null,
      '<http://example.org/Animal>',
      ['directSuperClasses'], 'auto',
    );
  });

  it('T031b: resolves single-quoted label to angle-bracket IRI before calling dlQuery', async () => {
    const modelWithClass: OntologyModel = {
      classes: new Map([
        ['http://snomed.info/id/123', {
          iri: 'http://snomed.info/id/123',
          type: 'class',
          labels: { en: ['Body structure'] },
          annotations: {},
          superClassIris: [],
          equivalentClassIris: [],
          disjointClassIris: [],
          superClassExpressions: [],
          equivalentClassExpressions: [],
          gciExpressions: [],
        }],
      ]),
      individuals: new Map(),
      objectProperties: new Map(),
      dataProperties: new Map(),
      annotationProperties: new Map(),
      metadata: { imports: [], annotations: {} },
      sourceUri: '',
      rawContent: '',
      sourceFormat: 'functional',
      standaloneGcis: [],
      inferredSubClasses: new Map(),
      isClassified: false,
      classificationNeedsUpdate: false,
    } as unknown as OntologyModel;

    mockDlQuery.mockResolvedValueOnce({
      directSuperClasses: [], superClasses: [], equivalentClasses: [],
      directSubClasses: [], subClasses: [], instances: [],
    });

    openDLQueryPanel(fakeContext, fakeBridge, modelWithClass, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: "'Body structure'", queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(
      ([m]) => (m as { type: string }).type === 'dlQueryResult',
    ));

    expect(mockDlQuery).toHaveBeenCalledWith(
      expect.any(String), expect.anything(), null,
      '<http://snomed.info/id/123>',
      ['directSuperClasses'], 'auto',
    );
  });

  it('T031c: keeps unresolvable tokens unchanged when model has no matching entity', async () => {
    mockDlQuery.mockResolvedValueOnce({
      directSuperClasses: [], superClasses: [], equivalentClasses: [],
      directSubClasses: [], subClasses: [], instances: [],
    });

    openDLQueryPanel(fakeContext, fakeBridge, fakeModel, undefined, fakeReveal);
    getMessageHandler()({ type: 'execute', classExpression: 'Unicorn', queryTypes: ['directSuperClasses'] });

    await vi.waitUntil(() => mockPostMessage.mock.calls.some(
      ([m]) => (m as { type: string }).type === 'dlQueryResult',
    ));

    expect(mockDlQuery).toHaveBeenCalledWith(
      expect.any(String), expect.anything(), null,
      'Unicorn',
      ['directSuperClasses'], 'auto',
    );
  });
});
