import * as vscode from 'vscode';

/**
 * Minimal TextDocument-like wrapper around a raw text string.
 * Implements only the subset of vscode.TextDocument used by AnnotationSync and AxiomSync:
 * getText(), uri, lineAt(). Cast to vscode.TextDocument with `as unknown` for sync functions.
 */
export class RawTextDocument {
  private _lines: string[] | null = null;

  constructor(readonly uri: vscode.Uri, private readonly _text: string) {}

  getText(): string { return this._text; }

  lineAt(line: number) {
    if (!this._lines) this._lines = this._text.split('\n');
    const text = this._lines[line] ?? '';
    const isLast = line >= this._lines.length - 1;
    return {
      text,
      range: new vscode.Range(line, 0, line, text.length),
      rangeIncludingLineBreak: isLast
        ? new vscode.Range(line, 0, line, text.length)
        : new vscode.Range(line, 0, line + 1, 0),
    };
  }
}

/**
 * Sum the net line change implied by a WorkspaceEdit. For each TextEdit:
 *   delta += (newlines in newText) - (range.end.line - range.start.line)
 * Constant work per edit — avoids slicing/scanning the post-edit text.
 */
export function countLineDelta(edit: vscode.WorkspaceEdit): number {
  let delta = 0;
  for (const [, edits] of edit.entries()) {
    for (const e of edits) {
      const removed = e.range.end.line - e.range.start.line;
      let added = 0;
      const t = e.newText;
      for (let i = 0; i < t.length; i++) { if (t.charCodeAt(i) === 10) added++; }
      delta += added - removed;
    }
  }
  return delta;
}

/**
 * Apply all TextEdits from a WorkspaceEdit to a text string without using VS Code's
 * document synchronization API. Edits are applied in reverse document order so
 * character offsets stay valid across iterations.
 */
/**
 * Apply all TextEdits from a WorkspaceEdit to a text string without using VS Code's
 * document synchronization API. Edits are applied in reverse document order so
 * character offsets stay valid across iterations.
 *
 * hint: optional known char offset for a line in the edit range. When the edits are
 * confined to a small cluster (e.g. one entity in a 2.9M-line file), supplying
 * { startLine, startChar } from the EntitySegment lets us scan only the cluster lines
 * to build the offset table instead of splitting the entire file (O(cluster) vs O(N)).
 * Without a hint the original O(N) full-split path is used — safe for any Range form.
 */
/**
 * Per-edit summary in absolute char + line coordinates. Used by incremental
 * segment-index update to know exactly where bytes were inserted/removed.
 */
export interface OffsetEdit {
  oldStartLine: number;
  oldEndLine: number;
  oldStartChar: number;
  oldEndChar: number;
  newText: string;
}

export function applyWorkspaceEditsToText(
  text: string,
  edit: vscode.WorkspaceEdit,
  hint?: { startLine: number; startChar: number },
  outOffsetEdits?: OffsetEdit[],
): string {
  const allEdits = edit.entries().flatMap(([, edits]) => edits);
  if (allEdits.length === 0) { return text; }

  const pushSummary = (e: vscode.TextEdit, start: number, end: number): void => {
    if (outOffsetEdits) {
      outOffsetEdits.push({
        oldStartLine: e.range.start.line,
        oldEndLine: e.range.end.line,
        oldStartChar: start,
        oldEndChar: end,
        newText: e.newText,
      });
    }
  };

  if (hint) {
    // Fast path: scan only from hint.startLine to the highest edit end-line.
    // Requires all edit ranges to use numeric line numbers (guaranteed for functional sync).
    const maxLine = allEdits.reduce((m, e) => Math.max(m, e.range.end.line ?? 0), hint.startLine);
    const numOffsets = maxLine - hint.startLine + 2;
    const offsets: number[] = new Array(numOffsets);
    offsets[0] = hint.startChar;
    let p = hint.startChar;
    for (let i = 0; i < numOffsets - 1; i++) {
      const nl = text.indexOf('\n', p);
      if (nl < 0) {
        for (let j = i + 1; j < numOffsets; j++) offsets[j] = text.length;
        break;
      }
      offsets[i + 1] = nl + 1;
      p = nl + 1;
    }
    const toPos = (l: number, c: number): number => {
      const idx = l - hint.startLine;
      return (idx >= 0 && idx < offsets.length ? offsets[idx] : text.length) + c;
    };
    const sorted = [...allEdits].sort(
      (a, b) => toPos(b.range.start.line, b.range.start.character) - toPos(a.range.start.line, a.range.start.character),
    );
    let result = text;
    for (const e of sorted) {
      const start = toPos(e.range.start.line, e.range.start.character);
      const end = toPos(e.range.end.line, e.range.end.character);
      pushSummary(e, start, end);
      result = result.slice(0, start) + e.newText + result.slice(end);
    }
    return result;
  }

  // Safe path (O(N)): build the full line offset table.
  // Handles Range(Position, Position) form used by Manchester/Turtle sync.
  const lines = text.split('\n');
  const offsets: number[] = new Array(lines.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i + 1] = offsets[i] + lines[i].length + 1;
  }
  const pos = (l: number, c: number): number => (offsets[l] ?? offsets[offsets.length - 1]) + c;
  const sorted = [...allEdits].sort(
    (a, b) => pos(b.range.start.line, b.range.start.character) - pos(a.range.start.line, a.range.start.character),
  );
  let result = text;
  for (const e of sorted) {
    const start = pos(e.range.start.line, e.range.start.character);
    const end = pos(e.range.end.line, e.range.end.character);
    pushSummary(e, start, end);
    result = result.slice(0, start) + e.newText + result.slice(end);
  }
  return result;
}
