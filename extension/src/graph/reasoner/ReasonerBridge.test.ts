import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- VS Code mock -----
vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn(() => ({
      text: '',
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  StatusBarAlignment: { Left: 1 },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === 'timeoutSeconds') { return 30; }
        return undefined;
      }),
    })),
  },
}));

// ----- child_process mock -----
const mockWrite = vi.fn().mockReturnValue(true);
const mockStdin = { write: mockWrite };
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockProc = {
  stdin:  mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  on:     vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

vi.mock('fs', () => ({
  promises: { writeFile: vi.fn(), unlink: vi.fn() },
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({ on: vi.fn() })),
}));

import { ReasonerBridge } from './ReasonerBridge.js';
import type { DLQueryResult } from '../model/OntologyModel.js';

describe('ReasonerBridge.dlQuery', () => {
  let bridge: ReasonerBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStdout.on.mockImplementation(vi.fn());
    bridge = new ReasonerBridge('/fake/ext/path');
    // Inject the mock process so we don't need to start()
    (bridge as unknown as Record<string, unknown>)['proc'] = mockProc;
    (bridge as unknown as Record<string, unknown>)['ready'] = true;
  });

  it('dlQuery method exists on ReasonerBridge', () => {
    expect(typeof bridge.dlQuery).toBe('function');
  });

  it('sends a dlQuery JSON-RPC request with correct params', async () => {
    // Arrange: resolve the pending request when write is called
    mockWrite.mockImplementationOnce((payload: string) => {
      const req = JSON.parse(payload) as { id: number; method: string; params: unknown };
      // Immediately inject the fake response into the pending map
      const pending = (bridge as unknown as Record<string, unknown>)['pending'] as Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
      >;
      const entry = pending.get(req.id);
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve({
          directSuperClasses: ['http://example.org/Animal'],
          superClasses: ['http://example.org/Animal', 'http://www.w3.org/2002/07/owl#Thing'],
          equivalentClasses: [],
          directSubClasses: [],
          subClasses: [],
          instances: [],
        } satisfies DLQueryResult);
      }
      return true;
    });

    const result = await bridge.dlQuery(
      'functional',
      'Prefix(:=<http://example.org/>)\nOntology(<http://example.org/>)',
      null,
      'Dog',
      ['directSuperClasses', 'superClasses'],
      'auto',
    );

    // Assert request shape
    const [payload] = mockWrite.mock.calls[0] as [string];
    const req = JSON.parse(payload) as {
      method: string;
      params: { classExpression: string; queryTypes: string[] };
    };
    expect(req.method).toBe('dlQuery');
    expect(req.params.classExpression).toBe('Dog');
    expect(req.params.queryTypes).toEqual(['directSuperClasses', 'superClasses']);

    // Assert result shape
    expect(result.directSuperClasses).toEqual(['http://example.org/Animal']);
    expect(result.superClasses).toHaveLength(2);
    expect(result.directSubClasses).toEqual([]);
  });

  it('throws when the reasoner returns an error', async () => {
    mockWrite.mockImplementationOnce((payload: string) => {
      const req = JSON.parse(payload) as { id: number };
      const pending = (bridge as unknown as Record<string, unknown>)['pending'] as Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
      >;
      const entry = pending.get(req.id);
      if (entry) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Could not parse class expression: BadExpr'));
      }
      return true;
    });

    await expect(
      bridge.dlQuery('functional', 'Prefix(:=<http://example.org/>)\nOntology(<http://example.org/>)', null, 'BadExpr', ['subClasses'], 'auto'),
    ).rejects.toThrow('Could not parse class expression');
  });
});

// ── T024: anatomy.owl dlQuery benchmark ──────────────────────────────────────
// Real benchmark lives in src/parser/Phase3Reasoner.test.ts (spawnSync pattern).
// anatomy.owl is >>50k classes so ELK auto-selects; 30s wall-clock limit applies.
