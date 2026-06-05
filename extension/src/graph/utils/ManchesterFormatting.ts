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
