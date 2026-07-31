export interface ValidationResultItem {
  componentId?: string;
  conceptId?: string;
  severity?: string;
  message?: string;
}

/** Prints save-time validation messages (case significance conflicts, duplicate descriptions,
 * redundant relationships, etc.) returned alongside a successful concept save — Snowstorm embeds
 * these in the same PUT/POST response body when the write is requested with validate=true, they
 * are not a separate failure. A no-op when there's nothing to show. */
export function printValidationResults(validationResults: unknown): void {
  if (!Array.isArray(validationResults) || validationResults.length === 0) {
    return;
  }
  for (const item of validationResults as ValidationResultItem[]) {
    const severity = item.severity ?? 'INFO';
    const marker = severity === 'ERROR' ? '✗' : severity === 'WARNING' ? '⚠' : 'ℹ';
    const component = item.componentId ?? item.conceptId ?? '?';
    console.log(`${marker} ${severity} [${component}] ${item.message ?? ''}`);
  }
}
