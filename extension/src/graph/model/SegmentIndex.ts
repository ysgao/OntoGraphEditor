import type { OntologyModel, EntitySegment } from './OntologyModel';

// ── Low-allocation IRI/CURIE token extraction helpers ─────────────────────────
//
// OWL Functional Syntax entity references take two forms:
//   1. Full IRI:  <http://snomed.info/id/272379006>
//   2. CURIE:     :272379006   or   prefix:localName
//
// SNOMED-style ontologies use almost exclusively CURIE form, so the extractor
// must recognise both. Token positions are 1-based and skip keywords like
// "Class", "ObjectProperty", "ObjectSomeValuesFrom" (uppercase-leading, no colon).

// Char codes for fast comparison
const CH_SPACE = 32;
const CH_TAB = 9;
const CH_LPAREN = 40;
const CH_RPAREN = 41;
const CH_COMMA = 44;
const CH_LT = 60;
const CH_GT = 62;
const CH_DQUOTE = 34;
const CH_BACKSLASH = 92;
const CH_COLON = 58;
const CH_CR = 13;

function isDelimiter(ch: number): boolean {
  return ch === CH_SPACE || ch === CH_TAB || ch === CH_LPAREN || ch === CH_RPAREN
      || ch === CH_COMMA || ch === CH_LT || ch === CH_GT || ch === CH_DQUOTE
      || ch === CH_CR;
}

/**
 * Find the Nth IRI-or-CURIE token in raw[from..to) and return its full IRI form,
 * looked up via knownTokens. Returns null if the Nth token is unknown or absent.
 *
 * Tokens counted: <full-iri> brackets, or any sequence with ':' in it (CURIE).
 * Tokens skipped: whitespace, structural chars, string literals, keywords with no ':'.
 */
function extractNthEntityToken(
  raw: string, from: number, to: number, n: number,
  knownTokens: Map<string, string>,
): string | null {
  let count = 0;
  let pos = from;
  while (pos < to) {
    const c = raw.charCodeAt(pos);
    if (c === CH_SPACE || c === CH_TAB || c === CH_LPAREN || c === CH_RPAREN || c === CH_COMMA || c === CH_GT || c === CH_CR) {
      pos++; continue;
    }
    if (c === CH_DQUOTE) {
      pos++;
      while (pos < to && raw.charCodeAt(pos) !== CH_DQUOTE) {
        if (raw.charCodeAt(pos) === CH_BACKSLASH) pos++;
        pos++;
      }
      pos++;
      continue;
    }
    if (c === CH_LT) {
      const gt = raw.indexOf('>', pos + 1);
      if (gt < 0 || gt >= to) return null;
      count++;
      if (count === n) {
        return knownTokens.get(raw.slice(pos + 1, gt)) ?? null;
      }
      pos = gt + 1;
      continue;
    }
    // Scan a potential CURIE or keyword token
    let j = pos;
    let hasColon = false;
    while (j < to) {
      const ch = raw.charCodeAt(j);
      if (isDelimiter(ch)) break;
      if (ch === CH_COLON) hasColon = true;
      j++;
    }
    if (hasColon) {
      count++;
      if (count === n) {
        return knownTokens.get(raw.slice(pos, j)) ?? null;
      }
    }
    if (j === pos) {
      pos++;
      continue;
    }
    pos = j;
  }
  return null;
}

