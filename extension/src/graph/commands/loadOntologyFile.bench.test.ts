/**
 * Principle IV benchmark — anatomy.owl (28 MB, OWL Functional Syntax).
 *
 * Constitution §IV MUST: any new feature that iterates the class hierarchy
 * must be benchmarked against test-ontologies/anatomy.owl before merging.
 * Resolves CHK036 / C1 from the 012-load-large-ontology analyse report.
 *
 * Uses ParserRegistry.parse (synchronous path) to avoid requiring a pre-built
 * dist/parserWorker.js. parseAsync uses the same code path for files under
 * LARGE_FILE_BYTES; for anatomy.owl (28 MB > 5 MB threshold) the Worker is
 * used at runtime, but the parser correctness and throughput are identical.
 *
 * Threshold: 60 000 ms (SC-001 targets 200 MB / 60 s; anatomy.owl at 28 MB
 * should complete in < 30 s on any modern workstation).
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { ParserRegistry } from '../parser/ParserRegistry';

const ANATOMY_PATH = path.resolve(process.cwd(), 'test-ontologies/anatomy.owl');
const ANATOMY_EXISTS = fs.existsSync(ANATOMY_PATH);

describe.skipIf(!ANATOMY_EXISTS)('Principle IV — loadOntologyFile anatomy.owl parse benchmark', () => {
  it('parses anatomy.owl (OWL Functional Syntax, ~28 MB) in < 60 000 ms and yields non-empty class hierarchy', () => {
    const bytes = fs.readFileSync(ANATOMY_PATH);
    const text = new TextDecoder().decode(bytes);

    const t0 = performance.now();
    const model = ParserRegistry.parse(text, 'auto', `file://${ANATOMY_PATH}`);
    const elapsed = performance.now() - t0;

    expect(model.classes.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(60_000);
  });
});
