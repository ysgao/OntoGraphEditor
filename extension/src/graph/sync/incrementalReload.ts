import type { OntologyModel, EntitySegment } from '../model/OntologyModel';
import { ParserRegistry } from '../parser/ParserRegistry';
import { buildModelSegmentIndex } from '../model/SegmentIndex';
import type { LineDiff } from './lineDiff';

const HEADER_OPENERS = ['Prefix(', 'Ontology(', 'Import('];

/**
 * Char offset right after the `Ontology(<iri>` line. Mini-text reuses these
 * bytes so the parser sees the file's actual prefixes and ontology IRI.
 * Returns -1 if we can't find an Ontology line — caller should bail out.
 */
function findHeaderEndChar(text: string): number {
  let i = 0;
  while (i < text.length) {
    let lineEnd = text.indexOf('\n', i);
    if (lineEnd < 0) lineEnd = text.length;
    let s = i;
    while (s < lineEnd && (text.charCodeAt(s) === 32 || text.charCodeAt(s) === 9)) s++;
    const isOntology = text.startsWith('Ontology(', s);
    const isHeaderOther = !isOntology && HEADER_OPENERS.some(p => text.startsWith(p, s));
    const isBlankOrComment = s === lineEnd || text.charCodeAt(s) === 35; // '#'
    if (isOntology) return lineEnd + 1;
    if (isHeaderOther || isBlankOrComment) { i = lineEnd + 1; continue; }
    return -1;
  }
  return -1;
}

function segLinesOutsideRange(seg: EntitySegment, startLine: number, endLine: number): boolean {
  if (seg.lineIndices && seg.lineIndices.length > 0) {
    for (let k = 0; k < seg.lineIndices.length; k++) {
      const l = seg.lineIndices[k];
      if (l < startLine || l >= endLine) return true;
    }
    return false;
  }
  return seg.startLine < startLine || seg.endLine >= endLine;
}

function segOverlapsRange(seg: EntitySegment, startLine: number, endLine: number): boolean {
  if (seg.endLine < startLine || seg.startLine >= endLine) return false;
  if (seg.lineIndices && seg.lineIndices.length > 0) {
    for (let k = 0; k < seg.lineIndices.length; k++) {
      const l = seg.lineIndices[k];
      if (l >= startLine && l < endLine) return true;
    }
    return false;
  }
  return true;
}

interface ExpandedRange {
  oldStartLine: number;
  oldEndLine: number;
  oldStartChar: number;
  oldEndChar: number;
  newStartChar: number;
  newEndChar: number;
  affectedIris: Set<string>;
}

/**
 * Expand the diff's line/char range to cover the full segments of every
 * affected entity, then verify no other entity straddles the expanded range.
 * Returns null when a straddle is detected (caller falls back to full parse).
 */
function expandRangeOverAffectedEntities(
  model: OntologyModel,
  diff: LineDiff,
): ExpandedRange | null {
  let oldStartLine = diff.oldStartLine;
  let oldEndLine = diff.oldEndLine;
  let oldStartChar = diff.oldStartChar;
  let oldEndChar = diff.oldEndChar;
  const affectedIris = new Set<string>();

  const visitMap = (m: Map<string, EntitySegment> | undefined): void => {
    if (!m) return;
    for (const [iri, seg] of m) {
      if (!segOverlapsRange(seg, oldStartLine, oldEndLine)) continue;
      affectedIris.add(iri);
      // Expand line range
      if (seg.lineIndices && seg.lineIndices.length > 0) {
        for (let k = 0; k < seg.lineIndices.length; k++) {
          const l = seg.lineIndices[k];
          if (l < oldStartLine) oldStartLine = l;
          if (l + 1 > oldEndLine) oldEndLine = l + 1;
        }
        for (let k = 0; k < seg.lineCharStarts!.length; k++) {
          const c = seg.lineCharStarts![k];
          if (c < oldStartChar) oldStartChar = c;
          // Char offset of end-of-line: next line char or end of file. Estimate
          // via segment.endChar for the last line of the segment.
        }
      } else {
        if (seg.startLine < oldStartLine) oldStartLine = seg.startLine;
        if (seg.endLine + 1 > oldEndLine) oldEndLine = seg.endLine + 1;
      }
      if (seg.startChar < oldStartChar) oldStartChar = seg.startChar;
      if (seg.endChar + 1 > oldEndChar) oldEndChar = seg.endChar + 1;
    }
  };

  visitMap(model.entitySegments);
  visitMap(model.gciSegments);

  // Second pass: ensure no entity (including non-affected ones already touched
  // by expansion) straddles the expanded range. If even one entity has lines
  // outside, an incremental patch would lose those axioms.
  const verifyMap = (m: Map<string, EntitySegment> | undefined): boolean => {
    if (!m) return true;
    for (const [iri, seg] of m) {
      if (!segOverlapsRange(seg, oldStartLine, oldEndLine)) continue;
      if (segLinesOutsideRange(seg, oldStartLine, oldEndLine)) return false;
      affectedIris.add(iri);
    }
    return true;
  };
  if (!verifyMap(model.entitySegments)) return null;
  if (!verifyMap(model.gciSegments)) return null;

  // Map expanded old char range to new char range. The unchanged prefix
  // before the initial diff has identical byte positions in both files; the
  // unchanged suffix after the initial diff shifts by charDelta.
  const charDelta = diff.newEndChar - diff.oldEndChar;
  const newStartChar = oldStartChar <= diff.oldStartChar
    ? oldStartChar
    : diff.newStartChar + (oldStartChar - diff.oldStartChar);
  const newEndChar = oldEndChar >= diff.oldEndChar
    ? oldEndChar + charDelta
    : diff.newEndChar - (diff.oldEndChar - oldEndChar);

  return {
    oldStartLine, oldEndLine,
    oldStartChar, oldEndChar,
    newStartChar, newEndChar,
    affectedIris,
  };
}

