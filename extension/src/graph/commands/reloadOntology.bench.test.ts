/**
 * SC-003 timing benchmark — reloadOntology wall-clock latency.
 *
 * SC-003: "Disk-change detection triggers a reload within 2 seconds of the
 * file modification timestamp changing."
 *
 * This benchmark covers the parse + callback portion of the reload path using
 * bfo-core.ofn (94 KB, always committed).  File-watcher latency is
 * platform-dependent and excluded from automated measurement.
 *
 * Note: SC-003 for 200 MB files cannot be verified in automated CI and
 * requires manual acceptance testing with a SNOMED CT snapshot.
 *
 * Resolves CHK037 / H3 from the 012-load-large-ontology analyse report.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reloadOntology } from './reloadOntology';
import type { OntologyModel } from '../model/OntologyModel';

const BFO_PATH = path.resolve(process.cwd(), 'test-ontologies/bfo-core.ofn');
const BFO_EXISTS = fs.existsSync(BFO_PATH);

const { mockReadFile, mockStat, mockShowErrorMessage } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockShowErrorMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    fs: { readFile: mockReadFile, stat: mockStat },
  },
  window: { showErrorMessage: mockShowErrorMessage },
  Uri: { parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s.replace('file://', '') })) },
}));

describe.skipIf(!BFO_EXISTS)('reloadOntology — SC-003 reload timing benchmark', () => {
  let bfoBytes: Uint8Array;

  beforeEach(() => {
    vi.clearAllMocks();
    bfoBytes = fs.readFileSync(BFO_PATH);
    mockReadFile.mockResolvedValue(bfoBytes);
    mockStat.mockResolvedValue({ mtime: 1000, size: bfoBytes.length, type: 1, ctime: 0 });
  });

  it('reloads bfo-core.ofn (94 KB, functional) — parse + callback completes in < 2000 ms', async () => {
    const model = {
      sourceUri: `file://${BFO_PATH}`,
      sourceFormat: 'functional',
    } as unknown as OntologyModel;

    const t0 = performance.now();
    await reloadOntology(model, vi.fn());
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(2000);
  });
});
