import { describe, it, expect } from 'vitest';
import { computeLineDiff, canApplyIncremental } from './lineDiff';

describe('computeLineDiff', () => {
  it('reports identical when strings are equal', () => {
    const text = 'line1\nline2\nline3\n';
    const d = computeLineDiff(text, text);
    expect(d.identical).toBe(true);
  });

  it('finds a single-line edit in the middle', () => {
    const oldText = 'line1\nline2\nline3\n';
    const newText = 'line1\nLINE-2\nline3\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.identical).toBe(false);
    expect(d.oldStartLine).toBe(1);
    expect(d.oldEndLine).toBe(2);
    expect(d.newStartLine).toBe(1);
    expect(d.newEndLine).toBe(2);
  });

  it('finds an insertion of one line in the middle', () => {
    const oldText = 'a\nb\nc\n';
    const newText = 'a\nNEW\nb\nc\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.identical).toBe(false);
    expect(d.oldStartLine).toBe(1);
    expect(d.oldEndLine).toBe(1);
    expect(d.newStartLine).toBe(1);
    expect(d.newEndLine).toBe(2);
  });

  it('finds a deletion of one line in the middle', () => {
    const oldText = 'a\nb\nc\n';
    const newText = 'a\nc\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.identical).toBe(false);
    expect(d.oldStartLine).toBe(1);
    expect(d.oldEndLine).toBe(2);
    expect(d.newStartLine).toBe(1);
    expect(d.newEndLine).toBe(1);
  });

  it('returns char ranges aligned to line boundaries', () => {
    const oldText = 'a\nb\nc\n';
    const newText = 'a\nB\nc\n';
    const d = computeLineDiff(oldText, newText);
    // 'a\n' = 2, 'b\n' = 2, 'c\n' = 2. Old line 1 is chars [2,4).
    expect(d.oldStartChar).toBe(2);
    expect(d.oldEndChar).toBe(4);
    expect(oldText.slice(d.oldStartChar, d.oldEndChar)).toBe('b\n');
    expect(newText.slice(d.newStartChar, d.newEndChar)).toBe('B\n');
  });

  it('handles change at the very start', () => {
    const oldText = 'a\nb\nc\n';
    const newText = 'X\nb\nc\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.oldStartLine).toBe(0);
    expect(d.oldEndLine).toBe(1);
    expect(d.newStartLine).toBe(0);
    expect(d.newEndLine).toBe(1);
  });

  it('handles change at the very end (no trailing newline)', () => {
    const oldText = 'a\nb\nc';
    const newText = 'a\nb\nC';
    const d = computeLineDiff(oldText, newText);
    expect(d.oldStartLine).toBe(2);
    expect(d.newStartLine).toBe(2);
  });

  it('handles change at the very end (with trailing newline)', () => {
    const oldText = 'a\nb\nc\n';
    const newText = 'a\nb\nC\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.oldStartLine).toBe(2);
    expect(d.oldEndLine).toBe(3);
    expect(d.newStartLine).toBe(2);
    expect(d.newEndLine).toBe(3);
  });

  it('coalesces multiple non-contiguous edits into one envelope', () => {
    const oldText = 'a\nb\nc\nd\ne\n';
    const newText = 'a\nB\nc\nD\ne\n';
    const d = computeLineDiff(oldText, newText);
    // Two separate changes; the diff envelope spans from first to last.
    expect(d.oldStartLine).toBe(1);
    expect(d.oldEndLine).toBe(4);
    expect(d.newStartLine).toBe(1);
    expect(d.newEndLine).toBe(4);
  });

  it('handles append-only change', () => {
    const oldText = 'a\nb\n';
    const newText = 'a\nb\nc\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.oldStartLine).toBe(2);
    expect(d.oldEndLine).toBe(2);
    expect(d.newStartLine).toBe(2);
    expect(d.newEndLine).toBe(3);
  });

  it('handles prepend-only change', () => {
    const oldText = 'b\nc\n';
    const newText = 'a\nb\nc\n';
    const d = computeLineDiff(oldText, newText);
    expect(d.oldStartLine).toBe(0);
    expect(d.oldEndLine).toBe(0);
    expect(d.newStartLine).toBe(0);
    expect(d.newEndLine).toBe(1);
  });
});

describe('canApplyIncremental', () => {
  const header = 'Prefix(:=<http://x/>)\nOntology(<http://o>)\n';

  it('allows identical', () => {
    const d = computeLineDiff('x', 'x');
    expect(canApplyIncremental('x', 'x', d)).toBe(true);
  });

  it('allows entity-body change', () => {
    const oldText = header + 'Declaration(Class(:A))\nSubClassOf(:A :B)\n)\n';
    const newText = header + 'Declaration(Class(:A))\nSubClassOf(:A :C)\n)\n';
    const d = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, d)).toBe(true);
  });

  it('rejects change touching a Prefix line', () => {
    const oldText = 'Prefix(:=<http://x/>)\nOntology(<http://o>)\nDeclaration(Class(:A))\n)\n';
    const newText = 'Prefix(:=<http://y/>)\nOntology(<http://o>)\nDeclaration(Class(:A))\n)\n';
    const d = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, d)).toBe(false);
  });

  it('rejects change touching the Ontology line', () => {
    const oldText = 'Prefix(:=<http://x/>)\nOntology(<http://v1>)\nDeclaration(Class(:A))\n)\n';
    const newText = 'Prefix(:=<http://x/>)\nOntology(<http://v2>)\nDeclaration(Class(:A))\n)\n';
    const d = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, d)).toBe(false);
  });

  it('rejects very large diffs (above absolute floor)', () => {
    // > 4KB and 100% changed → ratio exceeded.
    const oldText = 'A\n'.repeat(5000);
    const newText = 'B\n'.repeat(5000);
    const d = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, d)).toBe(false);
  });

  it('accepts small diffs in large files', () => {
    const oldText = header + 'Declaration(Class(:A))\n'.repeat(1000) + ')\n';
    const newText = oldText.replace('Declaration(Class(:A))\n', 'Declaration(Class(:Z))\n');
    const d = computeLineDiff(oldText, newText);
    expect(canApplyIncremental(oldText, newText, d)).toBe(true);
  });
});
