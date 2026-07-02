import * as vscode from 'vscode';
import type { OWLEntity, EntitySegment } from '../model/OntologyModel';
import { BUILTIN_ANNOTATION_PROP_IRIS, getLabel } from '../model/OntologyModel';
import { temporaryClassIris } from '../views/DLQueryState.js';
import { beginSyncWrite, endSyncWrite } from './reloadGuard';
import { RawTextDocument, applyWorkspaceEditsToText, countLineDelta, type OffsetEdit } from './RawTextDocument';
import type { EditSummary } from '../model/SegmentIndex';

const RDFS_PREFIX = 'http://www.w3.org/2000/01/rdf-schema#';
const RDFS_ANN_TO_TOKEN = new Map<string, string>([
  [`${RDFS_PREFIX}label`,       'rdfs:label'],
  [`${RDFS_PREFIX}comment`,     'rdfs:comment'],
  [`${RDFS_PREFIX}seeAlso`,     'rdfs:seeAlso'],
  [`${RDFS_PREFIX}isDefinedBy`, 'rdfs:isDefinedBy'],
]);
const RDFS_TOKEN_TO_IRI = new Map<string, string>(
  [...RDFS_ANN_TO_TOKEN.entries()].map(([k, v]) => [v, k]),
);

// ── Shared helpers ─────────────────────────────────────────────────────────────


function fmtLiteral(value: string, lang?: string): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return lang ? `"${esc}"@${lang}` : `"${esc}"`;
}

function hasUnclosedString(s: string): boolean {
  let open = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') { open = !open; }
  }
  return open;
}

