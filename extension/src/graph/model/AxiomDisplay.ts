import type { EntityType, OntologyModel } from './OntologyModel';
import { getLabel } from './OntologyModel';
import type { OntologyIndex } from './OntologyIndex';

export type AxiomDisplayStyle = 'label' | 'shortIri' | 'fullIri';

export interface RenderedExpressionEntityRef {
  from: number;
  to: number;
  iri: string;
  entityType: EntityType;
  label: string;
}

const MANCHESTER_KW = new Set([
  'some', 'only', 'value', 'min', 'max', 'exactly', 'and', 'or', 'not', 'that', 'Self',
]);

export const BUILTIN_PREFIXES: Record<string, string> = {
  'owl:':  'http://www.w3.org/2002/07/owl#',
  'rdf:':  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'rdfs:': 'http://www.w3.org/2000/01/rdf-schema#',
  'xsd:':  'http://www.w3.org/2001/XMLSchema#',
};

/** Compute a short IRI using the ontology base prefix or known built-in prefixes. */
export function computeShortIri(iri: string, baseIri?: string): string {
  for (const [prefix, expansion] of Object.entries(BUILTIN_PREFIXES)) {
    if (iri.startsWith(expansion)) { return prefix + iri.slice(expansion.length); }
  }
  if (baseIri) {
    if (iri.startsWith(baseIri + '#')) { return ':' + iri.slice(baseIri.length + 1); }
    if (iri.startsWith(baseIri + '/')) { return ':' + iri.slice(baseIri.length + 1); }
  }
  const h = iri.lastIndexOf('#');
  const s = iri.lastIndexOf('/');
  const pos = Math.max(h, s);
  return pos >= 0 ? ':' + iri.slice(pos + 1) : iri;
}

function entityByIri(iri: string, model: OntologyModel) {
  return model.classes.get(iri)
    ?? model.objectProperties.get(iri)
    ?? model.dataProperties.get(iri)
    ?? model.annotationProperties.get(iri)
    ?? model.individuals.get(iri);
}

/**
 * Render a single IRI in the target display style.
 */
export function renderIri(
  iri: string,
  model: OntologyModel,
  style: AxiomDisplayStyle,
  lang: string,
  forEditing: boolean,
): string {
  if (style === 'fullIri') { return `<${iri}>`; }
  if (style === 'shortIri') { return computeShortIri(iri, model.metadata.iri); }
  const entity = entityByIri(iri, model);
  if (entity) {
    const lbl = getLabel(entity, lang);
    if (lbl && lbl !== iri) {
      if (forEditing && /\s/.test(lbl)) {
        return `'${lbl}'`;
      }
      return lbl;
    }
  }
  return computeShortIri(iri, model.metadata.iri);
}

// Matches bare full IRIs (http:// or https://) stored in expression strings
const BARE_IRI = /https?:\/\/[^\s(),{}]+/g;

/**
 * Render a stored expression (containing full bare IRIs) in the chosen display style.
 * Returns plain text (no HTML).
 */
export function renderExpression(
  expr: string,
  model: OntologyModel,
  style: AxiomDisplayStyle,
  lang = 'en',
  forEditing = false,
): string {
  BARE_IRI.lastIndex = 0;
  return expr.replace(BARE_IRI, iri => renderIri(iri, model, style, lang, forEditing));
}

export function renderExpressionWithEntityRefs(
  expr: string,
  model: OntologyModel,
  style: AxiomDisplayStyle,
  lang = 'en',
  forEditing = false,
): { text: string; refs: RenderedExpressionEntityRef[] } {
  const refs: RenderedExpressionEntityRef[] = [];
  let text = '';
  let lastIndex = 0;
  BARE_IRI.lastIndex = 0;

  for (const match of expr.matchAll(BARE_IRI)) {
    const iri = match[0];
    const fromSource = match.index ?? 0;
    text += expr.slice(lastIndex, fromSource);

    const entity = entityByIri(iri, model);
    const rendered = renderIri(iri, model, style, lang, forEditing);
    const from = text.length;
    text += rendered;
    if (entity) {
      refs.push({
        from,
        to: from + rendered.length,
        iri,
        entityType: entity.type,
        label: getLabel(entity, lang),
      });
    }

    lastIndex = fromSource + iri.length;
  }

  text += expr.slice(lastIndex);
  return { text, refs };
}

/**
 * Normalize a user-typed expression back to full bare IRI storage form.
 * Accepts any mix of: <fullIri>, :local, prefix:local, single-word labels, bare full IRIs.
 */
export function normalizeExpression(
  expr: string,
  model: OntologyModel,
  index: OntologyIndex,
): string {
  const result: string[] = [];
  let i = 0;
  const n = expr.length;
  const base = model.metadata.iri;

  while (i < n) {
    const c = expr[i];

    // Whitespace — preserve
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { result.push(c); i++; continue; }

    // Structural chars
    if ('(),{}'.includes(c)) { result.push(c); i++; continue; }

    // Full IRI wrapped in angle brackets: <http://...>
    if (c === '<') {
      const end = expr.indexOf('>', i + 1);
      if (end > i) { result.push(expr.slice(i + 1, end)); i = end + 1; }
      else { result.push(c); i++; }
      continue;
    }

    // Bare full IRI: http://... or https://...
    if (expr.startsWith('http://', i) || expr.startsWith('https://', i)) {
      const m = /^https?:\/\/[^\s(),{}]+/.exec(expr.slice(i));
      if (m) { result.push(m[0]); i += m[0].length; }
      else { result.push(c); i++; }
      continue;
    }

    // String literal: "..."
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (expr[j] === '\\') { j += 2; continue; }
        if (expr[j] === '"') { j++; break; }
        j++;
      }
      result.push(expr.slice(i, j));
      i = j;
      continue;
    }

    // Single-quoted label: '...'
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (expr[j] === '\\') { j += 2; continue; }
        if (expr[j] === "'") { j++; break; }
        j++;
      }
      const labelToken = expr.slice(i + 1, j - 1);
      const byLabel = index.exactMatchByLabel(labelToken);
      if (byLabel.length > 0) { result.push(byLabel[0].iri); }
      else { result.push(expr.slice(i, j)); }
      i = j;
      continue;
    }

    // Read a token (stops at whitespace, parens, braces, double/single quotes, angle brackets)
    const tStart = i;
    while (i < n && !' \t\n\r(),{}"\'<>'.includes(expr[i])) { i++; }
    const token = expr.slice(tStart, i);
    if (!token) { i++; continue; }

    // Number — keep
    if (/^\d+(\.\d+)?$/.test(token)) { result.push(token); continue; }

    // Manchester restriction / logical keyword — keep
    if (MANCHESTER_KW.has(token)) { result.push(token); continue; }

    // Prefixed IRI: :local or prefix:local
    const col = token.indexOf(':');
    if (col >= 0) {
      const pfx = token.slice(0, col + 1);   // e.g. ":" or "owl:"
      const loc = token.slice(col + 1);
      if (pfx in BUILTIN_PREFIXES && loc) { result.push(BUILTIN_PREFIXES[pfx] + loc); continue; }
      if (pfx === ':' && loc && base) { result.push(base + '#' + loc); continue; }
    }

    // Try exact label match
    const byLabel = index.exactMatchByLabel(token);
    if (byLabel.length > 0) { result.push(byLabel[0].iri); continue; }

    // Try as local name with ontology base IRI
    if (base && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(token)) {
      const candidate = base + '#' + token;
      if (entityByIri(candidate, model)) { result.push(candidate); continue; }
    }

    // Unresolvable — keep as-is
    result.push(token);
  }

  return result.join('');
}
