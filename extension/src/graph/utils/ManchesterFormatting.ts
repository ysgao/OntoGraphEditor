/**
 * Formats a single-line Manchester OWL class expression for display by inserting
 * a newline + 4-space indent before each 'and' keyword that is not inside an IRI
 * bracket (<…>), a double-quoted string ("…"), or a single-quoted label ('…').
 */
export function formatManchesterForDisplay(expr: string): string {
  if (!expr) { return expr; }

  type State = 'normal' | 'iri' | 'dquote' | 'squote';
  let state: State = 'normal';
  let result = '';
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (state === 'normal') {
      if (ch === '<') {
        state = 'iri';
        result += ch;
      } else if (ch === '"') {
        state = 'dquote';
        result += ch;
      } else if (ch === "'") {
        state = 'squote';
        result += ch;
      } else if (
        ch === ' ' &&
        expr.slice(i, i + 5) === ' and ' &&
        (i === 0 || /\S/.test(expr[i - 1] ?? '')) &&
        i + 5 < expr.length &&
        /\S/.test(expr[i + 5])
      ) {
        result += '\n    and ';
        i += 5;
        continue;
      } else {
        result += ch;
      }
    } else if (state === 'iri') {
      result += ch;
      if (ch === '>') { state = 'normal'; }
    } else if (state === 'dquote') {
      result += ch;
      if (ch === '\\') {
        i++;
        if (i < expr.length) { result += expr[i]; }
      } else if (ch === '"') {
        state = 'normal';
      }
    } else {
      result += ch;
      if (ch === '\\') {
        i++;
        if (i < expr.length) { result += expr[i]; }
      } else if (ch === "'") {
        state = 'normal';
      }
    }

    i++;
  }

  return result;
}

/**
 * Returns the start positions (in `expr`) of each ' and ' pattern that
 * `formatManchesterForDisplay` would replace with '\n    and '.
 * Each replacement inserts 4 extra characters.  Use the return value to remap
 * character offsets after formatting: add 4 × (number of breaks before the offset).
 */
export function findFormatBreaks(expr: string): number[] {
  type State = 'normal' | 'iri' | 'dquote' | 'squote';
  let state: State = 'normal';
  const breaks: number[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (state === 'normal') {
      if (ch === '<') { state = 'iri'; }
      else if (ch === '"') { state = 'dquote'; }
      else if (ch === "'") { state = 'squote'; }
      else if (
        ch === ' ' &&
        expr.slice(i, i + 5) === ' and ' &&
        (i === 0 || /\S/.test(expr[i - 1] ?? '')) &&
        i + 5 < expr.length &&
        /\S/.test(expr[i + 5])
      ) {
        breaks.push(i);
        i += 5;
        continue;
      }
    } else if (state === 'iri') {
      if (ch === '>') { state = 'normal'; }
    } else if (state === 'dquote') {
      if (ch === '\\') { i++; if (i < expr.length) { i++; continue; } }
      else if (ch === '"') { state = 'normal'; }
    } else {
      if (ch === '\\') { i++; if (i < expr.length) { i++; continue; } }
      else if (ch === "'") { state = 'normal'; }
    }
    i++;
  }

  return breaks;
}

/**
 * Parses multi-line editor content (which may contain display-formatting
 * continuation lines starting with 'and ') back into a list of single-line
 * logical expressions ready for serialisation or validation.
 *
 * Rules:
 *  - Blank lines and '#'-comment lines are skipped.
 *  - A trimmed line matching /^and\s/ is appended (with a single space) to the
 *    previous result entry; if no previous entry exists the line becomes its own.
 */
export function collectLogicalLines(rawText: string): string[] {
  const result: string[] = [];
  for (const raw of rawText.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) { continue; }
    if (/^and\s/.test(line) && result.length > 0) {
      result[result.length - 1] += ' ' + line;
    } else {
      result.push(line);
    }
  }
  return result;
}

/**
 * Strips display formatting from a single-expression editor (e.g. the DL Query
 * input) and returns a single logical line. Equivalent to
 * collectLogicalLines(rawText).join(' ').
 */
export function stripAndContinuations(rawText: string): string {
  return collectLogicalLines(rawText).join(' ');
}

/**
 * Splits a Manchester class expression into its top-level `and`-conjoined
 * conjuncts. Content inside IRI brackets (<…>), double-quoted strings ("…"),
 * single-quoted labels ('…'), and parentheses (…) is treated as opaque — `and`
 * appearing within those delimiters is not treated as a split point.
 */