function parsePrefixes(text: string, fmt: 'functional' | 'manchester' | 'turtle'): Map<string, string> {
  const map = new Map<string, string>();
  let re: RegExp;
  if (fmt === 'functional') {
    re = /Prefix\s*\(\s*([^=\s]*)\s*=\s*<([^>]+)>/g;
  } else if (fmt === 'manchester') {
    re = /^Prefix:\s+([^\s]+)\s+<([^>]+)>/gm;
  } else {
    re = /@prefix\s+([^\s:]*:?)\s*<([^>]+)>/g;
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { map.set(m[1], m[2]); }
  return map;
}

function resolveIri(token: string, prefixes: Map<string, string>): string {
  if (token.startsWith('<') && token.endsWith('>')) { return token.slice(1, -1); }
  const c = token.indexOf(':');
  if (c >= 0) {
    const exp = prefixes.get(token.slice(0, c + 1));
    if (exp !== undefined) { return exp + token.slice(c + 1); }
  }
  return token;
}

function abbreviateIri(iri: string, prefixes: Map<string, string>, usedPrefixes?: Set<string>): string {
  const token = RDFS_ANN_TO_TOKEN.get(iri);
  if (token !== undefined) { return token; }
  if (usedPrefixes && usedPrefixes.size > 0 && prefixes.size > 0) {
    // Use the prefix actually employed by the file; longest matching expansion wins.
    let bestName: string | null = null;
    let bestExpansion = '';
    for (const [name, expansion] of prefixes) {
      if (!usedPrefixes.has(name)) continue;
      if (expansion.length > bestExpansion.length && iri.startsWith(expansion)) {
        bestName = name;
        bestExpansion = expansion;
      }
    }
    if (bestName !== null) {
      const localName = iri.slice(bestExpansion.length);
      if (localName.length > 0 && !/[\s<>"\\]/.test(localName)) {
        return bestName + localName; // bestName already has trailing ':'
      }
    }
  }
  return `<${iri}>`;
}

// Detect which prefixes appear as CURIEs in a small set of sample lines (e.g. an entity's
// existing axiom lines). Returns a Set of prefix names (with trailing ':') seen in CURIE form.
// Empty Set when no samples (caller defaults to <full-IRI> form).
function detectUsedPrefixesFromLines(sampleLines: string[], prefixes: Map<string, string>): Set<string> {
  const used = new Set<string>();
  if (prefixes.size === 0 || sampleLines.length === 0) return used;
  for (const line of sampleLines) {
    if (used.size === prefixes.size) break;
    for (const [name] of prefixes) {
      if (used.has(name)) continue;
      let idx = line.indexOf(name);
      while (idx >= 0) {
        const prevCh = idx > 0 ? line.charCodeAt(idx - 1) : 0;
        const prevDelim = prevCh === 0 || prevCh === 32 || prevCh === 9
          || prevCh === 40 || prevCh === 44 || prevCh === 91 || prevCh === 13;
        if (prevDelim) {
          const c = line.charCodeAt(idx + name.length);
          const idChar = (c >= 48 && c <= 57) || (c >= 65 && c <= 90)
            || (c >= 97 && c <= 122) || c === 95 || c === 45;
          if (idChar) { used.add(name); break; }
        }
        idx = line.indexOf(name, idx + 1);
      }
    }
  }
  return used;
}

interface AnnotationPair { propIri: string; text: string; lang?: string; }

function entityAnnotationPairs(entity: OWLEntity): AnnotationPair[] {
  const pairs: AnnotationPair[] = [];
  for (const [lang, vals] of Object.entries(entity.labels)) {
    for (const v of vals) {
      pairs.push({ propIri: `${RDFS_PREFIX}label`, text: v, lang: lang || undefined });
    }
  }
  for (const [propIri, vals] of Object.entries(entity.annotations)) {
    for (const raw of vals) {
      const at = raw.lastIndexOf('@');
      const hasLang = at > 0 && /^[A-Za-z][A-Za-z0-9\-]*$/.test(raw.slice(at + 1));
      pairs.push({
        propIri,
        text: hasLang ? raw.slice(0, at) : raw,
        lang: hasLang ? raw.slice(at + 1) : undefined,
      });
    }
  }
  return pairs;
}

// ── OWL Functional Syntax (.ofn / .owf) ───────────────────────────────────────

function extractFunctionalSubject(line: string, prefixes: Map<string, string>): string | null {
  if (!/AnnotationAssertion\s*\(/.test(line)) { return null; }
  const m = line.match(/AnnotationAssertion\s*\((.*)/s);
  if (!m) { return null; }
  const tokens = extractLeadingIriTokens(m[1], 2);
  if (tokens.length < 2) { return null; }
  return resolveIri(tokens[1], prefixes);
}

function extractLeadingIriTokens(s: string, count: number): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length && tokens.length < count) {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) { i++; }
    if (i >= s.length || s[i] === '"' || s[i] === ')') { break; }
    if (s[i] === '<') {
      const e = s.indexOf('>', i); if (e < 0) { break; }
      tokens.push(s.slice(i, e + 1)); i = e + 1;
    } else {
      const start = i;
      while (i < s.length && s[i] !== ' ' && s[i] !== '\t' && s[i] !== '(' && s[i] !== ')') { i++; }
      if (i > start) { tokens.push(s.slice(start, i)); }
    }
  }
  return tokens;
}

interface AnnotationKey {
  propIri: string;
  text: string;
  lang?: string;
  key: string;
}

// Parse an AnnotationAssertion line to extract its identity key for the given entity.
// Returns null if the line doesn't match or isn't for this entity.
function parseFunctionalAnnotationItem(
  line: string,
  entity: OWLEntity,
  prefixes: Map<string, string>,
): AnnotationKey | null {
  if (extractFunctionalSubject(line, prefixes) !== entity.iri) return null;

  const inner = line.match(/\bAnnotationAssertion\s*\(\s*(.*)/s)?.[1];
  if (!inner) return null;

  const tokens = extractLeadingIriTokens(inner, 1);
  if (tokens.length < 1) return null;
  const propToken = tokens[0];
  const propIri = RDFS_TOKEN_TO_IRI.get(propToken) ?? resolveIri(propToken, prefixes);

  const litMatch = line.match(/"((?:[^"\\]|\\.)*)"\s*(?:@([A-Za-z][A-Za-z0-9-]*))?/);
  if (!litMatch) return null;

  const rawText = litMatch[1];
  const text = rawText
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  const lang = litMatch[2] || undefined;

  return { propIri, text, lang, key: `${propIri}|${text}|${lang ?? ''}` };
}

function annotationModelKey(propIri: string, text: string, lang?: string): string {
  return `${propIri}|${text}|${lang ?? ''}`;
}

// Detect the leading whitespace convention used by non-comment, non-Prefix lines
// in the Ontology body (e.g. "  SubClassOf...", "    Declaration...").
// Falls back to '  ' (2 spaces) if nothing is found.
function detectFunctionalIndent(lines: string[]): string {
  for (const line of lines) {
    if (/^\s+[A-Za-z(]/.test(line) && !line.trimStart().startsWith('Prefix')) {
      return line.match(/^(\s+)/)?.[1] ?? '  ';
    }
  }
  return '  ';
}

function syncFunctional(
  doc: vscode.TextDocument,
  entity: OWLEntity,
  segment?: EntitySegment,
  positionHints?: Map<string, number>,
): SyncResult | null {
  const text = doc.getText();
  const prefixes = parsePrefixes(text, 'functional');

  // O(entity-axiom-count) fast path: use the entity's exact line list when available
  // (essential for SNOMED-scale files where the entity segment spans 1M+ lines because
  // axioms are grouped by axiom type, not by entity).
  const useLineList = !!(segment && segment.lineIndices && segment.lineCharStarts);
  // Fall-back chunk path (Protégé-style clusters or no segment hint).
  const lineOffset = useLineList ? 0 : (segment?.startLine ?? 0);
  // Direct assignment instead of `push(...arr)` — spread invokes apply with
  // one argument per element, and 2.9M args blows the V8 call-stack limit
  // when no segment is available and we have to split the whole 200MB file.
  const lines: string[] = useLineList
    ? []
    : (segment
      ? text.slice(segment.startChar, Math.min(segment.endChar + 4096, text.length)).split('\n')
      : text.split('\n'));

  const fileItems: Array<{ key: string; lineIdx: number; lineCount: number }> = [];
  // Sample of entity's existing axiom lines — used to detect whether the file writes this
  // entity's IRIs as CURIE (`:N`) or full form (`<http://...>`). Empty for non-line-list path.
  const sampleLines: string[] = [];

  if (useLineList) {
    const idx = segment!.lineIndices!;
    const starts = segment!.lineCharStarts!;
    for (let k = 0; k < idx.length; k++) {
      const lineStart = starts[k];
      let lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd < 0) lineEnd = text.length;
      let combined = text.slice(lineStart, lineEnd);
      let lineCount = 1;
      // Multi-line annotation value: extend by reading next physical line(s).
      while (hasUnclosedString(combined)) {
        const nextStart = lineEnd + 1;
        if (nextStart >= text.length) break;
        let nextEnd = text.indexOf('\n', nextStart);
        if (nextEnd < 0) nextEnd = text.length;
        combined += '\n' + text.slice(nextStart, nextEnd);
        lineEnd = nextEnd;
        lineCount++;
      }
      sampleLines.push(combined);
      const parsed = parseFunctionalAnnotationItem(combined, entity, prefixes);
      if (parsed) fileItems.push({ key: parsed.key, lineIdx: idx[k], lineCount });
    }
  } else {
    let i = 0;
    while (i < lines.length) {
      let combined = lines[i];
      let lineCount = 1;
      while (hasUnclosedString(combined) && i + lineCount < lines.length) {
        combined += '\n' + lines[i + lineCount];
        lineCount++;
      }
      const parsed = parseFunctionalAnnotationItem(combined, entity, prefixes);
      if (parsed) fileItems.push({ key: parsed.key, lineIdx: lineOffset + i, lineCount });
      i += lineCount;
    }
  }
  const fileKeySet = new Set(fileItems.map(f => f.key));

  // Use the indentation of existing annotation lines; fall back to file convention.
  let indent: string;
  if (fileItems.length > 0) {
    let firstAnnotLine: string;
    if (useLineList) {
      const first = fileItems[0];
      // Find this lineIdx in segment.lineIndices to get its char offset.
      const idx = segment!.lineIndices!;
      const starts = segment!.lineCharStarts!;
      let charStart = -1;
      for (let k = 0; k < idx.length; k++) {
        if (idx[k] === first.lineIdx) { charStart = starts[k]; break; }
      }
      const nl = charStart >= 0 ? text.indexOf('\n', charStart) : -1;
      firstAnnotLine = charStart >= 0 ? text.slice(charStart, nl < 0 ? text.length : nl) : '';
    } else {
      firstAnnotLine = lines[fileItems[0].lineIdx - lineOffset];
    }
    indent = firstAnnotLine.match(/^(\s+)/)?.[1] ?? (useLineList ? '' : detectFunctionalIndent(lines));
  } else if (useLineList) {
    // No existing annotations for this entity — infer indent from any of its own axiom lines.
    let detected = '';
    for (const s of sampleLines) {
      const m = s.match(/^(\s+)/);
      if (m) { detected = m[1]; break; }
    }
    indent = detected;
  } else {
    indent = detectFunctionalIndent(lines);
  }

  // Detect IRI-form convention from the entity's actual axiom lines (CURIE vs full).
  const usedPrefixesEntity = detectUsedPrefixesFromLines(sampleLines, prefixes);

  // Build model's desired annotation set
  const modelItems: Array<{ key: string; line: string }> = entityAnnotationPairs(entity)
    .map(({ propIri, text: t, lang }) => ({
      key: annotationModelKey(propIri, t, lang),
      line: `${indent}AnnotationAssertion(${abbreviateIri(propIri, prefixes, usedPrefixesEntity)} ${abbreviateIri(entity.iri, prefixes, usedPrefixesEntity)} ${fmtLiteral(t, lang)})`,
    }));
  const modelKeySet = new Set(modelItems.map(m => m.key));

  const toRemove = fileItems.filter(f => !modelKeySet.has(f.key));
  const toAdd = modelItems.filter(m => !fileKeySet.has(m.key));

  // Detect whether the cluster header bracket `# TypeLabel: <IRI> (label)` is stale.
  // The bracket group is optional: a matching `# TypeLabel: <IRI>` header gets a
  // `(label)` appended when the entity has an explicit label, and an existing
  // bracket is rewritten when its text no longer matches the current label.
  const newDisplayLabel = getLabel(entity);
  const typeLabel = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
  const escapedIri = entity.iri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clusterHeaderRe = new RegExp(
    `^([ \\t]*#[ \\t]+${typeLabel}:[ \\t]+<${escapedIri}>)[ \\t]*(?:\\(([^)\\n]*)\\))?[ \\t]*$`,
    'm',
  );
  const headerM = clusterHeaderRe.exec(text);
  // newDisplayLabel is getLabel(entity) — falls back to local name when no explicit labels.
  // Compare directly: if the bracket already shows the right display label, nothing to do.
  // This handles stale-label removal: bracket "(OldLabel)" != local-name "Cat" → update to "(Cat)".
  const existingBracket = headerM?.[2] ?? '';
  const headerNeedsUpdate = headerM !== null && existingBracket !== newDisplayLabel;
  const headerEdit = headerNeedsUpdate && headerM !== null
    ? (() => {
      let line = 0;
      let lineStart = 0;
      for (let i = 0; i < headerM.index; i++) {
        if (text.charCodeAt(i) === 10) {
          line++;
          lineStart = i + 1;
        }
      }
      const lineEndRaw = text.indexOf('\n', lineStart);
      const lineEnd = lineEndRaw >= 0 ? lineEndRaw : text.length;
      return {
        line,
        oldText: text.slice(lineStart, lineEnd),
        newText: newDisplayLabel ? `${headerM[1]} (${newDisplayLabel})` : headerM[1],
      };
    })()
    : undefined;

  if (toRemove.length === 0 && toAdd.length === 0 && !headerNeedsUpdate) return null;

  // Insertion point: after the last existing annotation, or at the first cluster
  // non-Declaration line when no annotations exist yet, or full-scan fallback (no segment).
  let insertAt: number;
  if (fileItems.length > 0) {
    const last = fileItems[fileItems.length - 1];
    insertAt = last.lineIdx + last.lineCount;
  } else if (segment) {
    // segment.startLine may point to a Declaration(Class(...)) line in a separate
    // declarations section, which precedes the entity cluster. Walk lineIndices to
    // find the first non-Declaration cluster line and insert before it (right after
    // the cluster header comment).
    let clusterFirstLine = -1;
    if (segment.lineIndices && segment.lineCharStarts) {
      for (let k = 0; k < segment.lineIndices.length; k++) {
        let ws = segment.lineCharStarts[k];
        while (ws < text.length && (text.charCodeAt(ws) === 32 || text.charCodeAt(ws) === 9)) ws++;
        if (!text.startsWith('Declaration(', ws)) {
          clusterFirstLine = segment.lineIndices[k];
          break;
        }
      }
    }
    if (clusterFirstLine >= 0) {
      insertAt = clusterFirstLine;
    } else {
      // All segment lines are Declarations (new entity with no cluster axioms yet).
      // Fall back to scanning the full text for the cluster header comment so we
      // insert after the header rather than right after the Declaration line.
      const typeLabelFb = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
      const headerMatchFb = `# ${typeLabelFb}: <${entity.iri}>`;
      let headerLine = -1;
      let lineNo = 0;
      let p = 0;
      while (p <= text.length) {
        const nl = text.indexOf('\n', p);
        const lineEnd = nl >= 0 ? nl : text.length;
        // Trim leading whitespace for comparison
        let ws2 = p;
        while (ws2 < lineEnd && (text.charCodeAt(ws2) === 32 || text.charCodeAt(ws2) === 9)) ws2++;
        if (text.startsWith(headerMatchFb, ws2)) { headerLine = lineNo; break; }
        if (nl < 0) break;
        p = nl + 1;
        lineNo++;
      }
      insertAt = headerLine >= 0 ? headerLine + 1 : segment.endLine + 1;
    }
  } else {
    const entityToken = `<${entity.iri}>`;
    const typeLabel = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
    const headerMatch = `# ${typeLabel}: ${entityToken}`;
    let clusterHeaderIdx = -1;
    for (let j = 0; j < lines.length; j++) {
      if (lines[j].trimStart().startsWith(headerMatch)) { clusterHeaderIdx = j; break; }
    }
    if (clusterHeaderIdx >= 0) {
      insertAt = clusterHeaderIdx + 1;
    } else {
      insertAt = lines.length > 1 ? lines.length - 1 : lines.length;
      for (let j = lines.length - 1; j >= 0; j--) {
        if (lines[j].trim() === ')') { insertAt = j; break; }
      }
    }
  }

  const allAnnotRemoveSorted = toRemove.map(r => r.lineIdx).sort((a, b) => a - b);
  const deletedAnnotPositions = new Map<string, number>();
  for (const item of toRemove) {
    const postLine = item.lineIdx - allAnnotRemoveSorted.filter(l => l < item.lineIdx).length;
    deletedAnnotPositions.set(item.key, postLine);
  }

  const annotInsertsMap = new Map<number, string[]>();
  for (const addItem of toAdd) {
    const hintLine = positionHints?.get(addItem.key);
    const pos = hintLine ?? insertAt;
    if (!annotInsertsMap.has(pos)) annotInsertsMap.set(pos, []);
    annotInsertsMap.get(pos)!.push(addItem.line);
  }

  const edit = new vscode.WorkspaceEdit();
  for (const item of [...toRemove].sort((a, b) => b.lineIdx - a.lineIdx)) {
    edit.delete(doc.uri, new vscode.Range(item.lineIdx, 0, item.lineIdx + item.lineCount, 0));
  }
  if (headerEdit) {
    edit.replace(
      doc.uri,
      new vscode.Range(headerEdit.line, 0, headerEdit.line, headerEdit.oldText.length),
      headerEdit.newText,
    );
  }
  for (const [pos, insertLines] of annotInsertsMap) {
    edit.insert(doc.uri, new vscode.Position(pos, 0), insertLines.join('\n') + '\n');
  }

  const addedRanges: vscode.Range[] = [];
  for (const [pos, insertLines] of annotInsertsMap) {
    let ln = pos;
    for (const l of insertLines) {
      const mLines = l.split('\n');
      addedRanges.push(new vscode.Range(ln, 0, ln + mLines.length - 1, mLines[mLines.length - 1].length));
      ln += mLines.length;
    }
  }
  return { edit, addedRanges, deletedAnnotPositions };
}

// ── Manchester Syntax (.omn) ───────────────────────────────────────────────────

const FRAME_KW_RE = /^(Class|ObjectProperty|DataProperty|AnnotationProperty|Individual)\s*:\s*(.*)/;
const SECTION_KW_RE = /^\s+(Annotations|SubClassOf|EquivalentTo|DisjointWith|Domain|Range|Characteristics|InverseOf|SubPropertyOf|Types|Facts)\s*:/;
const TOPLEVEL_KW_RE = /^(Class|ObjectProperty|DataProperty|AnnotationProperty|Individual|DisjointClasses|EquivalentClasses)\s*:/;

function findManchesterEntityFrame(
  lines: string[], entityIri: string, prefixes: Map<string, string>,
): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FRAME_KW_RE);
    if (!m) { continue; }
    if (resolveIri(m[2].trim(), prefixes) !== entityIri) { continue; }
    // Frame ends at next top-level keyword or EOF
    let end = i + 1;
    while (end < lines.length && !TOPLEVEL_KW_RE.test(lines[end])) { end++; }
    return { start: i, end };
  }
  return null;
}

