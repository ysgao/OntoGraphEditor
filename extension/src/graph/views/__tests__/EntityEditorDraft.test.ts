import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── VS Code mock ──────────────────────────────────────────────────────────────

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn().mockResolvedValue(true),
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
    showWarningMessage: vi.fn(),
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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { showEntityInfo } from '../EntityEditorPanel.js';
import type { OWLClass } from '../../model/OntologyModel.js';
import { createEmptyModel } from '../../model/OntologyModel.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const CLASS_IRI = 'http://example.org/Class1';

function buildModelWithClass(): { model: ReturnType<typeof createEmptyModel>; cls: OWLClass } {
  const model = createEmptyModel('file:///test.ofn');
  const cls: OWLClass = {
    iri: CLASS_IRI,
    type: 'class',
    labels: { en: ['Class1'] },
    annotations: {},
    superClassIris: [],
    equivalentClassIris: [],
    disjointClassIris: [],
    superClassExpressions: ['owl:Thing'],
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

function openPanel(model: ReturnType<typeof createEmptyModel>): void {
  // Dispose any existing panel to reset module-level state between tests.
  capturedDisposeHandler?.();
  capturedMessageHandler = undefined;
  capturedDisposeHandler = undefined;
  showEntityInfo(mockContext, model, CLASS_IRI);
}

function sendSaveMessage(extra: Record<string, unknown> = {}): void {
  capturedMessageHandler?.({
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
    ...extra,
  });
}

// ── T004: Save handler model filtering + draft storage ───────────────────────

describe('T004 – save handler with invalid expression indices', () => {
  let cls: OWLClass;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedMessageHandler = undefined;
    const built = buildModelWithClass();
    cls = built.cls;
    openPanel(built.model);
  });

  it('(a) filters invalid indices from model superClassExpressions', () => {
    sendSaveMessage();
    // 'owl:Thing' normalizes to a bare IRI and is routed to superClassIris by splitNormalizedExpressions
    expect(cls.superClassIris).toHaveLength(1);
    expect(cls.superClassIris[0]).toBe('http://www.w3.org/2002/07/owl#Thing');
    expect(cls.superClassExpressions).toHaveLength(0);
  });

  it('(b) the subsequent loadEntity postMessage includes draftExpressions for the invalid draft', () => {
    sendSaveMessage();
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const loadMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'loadEntity');
    expect(loadMsg).toBeDefined();
    expect((loadMsg as Record<string, unknown>).draftExpressions).toEqual([
      { sectionKey: 'superClassExpressions', text: 'BAD SYNTAX' },
    ]);
  });

  it('(b2) a saveDraftError message is posted to the webview', () => {
    sendSaveMessage();
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const errMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'saveDraftError');
    expect(errMsg).toBeDefined();
    expect((errMsg as Record<string, unknown>).invalidExpressions).toEqual([
      { sectionKey: 'superClassExpressions', index: 1, text: 'BAD SYNTAX' },
    ]);
  });

  it('(c) drafts are cleared on a subsequent clean save', () => {
    // First save: store a draft
    sendSaveMessage();
    vi.clearAllMocks();

    // Second save: no invalid indices → drafts should be cleared
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
      // no invalidExpressionIndices
    });

    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const loadMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'loadEntity');
    expect(loadMsg).toBeDefined();
    // No draftExpressions after clean save
    expect((loadMsg as Record<string, unknown>).draftExpressions).toBeUndefined();
  });
});

// ── T004b: No invalidExpressionIndices → no server-side filtering ────────────

describe('T004b – no server-side filtering when invalidExpressionIndices absent', () => {
  let cls: OWLClass;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedMessageHandler = undefined;
    const built = buildModelWithClass();
    cls = built.cls;
    openPanel(built.model);
  });

  it('passes all expressions through when invalidExpressionIndices is omitted', () => {
    // The webview linter is the sole authority on expression validity.
    // When no invalidExpressionIndices is provided (e.g. linter hasn't fired yet),
    // all expressions are accepted — no server-side heuristic filtering.
    capturedMessageHandler?.({
      type: 'save',
      iri: CLASS_IRI,
      entityType: 'class',
      superClassExpressions: ['owl:Thing', "'Body structure' and 'All or part of' some "],
      superClassIris: [],
      equivalentClassIris: [],
      equivalentClassExpressions: [],
      gciExpressions: [],
      disjointClassIris: [],
      // deliberately omitting invalidExpressionIndices
    });

    // Both expressions pass through — server does not filter without webview signal.
    // 'owl:Thing' normalizes to a bare IRI → routed to superClassIris; complex expression stays in superClassExpressions.
    expect(cls.superClassIris).toHaveLength(1);
    expect(cls.superClassExpressions).toHaveLength(1);

    // No draft error posted when no invalid indices are flagged
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const errMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'saveDraftError');
    expect(errMsg).toBeUndefined();
  });
});

// ── T008: saveDraftError posting + sendLoadEntity draft merge ────────────────

describe('T008 – saveDraftError and sendLoadEntity with drafts', () => {
  let model: ReturnType<typeof createEmptyModel>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedMessageHandler = undefined;
    const built = buildModelWithClass();
    model = built.model;
    openPanel(model);
  });

  it('(a) saveDraftError payload matches the invalid expression', () => {
    sendSaveMessage();
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const errMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'saveDraftError');
    expect(errMsg).toMatchObject({
      type: 'saveDraftError',
      invalidExpressions: [{ sectionKey: 'superClassExpressions', index: 1, text: 'BAD SYNTAX' }],
    });
  });

  it('(b) loadEntity includes draftExpressions when drafts exist', () => {
    sendSaveMessage();
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const loadMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'loadEntity');
    expect((loadMsg as Record<string, unknown>).draftExpressions).toEqual([
      { sectionKey: 'superClassExpressions', text: 'BAD SYNTAX' },
    ]);
  });

  it('(c) loadEntity omits draftExpressions when no drafts exist for the IRI', () => {
    // Save without any invalid indices → no drafts
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
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const loadMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'loadEntity');
    expect(loadMsg).toBeDefined();
    expect((loadMsg as Record<string, unknown>).draftExpressions).toBeUndefined();
  });
});

// ── T012: saveDraftError data contract for error banner ──────────────────────

describe('T012 – saveDraftError data contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMessageHandler = undefined;
    const { model } = buildModelWithClass();
    openPanel(model);
  });

  it('saveDraftError has non-empty invalidExpressions array when indices are provided', () => {
    sendSaveMessage();
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const errMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'saveDraftError');
    expect(errMsg).toBeDefined();
    const invalid = (errMsg as Record<string, unknown>).invalidExpressions as unknown[];
    expect(invalid.length).toBeGreaterThan(0);
  });

  it('no saveDraftError is posted when all expressions are valid', () => {
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
    const calls = (mockPostMessage as Mock).mock.calls.map((c: unknown[]) => c[0]);
    const errMsg = calls.find((c: unknown) => (c as Record<string, unknown>).type === 'saveDraftError');
    expect(errMsg).toBeUndefined();
  });
});
