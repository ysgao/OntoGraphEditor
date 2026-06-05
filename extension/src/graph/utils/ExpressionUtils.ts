const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

function abbreviateIri(iri: string): string {
  if (iri === RDFS_LABEL) { return 'rdfs:label'; }
  return `<${iri}>`;
}

type MToken = { t: 'IRI' | 'KW' | 'NUM' | 'LP' | 'RP' | 'LB' | 'RB' | 'COMMA'; v: string };

function tokenizeMExpr(expr: string): MToken[] {
  const toks: MToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (' \t\n\r'.includes(c)) { i++; continue; }
    if (c === '(') { toks.push({ t: 'LP', v: '(' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'RP', v: ')' }); i++; continue; }
    if (c === '{') { toks.push({ t: 'LB', v: '{' }); i++; continue; }
    if (c === '}') { toks.push({ t: 'RB', v: '}' }); i++; continue; }
    if (c === ',') { toks.push({ t: 'COMMA', v: ',' }); i++; continue; }
    if (expr.startsWith('http://', i) || expr.startsWith('https://', i)) {
      const m = /^https?:\/\/[^\s(),{}\[\]]+/.exec(expr.slice(i));
      if (m) { toks.push({ t: 'IRI', v: m[0] }); i += m[0].length; continue; }
    }
    if (/\d/.test(c)) {
      const m = /^\d+/.exec(expr.slice(i));
      if (m) { toks.push({ t: 'NUM', v: m[0] }); i += m[0].length; continue; }
    }
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(expr.slice(i));
    if (m) { toks.push({ t: 'KW', v: m[0] }); i += m[0].length; continue; }
    i++;
  }
  return toks;
}

/**
 * Converts a Manchester-like syntax expression (using full IRIs) to OWL Functional Syntax.
 * This is used for GCIs and complex class expressions stored in the model.
 */
export function manchesterToFunctional(expr: string): string {
  const toks = tokenizeMExpr(expr);
  let pos = 0;
  const peek = (): MToken | undefined => toks[pos];
  const consume = (): MToken => toks[pos++] ?? { t: 'KW', v: '' };
  const a = (i: string) => abbreviateIri(i);

  function parseOr(): string {
    const parts = [parseAnd()];
    while (peek()?.v === 'or') { consume(); parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0] : `ObjectUnionOf(${parts.join(' ')})`;
  }

  function parseAnd(): string {
    const parts = [parseAtom()];
    while (peek()?.v === 'and') { consume(); parts.push(parseAtom()); }
    return parts.length === 1 ? parts[0] : `ObjectIntersectionOf(${parts.join(' ')})`;
  }

  function parseAtom(): string {
    const t = peek();
    if (!t) return '';

    if (t.v === 'not') {
      consume();
      if (peek()?.t === 'LP') { consume(); const inner = parseOr(); if (peek()?.t === 'RP') consume(); return `ObjectComplementOf(${inner})`; }
      return `ObjectComplementOf(${parseAtom()})`;
    }

    if (t.t === 'LP') {
      consume();
      const inner = parseOr();
      if (peek()?.t === 'RP') consume();
      return inner;
    }

    if (t.t === 'LB') {
      consume();
      const iris: string[] = [];
      while (peek() && peek()?.t !== 'RB') {
        const tk = consume();
        if (tk.t === 'IRI') iris.push(a(tk.v));
      }
      if (peek()?.t === 'RB') consume();
      return `ObjectOneOf(${iris.join(' ')})`;
    }

    if (t.t === 'KW' && t.v === '[data]') {
      consume();
      return '';
    }

    if (t.t === 'IRI') {
      const iri = consume().v;
      const nxt = peek();
      if (nxt?.v === 'some') { consume(); return `ObjectSomeValuesFrom(${a(iri)} ${parseAtom()})`; }
      if (nxt?.v === 'only') { consume(); return `ObjectAllValuesFrom(${a(iri)} ${parseAtom()})`; }
      if (nxt?.v === 'value') { consume(); return `ObjectHasValue(${a(iri)} ${parseAtom()})`; }
      if (nxt?.v === 'Self') { consume(); return `ObjectHasSelf(${a(iri)})`; }
      if (nxt?.v === 'min') {
        consume(); const n = consume().v;
        const f = peek(); const filler = (f?.t === 'IRI' || f?.t === 'LP' || f?.v === 'not') ? ` ${parseAtom()}` : '';
        return `ObjectMinCardinality(${n} ${a(iri)}${filler})`;
      }
      if (nxt?.v === 'max') {
        consume(); const n = consume().v;
        const f = peek(); const filler = (f?.t === 'IRI' || f?.t === 'LP' || f?.v === 'not') ? ` ${parseAtom()}` : '';
        return `ObjectMaxCardinality(${n} ${a(iri)}${filler})`;
      }
      if (nxt?.v === 'exactly') {
        consume(); const n = consume().v;
        const f = peek(); const filler = (f?.t === 'IRI' || f?.t === 'LP' || f?.v === 'not') ? ` ${parseAtom()}` : '';
        return `ObjectExactCardinality(${n} ${a(iri)}${filler})`;
      }
      return a(iri);
    }

    consume();
    return '';
  }

  try {
    return parseOr();
  } catch {
    return expr; // Fallback to raw if parsing fails
  }
}