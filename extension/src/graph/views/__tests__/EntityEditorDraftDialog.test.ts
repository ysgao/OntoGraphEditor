import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── VS Code mock ──────────────────────────────────────────────────────────────

const { mockPostMessage, mockShowWarningMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn().mockResolvedValue(true),
  mockShowWarningMessage: vi.fn(),
}));

let capturedMessageHandler: ((msg: unknown) => void) | undefined;
let capturedDisposeHandler: (() => void) | undefined;

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        onDidReceiveMessage: vi.fn((cb: (msg: unknown) => void) => {
          capturedMessageHandler = cb;
          return { dispose: vi.fn() };
        }),
        postMessage: mockPostMessage,
        html: '',
        asWebviewUri: vi.fn(() => 'mock-uri'),
        cspSource: 'mock-csp',
      },
      onDidDispose: vi.fn((cb: () => void) => {
        capturedDisposeHandler = cb;
        return { dispose: vi.fn() };
      }),
      reveal: vi.fn(),
    })),
    createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: vi.fn(),
    visibleTextEditors: [],
    setStatusBarMessage: vi.fn(),
  },
  ViewColumn: { Beside: 2, One: 1 },
  Uri: {
    joinPath: vi.fn((_base: unknown, ...parts: string[]) => parts.join('/')),
    parse: vi.fn((s: string) => ({ fsPath: s, toString: () => s })),
  },
  workspace: {
    fs: {
      readFile: vi.fn().mockResolvedValue(new Uint8Array()),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    textDocuments: [],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === 'display.preferredLabelLanguage') return 'en';
        if (key === 'display.axiomEntityStyle') return 'label';
        return undefined;
      }),
    })),
  },
  commands: { executeCommand: vi.fn() },
  env: { openExternal: vi.fn() },
  OverviewRulerLane: { Left: 1 },
  ThemeColor: vi.fn(),
  Range: vi.fn((s1: number, c1: number, s2: number, c2: number) => ({
    start: { line: s1, character: c1 },
    end: { line: s2, character: c2 },
  })),
  Position: vi.fn((l: number, c: number) => ({ line: l, character: c })),
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
  TreeItem: vi.fn(),
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  ThemeIcon: vi.fn(),
}));

vi.mock('../../extension.js', () => ({
  parsedDocVersions: new Map(),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { showEntityInfo, refreshEntityEditorIfOpen, hasDraftAxioms } from '../EntityEditorPanel.js';
import type { OWLClass } from '../../model/OntologyModel.js';
import { createEmptyModel } from '../../model/OntologyModel.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const CLASS_IRI = 'http://example.org/Class1';

function buildModel(): { model: ReturnType<typeof createEmptyModel>; cls: OWLClass } {
  const model = createEmptyModel('file:///test.ofn');
  const cls: OWLClass = {
    iri: CLASS_IRI,
    type: 'class',
    labels: { en: ['Class1'] },
    annotations: {},
    superClassIris: [],
    equivalentClassIris: [],
    disjointClassIris: [],
    superClassExpressions: [],
    equivalentClassExpressions: [],
    gciExpressions: [],
  };
  model.classes.set(CLASS_IRI, cls);
  return { model, cls };
}

const mockContext = {
  extensionUri: { fsPath: '/test', toString: () => '/test' },
  subscriptions: [] as { dispose: () => void }[],
} as unknown as import('vscode').ExtensionContext;

function openPanelAndStoreDraft(model: ReturnType<typeof createEmptyModel>): void {
  capturedDisposeHandler?.();
  capturedMessageHandler = undefined;
  capturedDisposeHandler = undefined;
  showEntityInfo(mockContext, model, CLASS_IRI);
  // Store a draft by simulating a save with an invalid expression.
  // Cast to declared type to break TypeScript's assignment narrowing — showEntityInfo
  // re-assigns capturedMessageHandler via the mock's onDidReceiveMessage side effect.
  const handler = capturedMessageHandler as ((msg: unknown) => void) | undefined;
  handler?.({
    type: 'save',
    iri: CLASS_IRI,
    entityType: 'class',
    superClassExpressions: ['owl:Thing', 'BAD SYNTAX'],
    superClassIris: [],
    equivalentClassIris: [],
    equivalentClassExpressions: [],
    gciExpressions: [],
    disjointClassIris: [],
    invalidExpressionIndices: { superClassExpressions: [1] },
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CLASS_IRI_2 = 'http://example.org/Class2';

// ── T014: Blocking dialog tests ───────────────────────────────────────────────

describe('T014 – hasDraftAxioms predicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDisposeHandler?.();
    capturedMessageHandler = undefined;
    capturedDisposeHandler = undefined;
  });

  it('(a) returns false when no drafts are stored', () => {
    expect(hasDraftAxioms()).toBe(false);
  });

  it('(a) returns true after a draft is stored', () => {
    const { model } = buildModel();
    openPanelAndStoreDraft(model);
    expect(hasDraftAxioms()).toBe(true);
  });
});

describe('T014 – refreshEntityEditorIfOpen blocking dialog', () => {
  let model: ReturnType<typeof createEmptyModel>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildModel();
    model = built.model;
    openPanelAndStoreDraft(model);
    vi.clearAllMocks(); // clear postMessage calls from setup
  });

  it('(b) calls showWarningMessage with modal: true when drafts exist', async () => {
    mockShowWarningMessage.mockResolvedValue(undefined); // user dismisses
    await refreshEntityEditorIfOpen(model, mockContext);
    expect(mockShowWarningMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ modal: true }),
      expect.any(String),
      expect.any(String),
    );
  });

  it('(c) does NOT call sendLoadEntity (postMessage) when user dismisses dialog', async () => {
    mockShowWarningMessage.mockResolvedValue(undefined);
    await refreshEntityEditorIfOpen(model, mockContext);
    const loadCalls = (mockPostMessage as Mock).mock.calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'loadEntity',
    );
    expect(loadCalls).toHaveLength(0);
  });

  it('(d) clears drafts and calls postMessage loadEntity when user chooses "Discard and proceed"', async () => {
    mockShowWarningMessage.mockResolvedValue('Discard and proceed');
    await refreshEntityEditorIfOpen(model, mockContext);
    expect(hasDraftAxioms()).toBe(false);
    const loadCalls = (mockPostMessage as Mock).mock.calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'loadEntity',
    );
    expect(loadCalls.length).toBeGreaterThan(0);
  });

  it('(e) calls sendLoadEntity directly without dialog when no drafts exist', async () => {
    // Clear drafts first via a clean save
    capturedMessageHandler?.({
      type: 'save',
      iri: CLASS_IRI,
      entityType: 'class',
      superClassExpressions: ['owl:Thing'],
      superClassIris: [],
      equivalentClassIris: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
      disjointClassIris: [],
    });
    vi.clearAllMocks();

    await refreshEntityEditorIfOpen(model, mockContext);
    expect(mockShowWarningMessage).not.toHaveBeenCalled();
    const loadCalls = (mockPostMessage as Mock).mock.calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'loadEntity',
    );
    expect(loadCalls.length).toBeGreaterThan(0);
  });
});

