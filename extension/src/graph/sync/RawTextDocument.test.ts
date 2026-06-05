import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  Range: vi.fn((sl: number, sc: number, el: number, ec: number) => ({
    start: { line: sl, character: sc },
    end: { line: el, character: ec },
  })),
  Uri: {},
}));

import { RawTextDocument, countLineDelta, applyWorkspaceEditsToText } from './RawTextDocument.js';
import type * as vscode from 'vscode';

function makeUri(s: string) {
  return { scheme: 'file', fsPath: s, toString: () => `file://${s}` } as unknown as vscode.Uri;
}

function makeEdit(
  sl: number, sc: number, el: number, ec: number, newText: string,
): vscode.TextEdit {
  return {
    range: { start: { line: sl, character: sc }, end: { line: el, character: ec } } as vscode.Range,
    newText,
  } as vscode.TextEdit;
}

function makeWorkspaceEdit(entries: [vscode.Uri, vscode.TextEdit[]][]): vscode.WorkspaceEdit {
  return {
    entries: () => entries,
  } as unknown as vscode.WorkspaceEdit;
}

// ────────────────────────────────────────────────────────────
// RawTextDocument
// ────────────────────────────────────────────────────────────

describe('RawTextDocument', () => {
  it('getText returns original text', () => {
    const doc = new RawTextDocument(makeUri('/a.ofn'), 'line0\nline1\n');
    expect(doc.getText()).toBe('line0\nline1\n');
  });

  it('lineAt returns correct text for each line', () => {
    const doc = new RawTextDocument(makeUri('/a.ofn'), 'foo\nbar\nbaz');
    expect(doc.lineAt(0).text).toBe('foo');
    expect(doc.lineAt(1).text).toBe('bar');
    expect(doc.lineAt(2).text).toBe('baz');
  });

  it('lineAt returns empty string for out-of-bounds line', () => {
    const doc = new RawTextDocument(makeUri('/a.ofn'), 'only');
    expect(doc.lineAt(99).text).toBe('');
  });

  it('lineAt rangeIncludingLineBreak ends at start of next line for non-last lines', () => {
    const doc = new RawTextDocument(makeUri('/a.ofn'), 'aaa\nbbb\n');
    const r = doc.lineAt(0).rangeIncludingLineBreak;
    expect(r.start).toEqual({ line: 0, character: 0 });
    expect(r.end).toEqual({ line: 1, character: 0 });
  });

  it('lineAt rangeIncludingLineBreak equals range for last line', () => {
    const doc = new RawTextDocument(makeUri('/a.ofn'), 'aaa\nbbb');
    const r = doc.lineAt(1).rangeIncludingLineBreak;
    expect(r.end).toEqual({ line: 1, character: 3 });
  });

  it('uri is exposed on the instance', () => {
    const uri = makeUri('/x.ofn');
    const doc = new RawTextDocument(uri, 'text');
    expect(doc.uri).toBe(uri);
  });
});

// ────────────────────────────────────────────────────────────
// countLineDelta
// ────────────────────────────────────────────────────────────

describe('countLineDelta', () => {
  it('returns 0 for empty WorkspaceEdit', () => {
    const edit = makeWorkspaceEdit([]);
    expect(countLineDelta(edit)).toBe(0);
  });

  it('counts net lines for a single replacement', () => {
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [makeEdit(2, 0, 3, 0, 'new line 1\nnew line 2\n')]]]);
    // removed 1 line (2→3), added 2 newlines → net +1
    expect(countLineDelta(edit)).toBe(1);
  });

  it('returns negative delta for deletion', () => {
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [makeEdit(1, 0, 4, 0, '')]]]);
    // removed 3 lines, added 0 → net -3
    expect(countLineDelta(edit)).toBe(-3);
  });

  it('sums across multiple edits', () => {
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [
      makeEdit(0, 0, 1, 0, 'a\nb\n'), // -1 + 2 = +1
      makeEdit(5, 0, 7, 0, ''),        // -2 + 0 = -2
    ]]]);
    expect(countLineDelta(edit)).toBe(-1);
  });
});