function extractLastEntityToken(
  raw: string, from: number, to: number,
  knownTokens: Map<string, string>,
): string | null {
  let lastMatch: string | null = null;
  let pos = from;
  while (pos < to) {
    const c = raw.charCodeAt(pos);
    if (c === CH_SPACE || c === CH_TAB || c === CH_LPAREN || c === CH_RPAREN || c === CH_COMMA || c === CH_GT || c === CH_CR) {
      pos++; continue;
    }
    if (c === CH_DQUOTE) {
      pos++;
      while (pos < to && raw.charCodeAt(pos) !== CH_DQUOTE) {
        if (raw.charCodeAt(pos) === CH_BACKSLASH) pos++;
        pos++;
      }
      pos++;
      continue;
    }
    if (c === CH_LT) {
      const gt = raw.indexOf('>', pos + 1);
      if (gt < 0 || gt >= to) break;
      const matched = knownTokens.get(raw.slice(pos + 1, gt));
      if (matched) lastMatch = matched;
      pos = gt + 1;
      continue;
    }
    let j = pos;
    let hasColon = false;
    while (j < to) {
      const ch = raw.charCodeAt(j);
      if (isDelimiter(ch)) break;
      if (ch === CH_COLON) hasColon = true;
      j++;
    }
    if (hasColon) {
      const matched = knownTokens.get(raw.slice(pos, j));
      if (matched) lastMatch = matched;
    }
    if (j === pos) {
      pos++;
      continue;
    }
    pos = j;
  }
  return lastMatch;
}

