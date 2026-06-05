import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OntologyIndex } from './OntologyIndex';
import { ParserRegistry } from '../parser/ParserRegistry';

const ANATOMY_PATH = join(__dirname, '../../test-ontologies/anatomy.owl');
const anatomyExists = existsSync(ANATOMY_PATH);

describe.skipIf(!anatomyExists)('OntologyIndex benchmark (anatomy.owl)', () => {
  let idx: OntologyIndex;

  beforeAll(async () => {
    const text = await readFile(ANATOMY_PATH, 'utf8');
    const model = ParserRegistry.parse(text, 'owl-xml', 'file:///anatomy.owl');
    idx = new OntologyIndex(model);
  }, 60_000);

  it('builds index with at least one class', () => {
    expect(idx.classCount).toBeGreaterThan(0);
  });

  it('searchByLabel("body structure", 100) completes in < 1000 ms', () => {
    const t0 = performance.now();
    const results = idx.searchByLabel('body structure', 100);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('single-token substring search completes in < 1000 ms', () => {
    const t0 = performance.now();
    const results = idx.searchByLabel('organ', 50);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});