// Parse one annotation item line from within a Manchester Annotations: section.
// Returns null for the header line, blank lines, or lines that don't match.
function parseManchesterAnnotationLine(
  line: string,
  prefixes: Map<string, string>,
): AnnotationKey | null {
  const trimmed = line.trimStart().replace(/,\s*$/, '');
  if (!trimmed || /^Annotations\s*:/.test(trimmed)) { return null; }
  const tokens = extractLeadingIriTokens(trimmed, 1);
  if (tokens.length < 1) { return null; }
  const propToken = tokens[0];
  const propIri = RDFS_TOKEN_TO_IRI.get(propToken) ?? resolveIri(propToken, prefixes);
  const litMatch = trimmed.match(/"((?:[^"\\]|\\.)*)"\s*(?:@([A-Za-z][A-Za-z0-9-]*))?/);
  if (!litMatch) { return null; }
  const rawText = litMatch[1]
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const lang = litMatch[2] || undefined;
  return { propIri, text: rawText, lang, key: `${propIri}|${rawText}|${lang ?? ''}` };
}

function syncManchester(doc: vscode.TextDocument, entity: OWLEntity): SyncResult | null {
  const text = doc.getText();
  const lines = text.split('\n');
  const prefixes = parsePrefixes(text, 'manchester');
  const frame = findManchesterEntityFrame(lines, entity.iri, prefixes);
  if (!frame) { return null; }

  // Find existing Annotations: section within frame.
  // annotEnd is determined by the SECTION_KW_RE check on lines that are NOT inside
  // a multi-line string, so we scan carefully.
  let annotStart = -1;
  let annotEnd = frame.end;
  for (let i = frame.start + 1; i < frame.end; i++) {
    if (/^\s+Annotations\s*:/.test(lines[i])) {
      annotStart = i;
      annotEnd = i + 1;
      while (annotEnd < frame.end) {
        // Do not let a section keyword inside a multi-line string end the block.
        if (!hasUnclosedString(lines.slice(annotStart + 1, annotEnd).join('\n')) &&
            SECTION_KW_RE.test(lines[annotEnd])) { break; }
        annotEnd++;
      }
      break;
    }
  }

  // Parse existing annotation items; join continuation lines for multi-line values.
  const fileItems: Array<{ key: string; lineText: string }> = [];
  if (annotStart >= 0) {
    let i = annotStart + 1;
    while (i < annotEnd) {
      let combined = lines[i].replace(/,\s*$/, '');
      let lineCount = 1;
      while (hasUnclosedString(combined) && i + lineCount < annotEnd) {
        combined += '\n' + lines[i + lineCount].replace(/,\s*$/, '');
        lineCount++;
      }
      const parsed = parseManchesterAnnotationLine(combined, prefixes);
      if (parsed) {
        fileItems.push({ key: parsed.key, lineText: combined });
      }
      i += lineCount;
    }
  }
  const fileKeySet = new Set(fileItems.map(f => f.key));

  // Build model items and key set.
  const modelPairs = entityAnnotationPairs(entity);
  const modelKeySet = new Set(
    modelPairs.map(({ propIri, text: t, lang }) => annotationModelKey(propIri, t, lang))
  );
  const toAdd = modelPairs.filter(
    ({ propIri, text: t, lang }) => !fileKeySet.has(annotationModelKey(propIri, t, lang))
  );
  const toRemoveKeys = new Set(fileItems.filter(f => !modelKeySet.has(f.key)).map(f => f.key));

  // Key-based idempotency: order in file does not matter.
  if (toAdd.length === 0 && toRemoveKeys.size === 0) { return null; }

  // Detect item indentation from existing lines; fall back to 8 spaces.
  const itemIndent = fileItems.length > 0
    ? (fileItems[0].lineText.match(/^(\s+)/)?.[1] ?? '        ')
    : '        ';

  // Rebuild block: kept items in file order (original text) + new items appended.
  const keptLines = fileItems.filter(f => !toRemoveKeys.has(f.key)).map(f => f.lineText);
  const newLines = toAdd.map(({ propIri, text: t, lang }) =>
    `${itemIndent}${abbreviateIri(propIri, prefixes)} ${fmtLiteral(t, lang)}`
  );
  const allItemLines = [...keptLines, ...newLines];

  const headerIndent = annotStart >= 0
    ? (lines[annotStart].match(/^(\s+)/)?.[1] ?? '    ')
    : '    ';
  const newAnnotBlock = allItemLines.length > 0
    ? `${headerIndent}Annotations:\n${allItemLines.join(',\n')}`
    : '';

  const edit = new vscode.WorkspaceEdit();
  let insertAt: number;

  if (annotStart >= 0) {
    const startPos = doc.lineAt(annotStart).range.start;
    const endPos = doc.lineAt(annotEnd - 1).rangeIncludingLineBreak.end;
    edit.replace(doc.uri, new vscode.Range(startPos, endPos),
      newAnnotBlock.length > 0 ? newAnnotBlock + '\n' : '');
    insertAt = annotStart;
  } else {
    insertAt = frame.start + 1;
    if (newAnnotBlock.length > 0) {
      edit.insert(doc.uri, doc.lineAt(insertAt).range.start, newAnnotBlock + '\n');
    } else {
      return null;
    }
  }

  const blockLines = newAnnotBlock.split('\n');
  const addedRanges = blockLines.map((l, i) =>
    new vscode.Range(insertAt + i, 0, insertAt + i, l.length)
  );
  return { edit, addedRanges };
}