function languageIdFor(sourceFormat: string): string | null {
  switch (sourceFormat) {
    case 'functional':  return 'owl-functional';
    case 'manchester':  return 'manchester';
    case 'turtle':      return 'turtle';
    case 'owl-xml':     return 'owl-xml';
    default:            return null;
  }
}

/**
 * Apply the changes between `oldText` (model.rawContent) and `newText`
 * incrementally to `model`, without a full re-parse.
 *
 * Strategy: find all entities whose segments overlap the diff range, then
 * expand the range to cover their FULL segments (so mini-text contains each
 * affected entity's complete cluster). Re-parse that mini-text and merge the
 * resulting entities into the live model.
 *
 * Returns false (caller must fall back to full re-parse) when:
 *   - sourceFormat is not 'functional' (only format with reliable segments).
 *   - Expanded range would lose axioms (an entity straddles the boundary).
 *   - Mini-text parse fails.
 *   - Expanded range covers nearly the whole file (no win over full parse).
 */
export function applyIncrementalReload(
  model: OntologyModel,
  oldTextLength: number,
  newText: string,
  diff: LineDiff,
  newStat: { mtime: number; size: number },
  options: { maxExpansionRatio?: number } = {},
): boolean {
  if (diff.identical) {
    model.sourceMtimeMs = newStat.mtime;
    model.sourceSize = newStat.size;
    return true;
  }

  if (model.sourceFormat !== 'functional') return false;
  const langId = languageIdFor(model.sourceFormat);
  if (!langId) return false;

  const expanded = expandRangeOverAffectedEntities(model, diff);
  if (expanded === null) return false;

  // If expansion covers a large fraction of the file, incremental is no
  // longer a win — mini-parse cost approaches full parse, plus we'd hold
  // old rawContent + newText + mini-text all live during the parse, which
  // OOMs the extension host on multi-hundred-MB ontologies. Bail to full
  // re-parse (which drops the old rawContent before reading the new copy).
  const expandedChars = expanded.oldEndChar - expanded.oldStartChar;
  const ratio = expandedChars / Math.max(1, oldTextLength);
  const maxRatio = options.maxExpansionRatio ?? 0.2;
  // Absolute floor: don't reject tiny files just because the ratio is high.
  // Only meaningful on multi-MB files where the mini-parse cost matters.
  const ABSOLUTE_FLOOR_BYTES = 1024 * 1024; // 1MB
  if (expandedChars > ABSOLUTE_FLOOR_BYTES && ratio > maxRatio) return false;

  const headerEnd = findHeaderEndChar(newText);
  if (headerEnd < 0) return false;

  // Mini-text: header (incl. Ontology declaration) + expanded diff region
  // from NEW text + synthetic closing paren.
  const miniText =
    newText.slice(0, headerEnd) +
    newText.slice(expanded.newStartChar, expanded.newEndChar) +
    ')\n';

  let miniModel: OntologyModel;
  try {
    miniModel = ParserRegistry.parse(miniText, langId, model.sourceUri + '#incremental');
  } catch {
    return false;
  }

  // Replace/add entities found in mini-model.
  const miniMaps = [
    [miniModel.classes, model.classes],
    [miniModel.objectProperties, model.objectProperties],
    [miniModel.dataProperties, model.dataProperties],
    [miniModel.annotationProperties, model.annotationProperties],
    [miniModel.individuals, model.individuals],
  ] as const;

  const seenIris = new Set<string>();
  for (const [src, dst] of miniMaps) {
    for (const [iri, ent] of src) {
      (dst as Map<string, unknown>).set(iri, ent);
      seenIris.add(iri);
    }
  }

  // Remove entities that USED to live in the expanded range but no longer
  // appear in mini-model (deleted in the new text).
  for (const iri of expanded.affectedIris) {
    if (seenIris.has(iri)) continue;
    model.classes.delete(iri);
    model.objectProperties.delete(iri);
    model.dataProperties.delete(iri);
    model.annotationProperties.delete(iri);
    model.individuals.delete(iri);
  }

  // Swap text + fingerprint, rebuild segment index against the new text.
  model.rawContent = newText;
  model.sourceMtimeMs = newStat.mtime;
  model.sourceSize = newStat.size;
  buildModelSegmentIndex(model);

  return true;
}
