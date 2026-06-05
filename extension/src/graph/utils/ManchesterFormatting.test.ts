import { describe, it, expect } from 'vitest';
import { formatManchesterForDisplay, collectLogicalLines, stripAndContinuations, findFormatBreaks } from './ManchesterFormatting';

describe('formatManchesterForDisplay', () => {
  it('returns empty string unchanged', () => {
    expect(formatManchesterForDisplay('')).toBe('');
  });

  it('returns expression with no "and" unchanged', () => {
    expect(formatManchesterForDisplay('hasRole some Doctor')).toBe('hasRole some Doctor');
  });

  it('inserts newline+4-space indent before bare " and "', () => {
    expect(formatManchesterForDisplay('A and B')).toBe('A\n    and B');
  });

  it('handles multiple conjuncts', () => {
    expect(formatManchesterForDisplay('A and B and C')).toBe('A\n    and B\n    and C');
  });

  it('does NOT break at "and" inside IRI angle brackets', () => {
    const expr = '<http://example.org/land> and <http://example.org/standard>';
    expect(formatManchesterForDisplay(expr)).toBe('<http://example.org/land>\n    and <http://example.org/standard>');
  });

  it('does NOT break at "and" inside IRI — no breaks within the IRI itself', () => {
    const expr = '<http://example.org/bandana>';
    expect(formatManchesterForDisplay(expr)).toBe('<http://example.org/bandana>');
  });

  it('does NOT break at "and" inside double-quoted string literal', () => {
    const expr = 'hasName value "bread and butter"';
    expect(formatManchesterForDisplay(expr)).toBe('hasName value "bread and butter"');
  });

  it('does NOT break at "and" inside single-quoted label', () => {
    const expr = "'Milk and Honey' and Dog";
    expect(formatManchesterForDisplay(expr)).toBe("'Milk and Honey'\n    and Dog");
  });

  it('handles escaped quote inside double-quoted string', () => {
    const expr = 'hasName value "say \\"and\\" here" and Dog';
    expect(formatManchesterForDisplay(expr)).toBe('hasName value "say \\"and\\" here"\n    and Dog');
  });

  it('handles escaped quote inside single-quoted label', () => {
    const expr = "'can\\'t and won\\'t' and Dog";
    expect(formatManchesterForDisplay(expr)).toBe("'can\\'t and won\\'t'\n    and Dog");
  });

  it('does NOT break when " and " is at the end of the expression (no content after)', () => {
    expect(formatManchesterForDisplay('A and ')).toBe('A and ');
  });

  it('does NOT break when " and " is followed only by whitespace', () => {
    expect(formatManchesterForDisplay('A and  ')).toBe('A and  ');
  });

  it('DOES break when " and " is followed by a non-whitespace character', () => {
    expect(formatManchesterForDisplay("'Body structure' and 'All or part of' some 'Entire liver'"))
      .toBe("'Body structure'\n    and 'All or part of' some 'Entire liver'");
  });

  it('is idempotent — applying twice produces same result', () => {
    const expr = 'A and B and C';
    expect(formatManchesterForDisplay(formatManchesterForDisplay(expr)))
      .toBe(formatManchesterForDisplay(expr));
  });

  it('handles realistic SNOMED-style expression', () => {
    const expr = 'hasRole some TreatmentRole and hasLocation some Lung and hasCause some Infection';
    expect(formatManchesterForDisplay(expr))
      .toBe('hasRole some TreatmentRole\n    and hasLocation some Lung\n    and hasCause some Infection');
  });
});

describe('findFormatBreaks', () => {
  it('returns empty array for expression with no "and"', () => {
    expect(findFormatBreaks('hasRole some Doctor')).toEqual([]);
  });

  it('returns one break for a single conjunct', () => {
    expect(findFormatBreaks('A and B')).toEqual([1]);
  });

  it('returns two breaks for two conjuncts', () => {
    expect(findFormatBreaks('A and B and C')).toEqual([1, 7]);
  });

  it('returns no break when " and " has no content after (trailing)', () => {
    expect(findFormatBreaks('A and ')).toEqual([]);
  });

  it('does NOT return a break for "and" inside IRI brackets', () => {
    expect(findFormatBreaks('<http://example.org/land> and <http://example.org/Y>')).toEqual([25]);
  });

  it('does NOT return a break for "and" inside single-quoted label', () => {
    expect(findFormatBreaks("'Milk and Honey' and Dog")).toEqual([16]);
  });

  it('returns correct positions for a realistic SNOMED expression', () => {
    const expr = "'Body structure' and 'All or part of' some 'Entire liver'";
    expect(findFormatBreaks(expr)).toEqual([16]);
  });
});

