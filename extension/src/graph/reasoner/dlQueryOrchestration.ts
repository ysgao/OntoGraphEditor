import type { OntologyModel } from '../model/OntologyModel';
import { needsClassificationBeforeQuery } from '../model/OntologyModel';

/**
 * Ensures `model` is classified before running a DL query, without depending on any
 * `vscode`-bound state — `classify`/`runQuery` are injected so this is directly unit-testable
 * (mirrors this repo's pattern of extracting VS-Code-API-free helpers, e.g. `src/uml/`).
 *
 * If classification is needed, `classify()` runs first; a rejection from it propagates as-is
 * and `runQuery()` is never called (FR-003). If classification is not needed, `runQuery()` runs
 * directly with no redundant classify step (FR-002).
 */
export async function runDlQueryWithClassifyFirst<T>(
  model: OntologyModel,
  classify: () => Promise<unknown>,
  runQuery: () => Promise<T>,
): Promise<T> {
  if (needsClassificationBeforeQuery(model)) {
    await classify();
  }
  return runQuery();
}