// ── Turtle Syntax (.ttl / .n3) ────────────────────────────────────────────────

const BUILTIN_ANN_SET = new Set(BUILTIN_ANNOTATION_PROP_IRIS);

function splitTurtlePredicates(blockText: string): string[] {
  // Split by ';' and '.' while respecting quoted strings
  const segments: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < blockText.length; i++) {
    const ch = blockText[i];
    if (ch === '"' && blockText[i - 1] !== '\\') { inStr = !inStr; cur += ch; continue; }
    if (!inStr && ch === ';') { segments.push(cur.trim()); cur = ''; continue; }
    if (!inStr && ch === '.' && (i + 1 >= blockText.length || /\s/.test(blockText[i + 1]))) {
      const t = cur.trim(); if (t) { segments.push(t); } cur = ''; continue;
    }
    cur += ch;
  }
  const t = cur.trim(); if (t) { segments.push(t); }
  return segments.filter(Boolean);
}

function syncTurtle(doc: vscode.TextDocument, entity: OWLEntity): SyncResult | null {
  const text = doc.getText();
  const lines = text.split('\n');
  const prefixes = parsePrefixes(text, 'turtle');

  const entityFull = `<${entity.iri}>`;
  const entityAbbrev = abbreviateIri(entity.iri, prefixes);
  const entityTokens = [entityFull, entityAbbrev].filter((v, i, a) => a.indexOf(v) === i);
  const subjectRe = new RegExp(
    `^(${entityTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s`
  );

  // Find block start
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (subjectRe.test(lines[i])) { blockStart = i; break; }
  }
  if (blockStart < 0) { return null; }

  // Find block end (inclusive of the line ending with '.')
  let blockEnd = blockStart;
  while (blockEnd < lines.length) {
    const l = lines[blockEnd].trim();
    if (l.endsWith('.')) { blockEnd++; break; }
    blockEnd++;
  }

  const blockText = lines.slice(blockStart, blockEnd).join('\n');
  const segments = splitTurtlePredicates(blockText);
  if (segments.length === 0) { return null; }

  // First segment contains "subject pred1 obj1"; extract subject
  const firstSeg = segments[0];
  const subjectMatch = firstSeg.match(subjectRe);
  const subjectToken = subjectMatch ? subjectMatch[0].trim() : entityAbbrev;
  const firstPredSeg = subjectMatch ? firstSeg.slice(subjectMatch[0].length).trim() : firstSeg;

  // Separate structural vs annotation segments
  const structuralSegs: string[] = [];
  if (firstPredSeg) {
    const pred = firstPredSeg.split(/\s+/)[0];
    const predIri = resolveIri(pred, prefixes);
    if (!BUILTIN_ANN_SET.has(predIri)) {
      structuralSegs.push(firstPredSeg);
    }
  }
  for (let si = 1; si < segments.length; si++) {
    const seg = segments[si];
    const pred = seg.split(/\s+/)[0];
    const predIri = resolveIri(pred, prefixes);
    if (!BUILTIN_ANN_SET.has(predIri)) { structuralSegs.push(seg); }
  }

  // Extract existing annotation segments from the file block (file order) and build keys.
  const existingAnnotSegs: Array<{ seg: string; key: string }> = [];
  const allFileSegs = [firstPredSeg, ...segments.slice(1)].filter(Boolean);
  for (const seg of allFileSegs) {
    const pred = seg.split(/\s+/)[0];
    const predIri = resolveIri(pred, prefixes);
    if (BUILTIN_ANN_SET.has(predIri)) {
      const litMatch = seg.match(/"((?:[^"\\]|\\.)*)"\s*(?:@([A-Za-z][A-Za-z0-9-]*))?/);
      if (litMatch) {
        const rawText = litMatch[1]
          .replace(/\\n/g, '\n').replace(/\\r/g, '\r')
          .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const lang = litMatch[2] || undefined;
        existingAnnotSegs.push({ seg, key: annotationModelKey(predIri, rawText, lang) });
      }
    }
  }
  const fileAnnotKeySet = new Set(existingAnnotSegs.map(x => x.key));

  // Model annotation items with keys.
  const modelAnnotItems = entityAnnotationPairs(entity).map(({ propIri, text: t, lang }) => ({
    seg: `${abbreviateIri(propIri, prefixes)} ${fmtLiteral(t, lang)}`,
    key: annotationModelKey(propIri, t, lang),
  }));
  const modelAnnotKeySet = new Set(modelAnnotItems.map(x => x.key));

  const keptAnnot = existingAnnotSegs.filter(x => modelAnnotKeySet.has(x.key));
  const toAddAnnot = modelAnnotItems.filter(x => !fileAnnotKeySet.has(x.key));

  const allSegs = [...structuralSegs, ...keptAnnot.map(x => x.seg), ...toAddAnnot.map(x => x.seg)];
  if (allSegs.length === 0) { return null; }

  // Detect the continuation indent used by the existing block (fall back to 4 spaces).
  const existingIndent = (() => {
    for (let i = blockStart + 1; i < blockEnd; i++) {
      const m = lines[i].match(/^(\s+)/);
      if (m) { return m[1]; }
    }
    return '    ';
  })();

  // Rebuild block
  const rebuiltLines: string[] = [];
  rebuiltLines.push(`${subjectToken} ${allSegs[0]}${allSegs.length === 1 ? ' .' : ' ;'}`);
  for (let i = 1; i < allSegs.length; i++) {
    const isLast = i === allSegs.length - 1;
    rebuiltLines.push(`${existingIndent}${allSegs[i]}${isLast ? ' .' : ' ;'}`);
  }

  // Idempotency: if the rebuilt block is identical to the existing block, no write needed.
  const existingBlock = lines.slice(blockStart, blockEnd).join('\n');
  if (rebuiltLines.join('\n') === existingBlock) { return null; }

  const edit = new vscode.WorkspaceEdit();
  const replaceStart = doc.lineAt(blockStart).range.start;
  const replaceEnd = doc.lineAt(blockEnd - 1).rangeIncludingLineBreak.end;
  edit.replace(doc.uri, new vscode.Range(replaceStart, replaceEnd), rebuiltLines.join('\n') + '\n');

  // Decorate only the newly added annotation lines at the end of the rebuilt block.
  const numAdded = toAddAnnot.length;
  const annotLineStart = blockStart + rebuiltLines.length - numAdded;
  const addedRanges = toAddAnnot.map((_, i) => {
    const lineIdx = annotLineStart + i;
    return new vscode.Range(lineIdx, 0, lineIdx, rebuiltLines[rebuiltLines.length - numAdded + i].length);
  });

  return { edit, addedRanges };
}