// ────────────────────────────────────────────────────────────
// applyWorkspaceEditsToText — safe path (no hint)
// ────────────────────────────────────────────────────────────

describe('applyWorkspaceEditsToText (safe path)', () => {
  it('returns text unchanged for empty edit', () => {
    const text = 'line0\nline1\n';
    const edit = makeWorkspaceEdit([]);
    expect(applyWorkspaceEditsToText(text, edit)).toBe(text);
  });

  it('replaces a single line', () => {
    const text = 'line0\nline1\nline2\n';
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [makeEdit(1, 0, 2, 0, 'REPLACED\n')]]]);
    expect(applyWorkspaceEditsToText(text, edit)).toBe('line0\nREPLACED\nline2\n');
  });

  it('inserts text at a position', () => {
    const text = 'aaa\nbbb\n';
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [makeEdit(1, 0, 1, 0, 'inserted\n')]]]);
    expect(applyWorkspaceEditsToText(text, edit)).toBe('aaa\ninserted\nbbb\n');
  });

  it('deletes a line', () => {
    const text = 'aaa\nbbb\nccc\n';
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [makeEdit(1, 0, 2, 0, '')]]]);
    expect(applyWorkspaceEditsToText(text, edit)).toBe('aaa\nccc\n');
  });

  it('applies multiple edits in reverse order', () => {
    const text = 'line0\nline1\nline2\n';
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [
      makeEdit(0, 0, 1, 0, 'A\n'),
      makeEdit(2, 0, 3, 0, 'C\n'),
    ]]]);
    expect(applyWorkspaceEditsToText(text, edit)).toBe('A\nline1\nC\n');
  });

  it('populates outOffsetEdits with char offsets', () => {
    const text = 'aaa\nbbb\n';
    const uri = makeUri('/a.ofn');
    const edit = makeWorkspaceEdit([[uri, [makeEdit(1, 0, 2, 0, 'X\n')]]]);
    const out: import('./RawTextDocument.js').OffsetEdit[] = [];
    applyWorkspaceEditsToText(text, edit, undefined, out);
    expect(out).toHaveLength(1);
    expect(out[0].oldStartChar).toBe(4);
    expect(out[0].oldEndChar).toBe(8);
    expect(out[0].newText).toBe('X\n');
  });
});

// ────────────────────────────────────────────────────────────
// applyWorkspaceEditsToText — fast path (with hint)
// ────────────────────────────────────────────────────────────

describe('applyWorkspaceEditsToText (hint/fast path)', () => {
  it('produces same result as safe path for a simple replacement', () => {
    const text = 'line0\nline1\nline2\n';
    const uri = makeUri('/a.ofn');
    const edits = [makeEdit(1, 0, 2, 0, 'REPLACED\n')];
    const edit = makeWorkspaceEdit([[uri, edits]]);
    const hint = { startLine: 1, startChar: 6 }; // offset of 'line1\n'
    const result = applyWorkspaceEditsToText(text, edit, hint);
    expect(result).toBe('line0\nREPLACED\nline2\n');
  });

  it('populates outOffsetEdits with hint-derived offsets', () => {
    const text = 'aaa\nbbb\nccc\n';
    const uri = makeUri('/a.ofn');
    const edits = [makeEdit(2, 0, 3, 0, 'ZZZ\n')];
    const edit = makeWorkspaceEdit([[uri, edits]]);
    const out: import('./RawTextDocument.js').OffsetEdit[] = [];
    applyWorkspaceEditsToText(text, edit, { startLine: 2, startChar: 8 }, out);
    expect(out[0].oldStartChar).toBe(8);
    expect(out[0].oldEndChar).toBe(12);
    expect(out[0].newText).toBe('ZZZ\n');
  });
});