describe('collectLogicalLines', () => {
  it('returns empty array for empty string', () => {
    expect(collectLogicalLines('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(collectLogicalLines('   \n  \n')).toEqual([]);
  });

  it('returns one-element array for single expression with no and', () => {
    expect(collectLogicalLines('hasRole some Doctor')).toEqual(['hasRole some Doctor']);
  });

  it('returns two-element array for two separate single-line expressions', () => {
    expect(collectLogicalLines('hasRole some Doctor\nhasAge min 18')).toEqual([
      'hasRole some Doctor',
      'hasAge min 18',
    ]);
  });

  it('joins continuation "and " line with predecessor', () => {
    expect(collectLogicalLines('hasRole some Doctor\n    and hasLocation some Hospital')).toEqual([
      'hasRole some Doctor and hasLocation some Hospital',
    ]);
  });

  it('joins multiple continuation lines', () => {
    expect(collectLogicalLines('A\n    and B\n    and C')).toEqual(['A and B and C']);
  });

  it('skips blank lines', () => {
    expect(collectLogicalLines('A\n\nB')).toEqual(['A', 'B']);
  });

  it('skips comment lines starting with #', () => {
    expect(collectLogicalLines('# comment\nA and B')).toEqual(['A and B']);
  });

  it('handles continuation line with no preceding expression (malformed) as standalone entry', () => {
    expect(collectLogicalLines('    and B')).toEqual(['and B']);
  });

  it('handles two formatted expressions', () => {
    const raw = 'A\n    and B\nC\n    and D';
    expect(collectLogicalLines(raw)).toEqual(['A and B', 'C and D']);
  });

  it('trims leading/trailing whitespace from lines', () => {
    expect(collectLogicalLines('  A  \n  and B  ')).toEqual(['A and B']);
  });
});

describe('stripAndContinuations', () => {
  it('returns empty string for empty input', () => {
    expect(stripAndContinuations('')).toBe('');
  });

  it('returns the single expression unchanged (no and)', () => {
    expect(stripAndContinuations('hasRole some Doctor')).toBe('hasRole some Doctor');
  });

  it('joins continuation lines into a single line', () => {
    expect(stripAndContinuations('A\n    and B\n    and C')).toBe('A and B and C');
  });

  it('equals collectLogicalLines(raw).join(" ") for single-expression input', () => {
    const raw = 'hasRole some Doctor\n    and hasLocation some Hospital\n    and hasCause some Infection';
    expect(stripAndContinuations(raw))
      .toBe(collectLogicalLines(raw).join(' '));
  });

  it('equals collectLogicalLines(raw).join(" ") for blank input', () => {
    expect(stripAndContinuations('   ')).toBe(collectLogicalLines('   ').join(' '));
  });
});

describe('round-trip invariant', () => {
  it('collectLogicalLines(formatManchesterForDisplay(e)) returns [e] for single expression', () => {
    const exprs = [
      'hasRole some Doctor',
      'hasRole some Doctor and hasLocation some Hospital',
      'A and B and C and D and E',
      '<http://example.org/X> and <http://example.org/Y>',
    ];
    for (const e of exprs) {
      expect(collectLogicalLines(formatManchesterForDisplay(e))).toEqual([e]);
    }
  });

  it('collectLogicalLines(formatted multi-expression) returns original array', () => {
    const exprs = [
      'hasRole some Doctor and hasLocation some Hospital',
      'hasAge min 18',
      'A and B and C',
    ];
    const joined = exprs.map(e => formatManchesterForDisplay(e)).join('\n');
    expect(collectLogicalLines(joined)).toEqual(exprs);
  });
});
