/**
 * Coarse line-level diff between two strings, optimized for the case where
 * the change is localized — typical for an external edit to one or a few
 * entity clusters inside a multi-hundred-megabyte ontology.
 *
 * Strategy: find the longest common char-level prefix and suffix, then snap
 * those boundaries to line breaks. The result describes ONE contiguous range
 * in each side that contains all the changes. (If the user made multiple
 * non-contiguous edits the range covers everything between the first and
 * last change — incremental-reload callers will walk lines within that range
 * and re-parse each affected entity separately.)
 *
 * Cost: O(N) char comparisons + O(N) newline counts via two passes. No
 * `split('\n')` call, so memory stays at O(1) extra for both inputs.
 */

export interface LineDiff {
  /** True iff `oldText === newText` (no work needed). */
  identical: boolean;
  /** Line range in oldText that contains the change (0-based, end exclusive). */
  oldStartLine: number;
  oldEndLine: number;
  /** Line range in newText that contains the change. */
  newStartLine: number;
  newEndLine: number;
  /** Char offsets aligned to line boundaries (start of a line; end is past a \n). */
  oldStartChar: number;
  oldEndChar: number;
  newStartChar: number;
  newEndChar: number;
}

const LF = 10;

export function computeLineDiff(oldText: string, newText: string): LineDiff {
  if (oldText === newText) {
    return {
      identical: true,
      oldStartLine: 0, oldEndLine: 0,
      newStartLine: 0, newEndLine: 0,
      oldStartChar: 0, oldEndChar: 0,
      newStartChar: 0, newEndChar: 0,
    };
  }

  const oldLen = oldText.length;
  const newLen = newText.length;
  const minLen = Math.min(oldLen, newLen);

  // Common char prefix.
  let i = 0;
  while (i < minLen && oldText.charCodeAt(i) === newText.charCodeAt(i)) i++;

  // Snap prefix back to the start of the line containing the first diff char.
  let oldStartChar = i;
  while (oldStartChar > 0 && oldText.charCodeAt(oldStartChar - 1) !== LF) oldStartChar--;
  const newStartChar = oldStartChar;

  // Common char suffix — but never let it overlap the prefix on either side.
  const maxSuffix = Math.min(oldLen - oldStartChar, newLen - newStartChar);
  let j = 0;
  while (
    j < maxSuffix &&
    oldText.charCodeAt(oldLen - 1 - j) === newText.charCodeAt(newLen - 1 - j)
  ) j++;

  // The last differing char in old is at oldLen - j - 1. If oldEndChar is
  // already at a line boundary (start of file OR previous char is \n) the
  // common suffix begins at a clean line break and we leave it alone. Only
  // when the diff ends mid-line do we extend forward to the next \n so the
  // range covers a whole line.
  let oldEndChar = oldLen - j;
  if (oldEndChar > 0 && oldText.charCodeAt(oldEndChar - 1) !== LF) {
    while (oldEndChar < oldLen && oldText.charCodeAt(oldEndChar) !== LF) oldEndChar++;
    if (oldEndChar < oldLen) oldEndChar++; // include the \n
  }
  // Mirror on the new side: the unchanged suffix length is the same.
  const unchangedSuffixLen = oldLen - oldEndChar;
  const newEndChar = newLen - unchangedSuffixLen;

  // Convert char ranges to line numbers. Single linear scans (not full splits)
  // — for SNOMED-scale, the prefix walk dominates and is bounded by N.
  let oldStartLine = 0;
  for (let p = 0; p < oldStartChar; p++) {
    if (oldText.charCodeAt(p) === LF) oldStartLine++;
  }
  const newStartLine = oldStartLine;

  let oldEndLine = oldStartLine;
  for (let p = oldStartChar; p < oldEndChar; p++) {
    if (oldText.charCodeAt(p) === LF) oldEndLine++;
  }

  let newEndLine = newStartLine;
  for (let p = newStartChar; p < newEndChar; p++) {
    if (newText.charCodeAt(p) === LF) newEndLine++;
  }

  return {
    identical: false,
    oldStartLine, oldEndLine,
    newStartLine, newEndLine,
    oldStartChar, oldEndChar,
    newStartChar, newEndChar,
  };
}

// ── Phase 2b: safety classification of a diff ────────────────────────────────

const HEADER_LINE_PREFIXES = ['Prefix(', 'Ontology(', 'Import('];

function regionContainsHeaderLine(text: string, startChar: number, endChar: number): boolean {
  let lineStart = startChar;
  for (let i = startChar; i <= endChar; i++) {
    if (i === endChar || text.charCodeAt(i) === LF) {
      // Inline trim of leading whitespace.
      let s = lineStart;
      while (s < i && (text.charCodeAt(s) === 32 || text.charCodeAt(s) === 9)) s++;
      for (const p of HEADER_LINE_PREFIXES) {
        if (i - s >= p.length) {
          let match = true;
          for (let k = 0; k < p.length; k++) {
            if (text.charCodeAt(s + k) !== p.charCodeAt(k)) { match = false; break; }
          }
          if (match) return true;
        }
      }
      lineStart = i + 1;
    }
  }
  return false;
}

/**
 * Decide whether the diff is safe to apply incrementally or whether the caller
 * must fall back to a full re-parse.
 *
 * Rejects (returns false) when:
 *   - The changed region on either side touches a Prefix/Ontology/Import line.
 *     These define IRI resolution and ontology identity; any change invalidates
 *     entity references throughout the model.
 *   - The changed region exceeds `maxChangedRatio` of either file. Past that,
 *     incremental work likely costs more than a clean re-parse.
 *
 * The `identical` case is treated as trivially incremental-safe (caller will
 * still skip via the earlier mtime/size short-circuit, but the predicate is
 * total so callers can rely on it without a separate check).
 */
export function canApplyIncremental(
  oldText: string,
  newText: string,
  diff: LineDiff,
  maxChangedRatio = 0.2,
): boolean {
  if (diff.identical) return true;

  // Size guard: skip incremental when the change covers most of the file. The
  // floor (4 KB) keeps the predicate meaningful for big files without
  // misfiring on tiny ones where small absolute changes can be a large %.
  const ABSOLUTE_FLOOR_BYTES = 4096;
  const oldLen = Math.max(1, oldText.length);
  const newLen = Math.max(1, newText.length);
  const oldChanged = diff.oldEndChar - diff.oldStartChar;
  const newChanged = diff.newEndChar - diff.newStartChar;
  if (oldChanged > ABSOLUTE_FLOOR_BYTES && oldChanged / oldLen > maxChangedRatio) return false;
  if (newChanged > ABSOLUTE_FLOOR_BYTES && newChanged / newLen > maxChangedRatio) return false;

  if (regionContainsHeaderLine(oldText, diff.oldStartChar, diff.oldEndChar)) return false;
  if (regionContainsHeaderLine(newText, diff.newStartChar, diff.newEndChar)) return false;

  return true;
}