// ── Public API ─────────────────────────────────────────────────────────────────

interface SyncResult {
  edit: vscode.WorkspaceEdit;
  addedRanges: vscode.Range[];
  deletedAnnotPositions?: Map<string, number>;
}

export async function syncAnnotationsToDocument(
  uri: vscode.Uri,
  entity: OWLEntity,
  sourceFormat?: string,
  rawContent?: string,
  segment?: EntitySegment,
  skipWrite = false,
  positionHints?: Map<string, number>,
): Promise<{ changedRanges: vscode.Range[]; updatedText: string; lineDelta: number; editSummaries: EditSummary[]; deletedAnnotPositions?: Map<string, number> } | null> {
  if (temporaryClassIris.has(entity.iri)) { return null; }

  // Resolve format: prefer the caller-supplied sourceFormat (derived from parse-time detection),
  // then fall back to file extension so the function still works standalone.
  const fmt = sourceFormat ?? extensionFormat(uri.fsPath.toLowerCase());

  if (!fmt) {
    void vscode.window.showInformationMessage(
      'OntoGraph: Annotation sync is supported for functional (.ofn, .owl), Manchester (.omn), and Turtle (.ttl) files.'
    );
    return null;
  }

  let text: string;
  if (rawContent !== undefined) {
    text = rawContent;
  } else {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fname = uri.fsPath.split(/[\\/]/).pop() ?? '';
      void vscode.window.showErrorMessage(`OntoGraph: cannot read '${fname}' — ${msg}.`);
      return null;
    }
    text = new TextDecoder().decode(bytes);
  }
  const doc = new RawTextDocument(uri, text) as unknown as vscode.TextDocument;

  let result: SyncResult | null = null;
  if (fmt === 'functional') {
    result = syncFunctional(doc, entity, segment, positionHints);
  } else if (fmt === 'manchester') {
    result = syncManchester(doc, entity);
  } else if (fmt === 'turtle') {
    result = syncTurtle(doc, entity);
  } else {
    console.error(`[OntoGraph syncAnnotations] unsupported fmt='${fmt}' for ${uri.fsPath}`);
    void vscode.window.showErrorMessage(`OntoGraph: annotation sync not supported for format '${fmt}'. Only functional, manchester, and turtle are supported.`);
    return null;
  }

  if (!result) { return null; }

  const hint = segment ? { startLine: segment.startLine, startChar: segment.startChar } : undefined;
  const offsetEdits: OffsetEdit[] = [];
  const updatedText = applyWorkspaceEditsToText(text, result.edit, hint, offsetEdits);
  // AnnotationSync only ever touches the entity's main cluster (annotation
  // lines), so every edit belongs to the 'entity' segment map.
  const editSummaries: EditSummary[] = offsetEdits.map(o => ({ ...o, segmentMap: 'entity' as const }));
  if (!skipWrite) {
    const uriKey = uri.toString();
    beginSyncWrite(uriKey);
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedText));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fname = uri.fsPath.split(/[\\/]/).pop() ?? '';
      console.error(`[OntoGraph syncAnnotations] writeFile FAILED: ${msg}`);
      void vscode.window.showErrorMessage(`OntoGraph: cannot write '${fname}' — ${msg}.`);
      return null;
    } finally {
      endSyncWrite(uriKey);
    }
  }

  return {
    changedRanges: result.addedRanges,
    updatedText,
    lineDelta: countLineDelta(result.edit),
    editSummaries,
    deletedAnnotPositions: result.deletedAnnotPositions,
  };
}

function extensionFormat(fsPath: string): string | undefined {
  if (fsPath.endsWith('.ofn') || fsPath.endsWith('.owf')) { return 'functional'; }
  if (fsPath.endsWith('.omn')) { return 'manchester'; }
  if (fsPath.endsWith('.ttl') || fsPath.endsWith('.n3')) { return 'turtle'; }
  return undefined;
}
