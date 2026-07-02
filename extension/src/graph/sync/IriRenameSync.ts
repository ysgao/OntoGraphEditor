/**
 * Replace all bracketed occurrences of oldIri with newIri in documentText.
 *
 * Safe for OWL Functional Syntax (.ofn), Manchester Syntax (.omn), and Turtle
 * (.ttl) where entity IRIs appear as <IRI> bracket form. For OWL/XML (.owl),
 * IRIs appear as XML attribute values — use a format-aware XML transform instead.
 */
export function renameIri(
  documentText: string,
  oldIri: string,
  newIri: string,
): string {
  return documentText.split(`<${oldIri}>`).join(`<${newIri}>`);
}