export function splitTopLevelConjuncts(expr: string): string[] {
  if (!expr) { return []; }

  type State = 'normal' | 'iri' | 'dquote' | 'squote';
  let state: State = 'normal';
  let parenDepth = 0;
  const conjuncts: string[] = [];
  let start = 0;
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (state === 'normal') {
      if (ch === '<') {
        state = 'iri';
      } else if (ch === '"') {
        state = 'dquote';
      } else if (ch === "'") {
        state = 'squote';
      } else if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        if (parenDepth > 0) { parenDepth--; }
      } else if (
        parenDepth === 0 &&
        ch === ' ' &&
        expr.slice(i, i + 5) === ' and ' &&
        i + 5 < expr.length &&
        /\S/.test(expr[i + 5])
      ) {
        conjuncts.push(expr.slice(start, i));
        i += 5;
        start = i;
        continue;
      }
    } else if (state === 'iri') {
      if (ch === '>') { state = 'normal'; }
    } else if (state === 'dquote') {
      if (ch === '\\') { i++; }
      else if (ch === '"') { state = 'normal'; }
    } else {
      if (ch === '\\') { i++; }
      else if (ch === "'") { state = 'normal'; }
    }

    i++;
  }

  conjuncts.push(expr.slice(start));
  return conjuncts;
}

// Canonical role-prefix ordering for Manchester class expressions.
// laterality is handled separately via LATERALITY_PREFIX and always pinned last.
const CANONICAL_ROLE_PREFIXES: readonly string[] = [
  'all or part of',
  'proper part of',
  'constitutional part of',
  'regional part of',
  'lateral half of',
  'systemic part of',
];
const LATERALITY_PREFIX = 'laterality';

/**
 * Returns true if `expr` contains the given `op` string at the top level
 * (outside IRI brackets, quoted strings, and parentheses).
 */
function hasTopLevelToken(expr: string, op: string): boolean {
  type State = 'normal' | 'iri' | 'dquote' | 'squote';
  let state: State = 'normal';
  let parenDepth = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (state === 'normal') {
      if (ch === '<') { state = 'iri'; }
      else if (ch === '"') { state = 'dquote'; }
      else if (ch === "'") { state = 'squote'; }
      else if (ch === '(') { parenDepth++; }
      else if (ch === ')') { if (parenDepth > 0) { parenDepth--; } }
      else if (parenDepth === 0 && expr.slice(i, i + op.length) === op) {
        return true;
      }
    } else if (state === 'iri') {
      if (ch === '>') { state = 'normal'; }
    } else if (state === 'dquote') {
      if (ch === '\\') { i++; }
      else if (ch === '"') { state = 'normal'; }
    } else {
      if (ch === '\\') { i++; }
      else if (ch === "'") { state = 'normal'; }
    }
  }
  return false;
}

/**
 * Returns true if `conjunct` is a bare named-class reference — it contains no
 * top-level restriction operator (`some`, `only`, `value`, `min`, `max`,
 * `exactly`).  Such conjuncts are sorted before role-based ones.
 */
function isBareNamedClass(conjunct: string): boolean {
  const ops = [' some ', ' only ', ' value ', ' min ', ' max ', ' exactly '];
  return !ops.some(op => hasTopLevelToken(conjunct, op));
}

/**
 * Extracts the lowercase role name from a conjunct for prefix matching.
 * Handles both unquoted (`constitutional part of some X`) and single-quoted
 * (`'Constitutional part of' some X`) forms by stripping the surrounding
 * single-quote delimiters before lowercasing.
 */
function extractRoleLower(conjunct: string): string {
  const t = conjunct.trimStart();
  if (t.startsWith("'")) {
    const close = t.indexOf("'", 1);
    if (close > 0) { return t.slice(1, close).toLowerCase(); }
  }
  return t.toLowerCase();
}

/**
 * Sorts the `and`-conjoined attribute clauses of a Manchester class expression
 * into the canonical role-prefix order:
 *   All or part of → Proper part of → Constitutional part of →
 *   Regional part of → Lateral half of → Systemic part of →
 *   [unrecognised roles] → laterality (always last)
 *
 * The named-class head (index 0) is never moved. Expressions containing a
 * top-level `or` (outside quoted labels, IRIs, and parentheses) are returned
 * unchanged — this does not interfere with role names like `'All or part of'`
 * whose `or` is inside single quotes.
 */
export function sortManchesterConjuncts(expr: string): string {
  if (!expr) { return expr; }

  if (hasTopLevelToken(expr, ' or ')) { return expr; }

  const conjuncts = splitTopLevelConjuncts(expr);
  if (conjuncts.length <= 1) { return expr; }

  const head = conjuncts[0];
  const tail = conjuncts.slice(1);

  const bares: string[] = [];
  const known: Array<{ index: number; conjunct: string }> = [];
  const unknowns: string[] = [];
  const lateralityConjuncts: string[] = [];

  for (const c of tail) {
    const roleLower = extractRoleLower(c);
    if (roleLower.startsWith(LATERALITY_PREFIX)) {
      lateralityConjuncts.push(c);
    } else if (isBareNamedClass(c)) {
      bares.push(c);
    } else {
      let matched = false;
      for (let idx = 0; idx < CANONICAL_ROLE_PREFIXES.length; idx++) {
        if (roleLower.startsWith(CANONICAL_ROLE_PREFIXES[idx])) {
          known.push({ index: idx, conjunct: c });
          matched = true;
          break;
        }
      }
      if (!matched) { unknowns.push(c); }
    }
  }

  known.sort((a, b) => a.index - b.index);

  return [head, ...bares, ...known.map(k => k.conjunct), ...unknowns, ...lateralityConjuncts].join(' and ');
}