// Check if raw[pos..pos+prefix.length) equals prefix without allocating a string.
function rawStartsWith(raw: string, pos: number, lineEnd: number, prefix: string): boolean {
  const end = pos + prefix.length;
  if (end > lineEnd) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (raw.charCodeAt(pos + i) !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Parse Prefix(name:=<iri>) declarations from the file header. Stops at Ontology(.
 * Returns Map<prefixName, expansionIri> (prefixName may be '' for the default prefix).
 */
function parsePrefixes(raw: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  let pos = 0;
  const len = raw.length;
  while (pos < len) {
    const nl = raw.indexOf('\n', pos);
    const lineEnd = nl < 0 ? len : nl;

    if (rawStartsWith(raw, pos, lineEnd, 'Prefix(')) {
      const inside = pos + 'Prefix('.length;
      const eqIdx = raw.indexOf(':=', inside);
      if (eqIdx > 0 && eqIdx < lineEnd) {
        const name = raw.slice(inside, eqIdx);
        const ltIdx = eqIdx + 2;
        if (ltIdx < lineEnd && raw.charCodeAt(ltIdx) === CH_LT) {
          const gtIdx = raw.indexOf('>', ltIdx + 1);
          if (gtIdx > 0 && gtIdx < lineEnd) {
            prefixes.set(name, raw.slice(ltIdx + 1, gtIdx));
          }
        }
      }
    } else if (rawStartsWith(raw, pos, lineEnd, 'Ontology(')) {
      break;
    }

    if (nl < 0) break;
    pos = nl + 1;
  }
  return prefixes;
}

/**
 * Build a token→fullIri lookup. Each entity is registered under its full IRI form
 * AND its shortest CURIE form (using the prefix whose expansion is a longest match).
 */
function buildKnownTokens(
  model: OntologyModel,
  prefixes: Map<string, string>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  // Sort prefixes by expansion length descending so longest match wins.
  const prefixEntries: Array<[string, string]> = [...prefixes.entries()];
  prefixEntries.sort((a, b) => b[1].length - a[1].length);

  for (const map of [
    model.classes, model.objectProperties, model.dataProperties,
    model.annotationProperties, model.individuals,
  ] as const) {
    for (const iri of map.keys()) {
      lookup.set(iri, iri);
      for (const [name, expansion] of prefixEntries) {
        if (expansion.length === 0) continue;
        if (iri.length > expansion.length && iri.startsWith(expansion)) {
          const localName = iri.slice(expansion.length);
          lookup.set(name + ':' + localName, iri);
          break;
        }
      }
    }
  }
  return lookup;
}

interface SegmentBuilder {
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  indices: number[];
  charStarts: number[];
}

function updateSegmentBuilder(
  map: Map<string, SegmentBuilder>,
  iri: string,
  lineIndex: number,
  charOffset: number,
  lineLen: number,
): void {
  const seg = map.get(iri);
  if (seg === undefined) {
    map.set(iri, {
      startLine: lineIndex, endLine: lineIndex,
      startChar: charOffset, endChar: charOffset + lineLen,
      indices: [lineIndex], charStarts: [charOffset],
    });
  } else {
    seg.endLine = lineIndex;
    seg.endChar = charOffset + lineLen;
    seg.indices.push(lineIndex);
    seg.charStarts.push(charOffset);
  }
}

function finalizeSegments(builders: Map<string, SegmentBuilder>): Map<string, EntitySegment> {
  const out = new Map<string, EntitySegment>();
  for (const [iri, b] of builders) {
    out.set(iri, {
      startLine: b.startLine, endLine: b.endLine,
      startChar: b.startChar, endChar: b.endChar,
      lineIndices: new Int32Array(b.indices),
      lineCharStarts: new Int32Array(b.charStarts),
    });
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build entity segment and GCI segment indexes from model.rawContent.
 * Functional syntax only — other formats clear the fields and return.
 * Handles both <full-iri> and CURIE (prefix:local) forms.
 * O(N chars) single pass; intended for the parser worker thread.
 */
/**
 * Per-edit summary used by `applyIncrementalSegmentUpdate` to mutate the
 * segment maps in place without re-scanning the entire file. Positions are
 * pre-edit (i.e. against the text the sync function received as input).
 */
export interface EditSummary {
  /** Pre-edit line where the edit's old range starts. */
  oldStartLine: number;
  /** Pre-edit line where the edit's old range ends (exclusive of next line). */
  oldEndLine: number;
  /** Pre-edit absolute char offset where the edit starts. */
  oldStartChar: number;
  /** Pre-edit absolute char offset where the edit ends (exclusive). */
  oldEndChar: number;
  /** Replacement text. */
  newText: string;
  /** Which segment map this edit affects — 'entity' for the main cluster
   *  (entitySegments), 'gci' for the Complex Logic block (gciSegments). */
  segmentMap: 'entity' | 'gci';
}

export function buildModelSegmentIndex(model: OntologyModel): void {
  buildSegmentsInternal(model, null);
}

/**
 * Async variant that yields to the event loop every `yieldEveryNLines` lines.
 * Used after a save so the rebuild can interleave with the concurrent
 * `writeTextStreamed` — the stream's drain callbacks fire in our yield gaps,
 * so wall-clock cost is ~max(write, rebuild) instead of (write + rebuild).
 */
export async function buildModelSegmentIndexAsync(
  model: OntologyModel,
  yieldEveryNLines = 100_000,
): Promise<void> {
  await buildSegmentsInternal(model, yieldEveryNLines);
}

function buildSegmentsInternal(
  model: OntologyModel,
  yieldEveryNLines: number | null,
): void | Promise<void> {
  if (model.sourceFormat !== 'functional' || !model.rawContent) {
    model.entitySegments = undefined;
    model.gciSegments = undefined;
    model.closingParenLine = undefined;
    model.gciInsertLine = undefined;
    return;
  }

  const raw = model.rawContent;
  const segments = new Map<string, SegmentBuilder>();
  const gciSegs = new Map<string, SegmentBuilder>();

  const prefixes = parsePrefixes(raw);
  const knownTokens = buildKnownTokens(model, prefixes);

  let closingParenLine = -1;
  let gciInsertLine = -1;
  let charOffset = 0;
  let lineIndex = 0;
  let pos = 0;
  const rawLen = raw.length;

  if (yieldEveryNLines === null) {
    runLoopSync();
    finalize();
    return;
  }
  return (async () => {
    await runLoopAsync();
    finalize();
  })();

  function runLoopSync(): void {
    while (pos <= rawLen) { runOneLine(); }
  }

  async function runLoopAsync(): Promise<void> {
    let nextYieldAt = yieldEveryNLines!;
    while (pos <= rawLen) {
      runOneLine();
      if (lineIndex >= nextYieldAt) {
        nextYieldAt += yieldEveryNLines!;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
  }

  function finalize(): void {
    if (closingParenLine < 0) closingParenLine = Math.max(0, lineIndex - 1);
    if (gciInsertLine < 0) gciInsertLine = closingParenLine;

    model.entitySegments = finalizeSegments(segments);
    model.gciSegments = gciSegs.size > 0 ? finalizeSegments(gciSegs) : undefined;
    model.closingParenLine = closingParenLine;
    model.gciInsertLine = gciInsertLine;
  }

  function runOneLine(): void {
    const nlPos = raw.indexOf('\n', pos);
    const lineEnd = nlPos >= 0 ? nlPos : rawLen;
    const lineLen = lineEnd - pos;

    let wsEnd = pos;
    while (wsEnd < lineEnd && (raw.charCodeAt(wsEnd) === CH_SPACE || raw.charCodeAt(wsEnd) === CH_TAB)) wsEnd++;

    if (wsEnd < lineEnd) {
      const fc = raw[wsEnd];
      // Skip comment, Prefix, Ontology, Import lines
      if (fc !== '#' && fc !== 'P' && fc !== 'O' && fc !== 'I') {
        if (fc === ')') {
          if (wsEnd + 1 >= lineEnd || raw[wsEnd + 1] === '\r') {
            closingParenLine = lineIndex;
          }
        } else {
          let entityIri: string | null = null;

          if (rawStartsWith(raw, wsEnd, lineEnd, 'AnnotationAssertion(')) {
            // Universal rule: entity is 2nd token (1st = annotation property, 2nd = subject)
            entityIri = extractNthEntityToken(raw, wsEnd, lineEnd, 2, knownTokens);
          } else if (rawStartsWith(raw, wsEnd, lineEnd, 'Declaration(')) {
            entityIri = extractNthEntityToken(raw, wsEnd, lineEnd, 1, knownTokens);
          } else if (rawStartsWith(raw, wsEnd, lineEnd, 'SubObjectPropertyOf(ObjectPropertyChain(')) {
            entityIri = extractLastEntityToken(raw, wsEnd, lineEnd, knownTokens);
            if (gciInsertLine < 0) gciInsertLine = lineIndex;
          } else if (rawStartsWith(raw, wsEnd, lineEnd, 'ClassAssertion(') ||
                     rawStartsWith(raw, wsEnd, lineEnd, 'ObjectPropertyAssertion(') ||
                     rawStartsWith(raw, wsEnd, lineEnd, 'DataPropertyAssertion(')) {
            entityIri = extractNthEntityToken(raw, wsEnd, lineEnd, 2, knownTokens);
          } else if (rawStartsWith(raw, wsEnd, lineEnd, 'SubClassOf(')) {
            // Detect GCI vs regular by peeking past 'SubClassOf(': uppercase-leading keyword
            // (e.g. ObjectSomeValuesFrom) = GCI; <... or :... or lowercase: prefix = regular.
            let after = wsEnd + 'SubClassOf('.length;
            while (after < lineEnd && (raw.charCodeAt(after) === CH_SPACE || raw.charCodeAt(after) === CH_TAB)) after++;
            const firstCh = after < lineEnd ? raw.charCodeAt(after) : 0;
            const isExpr = firstCh >= 65 && firstCh <= 90; // 'A'..'Z'
            if (!isExpr) {
              entityIri = extractNthEntityToken(raw, wsEnd, lineEnd, 1, knownTokens);
            } else {
              const lastIri = extractLastEntityToken(raw, wsEnd, lineEnd, knownTokens);
              if (lastIri !== null) {
                updateSegmentBuilder(gciSegs, lastIri, lineIndex, charOffset, lineLen);
              }
              entityIri = null;
            }
          } else {
            entityIri = extractNthEntityToken(raw, wsEnd, lineEnd, 1, knownTokens);
          }

          if (entityIri !== null) {
            updateSegmentBuilder(segments, entityIri, lineIndex, charOffset, lineLen);
          }
        }
      }
    }

    charOffset += lineLen + 1;
    lineIndex++;
    pos = lineEnd + 1;
    if (nlPos < 0) { pos = rawLen + 1; }
  }
}

/**
 * Shift all entity/GCI segments that start after `afterLine` by `lineDelta` lines
 * and `charDelta` chars. Call after a sync write to keep the cache coherent.
 */
function shiftOne(seg: EntitySegment, afterLine: number, lineDelta: number, charDelta: number): void {
  if (seg.startLine > afterLine) {
    seg.startLine += lineDelta;
    seg.startChar += charDelta;
  }
  if (seg.endLine > afterLine) {
    seg.endLine += lineDelta;
    seg.endChar += charDelta;
  }
  if (seg.lineIndices && seg.lineCharStarts) {
    for (let i = 0; i < seg.lineIndices.length; i++) {
      if (seg.lineIndices[i] > afterLine) {
        seg.lineIndices[i] += lineDelta;
        seg.lineCharStarts[i] += charDelta;
      }
    }
  }
}

export function shiftSegmentsAfter(
  model: OntologyModel,
  afterLine: number,
  lineDelta: number,
  charDelta: number,
): void {
  if (!model.entitySegments) return;

  for (const seg of model.entitySegments.values()) shiftOne(seg, afterLine, lineDelta, charDelta);
  if (model.gciSegments) {
    for (const seg of model.gciSegments.values()) shiftOne(seg, afterLine, lineDelta, charDelta);
  }

  if (model.closingParenLine !== undefined && model.closingParenLine > afterLine) {
    model.closingParenLine += lineDelta;
  }
  if (model.gciInsertLine !== undefined && model.gciInsertLine > afterLine) {
    model.gciInsertLine += lineDelta;
  }
}

// ── Incremental segment update ───────────────────────────────────────────────

function shiftSegOnEditBoundary(
  seg: EntitySegment, afterLine: number, lineDelta: number, charDelta: number,
): void {
  if (seg.startLine >= afterLine) {
    seg.startLine += lineDelta;
    seg.startChar += charDelta;
  }
  if (seg.endLine >= afterLine) {
    seg.endLine += lineDelta;
    seg.endChar += charDelta;
  }
  if (seg.lineIndices && seg.lineCharStarts) {
    for (let i = 0; i < seg.lineIndices.length; i++) {
      if (seg.lineIndices[i] >= afterLine) {
        seg.lineIndices[i] += lineDelta;
        seg.lineCharStarts[i] += charDelta;
      }
    }
  }
}

function newlineCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Char offsets of each non-empty line start in `text`. For "abc\ndef\n" →
 * [0, 4]. For "abc\n" → [0]. For "" → [].
 */
function lineStartsIn(text: string): number[] {
  if (text.length === 0) return [];
  const starts: number[] = [0];
  for (let i = 0; i < text.length - 1; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function recomputeSegmentBounds(
  seg: EntitySegment, indices: number[], starts: number[], rawContent: string | undefined,
): void {
  if (indices.length === 0) {
    // Caller is expected to delete this segment from the map.
    seg.lineIndices = new Int32Array(0);
    seg.lineCharStarts = new Int32Array(0);
    return;
  }
  // Pair up + sort by line index so the segment maps stay in document order.
  const order = indices.map((_, i) => i).sort((a, b) => indices[a] - indices[b]);
  const sortedIndices = order.map(i => indices[i]);
  const sortedStarts = order.map(i => starts[i]);
  seg.lineIndices = new Int32Array(sortedIndices);
  seg.lineCharStarts = new Int32Array(sortedStarts);
  seg.startLine = sortedIndices[0];
  seg.endLine = sortedIndices[sortedIndices.length - 1];
  seg.startChar = sortedStarts[0];
  // endChar = last line's end (start of next line - 1, or end of file).
  const lastStart = sortedStarts[sortedStarts.length - 1];
  if (rawContent) {
    const nl = rawContent.indexOf('\n', lastStart);
    seg.endChar = nl >= 0 ? nl : rawContent.length;
  } else {
    seg.endChar = lastStart + 256; // best-effort placeholder
  }
}

/**
 * Apply a list of edit summaries to the model's segment indexes WITHOUT
 * re-scanning rawContent. Designed for the post-save path: the EntityEditor
 * already knows exactly which lines were inserted/removed for the saved
 * entity, so we surgically update the affected segment + shift everything
 * past the edit boundary. ~O(N entities + M edits) vs O(N chars) for the
 * full rebuild — typically <100ms vs ~2s on SNOMED-scale.
 *
 * Caller must have already set `model.rawContent` to the post-edit text
 * (used only to refresh endChar of the owner segment).
 *
 * Edits are processed in DESCENDING `oldStartChar` order so later edits
 * don't disturb the pre-edit coordinates of earlier ones.
 */
export function applyIncrementalSegmentUpdate(
  model: OntologyModel,
  ownerIri: string,
  editSummaries: ReadonlyArray<EditSummary>,
): void {
  if (model.sourceFormat !== 'functional') return;
  if (!model.entitySegments) return;
  if (editSummaries.length === 0) return;

  const sorted = [...editSummaries].sort((a, b) => b.oldStartChar - a.oldStartChar);

  for (const edit of sorted) {
    const removedLines = edit.oldEndLine - edit.oldStartLine;
    const newLineCount = newlineCount(edit.newText);
    const lineDelta = newLineCount - removedLines;
    const charDelta = edit.newText.length - (edit.oldEndChar - edit.oldStartChar);

    // 1. Shift every segment that sits at or beyond the edit boundary.
    //    Owner's own lines IN the deleted range stay untouched here (line < oldEndLine);
    //    step 2 removes them.
    for (const [iri, seg] of model.entitySegments) {
      if (edit.segmentMap === 'entity' && iri === ownerIri) { continue; }
      shiftSegOnEditBoundary(seg, edit.oldEndLine, lineDelta, charDelta);
    }
    if (model.gciSegments) {
      for (const [iri, seg] of model.gciSegments) {
        if (edit.segmentMap === 'gci' && iri === ownerIri) { continue; }
        shiftSegOnEditBoundary(seg, edit.oldEndLine, lineDelta, charDelta);
      }
    }
    if (model.closingParenLine !== undefined && model.closingParenLine >= edit.oldEndLine) {
      model.closingParenLine += lineDelta;
    }
    if (model.gciInsertLine !== undefined && model.gciInsertLine >= edit.oldEndLine) {
      model.gciInsertLine += lineDelta;
    }

    // 2. Mutate the owner segment for this edit's classification (entity/gci).
    let ownerMap = edit.segmentMap === 'gci' ? model.gciSegments : model.entitySegments;
    if (edit.segmentMap === 'gci' && !ownerMap) {
      ownerMap = new Map();
      model.gciSegments = ownerMap;
    }
    if (!ownerMap) continue;

    const owner = ownerMap.get(ownerIri);
    const keptIndices: number[] = [];
    const keptStarts: number[] = [];
    if (owner && owner.lineIndices && owner.lineCharStarts) {
      for (let k = 0; k < owner.lineIndices.length; k++) {
        const l = owner.lineIndices[k];
        // Drop entries that fell inside the deleted line range.
        if (l >= edit.oldStartLine && l < edit.oldEndLine) continue;
        if (l >= edit.oldEndLine) {
          keptIndices.push(l + lineDelta);
          keptStarts.push(owner.lineCharStarts[k] + charDelta);
        } else {
          keptIndices.push(l);
          keptStarts.push(owner.lineCharStarts[k]);
        }
      }
    }

    // Add new lines from newText. Their absolute positions are computed in
    // post-edit coordinates: line N is at edit.oldStartLine + N, char offset
    // edit.oldStartChar + (line start within newText).
    if (removedLines > 0 || newLineCount > 0) {
      const localStarts = lineStartsIn(edit.newText);
      for (let i = 0; i < localStarts.length; i++) {
        keptIndices.push(edit.oldStartLine + i);
        keptStarts.push(edit.oldStartChar + localStarts[i]);
      }
    }

    if (keptIndices.length === 0) {
      // All owner lines for this map removed — drop the segment entry.
      if (owner) ownerMap.delete(ownerIri);
      continue;
    }

    if (owner) {
      recomputeSegmentBounds(owner, keptIndices, keptStarts, model.rawContent);
    } else {
      const fresh: EntitySegment = {
        startLine: 0, endLine: 0, startChar: 0, endChar: 0,
        lineIndices: new Int32Array(0), lineCharStarts: new Int32Array(0),
      };
      recomputeSegmentBounds(fresh, keptIndices, keptStarts, model.rawContent);
      ownerMap.set(ownerIri, fresh);
    }
  }
}