// ── T021: Per-entity button routing ──────────────────────────────────────────

describe('T021 – per-entity button routing in blocking dialog', () => {
  let model: ReturnType<typeof createEmptyModel>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedDisposeHandler?.();
    capturedMessageHandler = undefined;
    capturedDisposeHandler = undefined;

    model = createEmptyModel('file:///test.ofn');
    const cls1: OWLClass = {
      iri: CLASS_IRI,
      type: 'class',
      labels: { en: ['Class1'] },
      annotations: {},
      superClassIris: [],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
    };
    const cls2: OWLClass = {
      iri: CLASS_IRI_2,
      type: 'class',
      labels: { en: ['Class2'] },
      annotations: {},
      superClassIris: [],
      equivalentClassIris: [],
      disjointClassIris: [],
      superClassExpressions: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
    };
    model.classes.set(CLASS_IRI, cls1);
    model.classes.set(CLASS_IRI_2, cls2);

    showEntityInfo(mockContext, model, CLASS_IRI);
    const handler = capturedMessageHandler as ((msg: unknown) => void) | undefined;

    // Draft for Class1
    handler?.({
      type: 'save',
      iri: CLASS_IRI,
      entityType: 'class',
      superClassExpressions: ['BAD SYNTAX'],
      superClassIris: [],
      equivalentClassIris: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
      disjointClassIris: [],
      invalidExpressionIndices: { superClassExpressions: [0] },
    });

    // Draft for Class2 via same handler (model has both entities)
    handler?.({
      type: 'save',
      iri: CLASS_IRI_2,
      entityType: 'class',
      superClassExpressions: ['ALSO BAD'],
      superClassIris: [],
      equivalentClassIris: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
      disjointClassIris: [],
      invalidExpressionIndices: { superClassExpressions: [0] },
    });

    vi.clearAllMocks();
  });

  it('navigates to the entity whose button label was clicked, not always the first entity', async () => {
    // User clicks the 'Class2' button (second entity's label, not first)
    mockShowWarningMessage.mockResolvedValue('Class2');
    await refreshEntityEditorIfOpen(model, mockContext);

    const loadCalls = (mockPostMessage as Mock).mock.calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'loadEntity',
    );
    expect(loadCalls.length).toBeGreaterThan(0);
    const loadedIri = (loadCalls[0][0] as Record<string, unknown>).iri;
    expect(loadedIri).toBe(CLASS_IRI_2);
  });
});
