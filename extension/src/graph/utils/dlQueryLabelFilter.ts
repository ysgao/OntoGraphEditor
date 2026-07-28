/** Case-insensitive substring match against an entity's label OR IRI — shared by the CLI's
 *  `--filter` option (`cli/src/commands/bridge/dlQueryCommand.ts`) and the VS Code DL Query
 *  panel's own name filter (`webview-src/dl-query/DLQueryFilters.ts`), so the two never drift
 *  apart. An empty/undefined filter matches every entity. */
export function matchesLabelFilter(entity: { iri: string; label: string | null }, filter: string | undefined): boolean {
  if (!filter) { return true; }
  const lc = filter.toLowerCase();
  return (entity.label !== null && entity.label.toLowerCase().includes(lc)) || entity.iri.toLowerCase().includes(lc);
}
