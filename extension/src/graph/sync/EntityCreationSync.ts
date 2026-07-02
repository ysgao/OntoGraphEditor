import * as vscode from 'vscode';
import type { OWLEntityUnion, OntologyModel } from '../model/OntologyModel.js';
import { generateEntityCluster } from '../serializer/FunctionalSerializer.js';

// Bare `Declaration(...)` text without indentation — the caller prepends the
// indentation detected from neighbouring declarations.
function declarationBodyFor(entity: OWLEntityUnion): string {
  const iriStr = `<${entity.iri}>`;
  switch (entity.type) {
    case 'class':             return `Declaration(Class(${iriStr}))`;
    case 'objectProperty':    return `Declaration(ObjectProperty(${iriStr}))`;
    case 'dataProperty':      return `Declaration(DataProperty(${iriStr}))`;
    case 'annotationProperty':return `Declaration(AnnotationProperty(${iriStr}))`;
    case 'individual':        return `Declaration(NamedIndividual(${iriStr}))`;
  }
}

// Matches a Declaration line, capturing leading indentation (1) and the OWL
// declaration keyword (2). Used to keep new declarations grouped with — and
// ordered relative to — existing ones of each kind.
const DECL_LINE_RE =
  /^([ \t]*)Declaration\((Class|ObjectProperty|DataProperty|AnnotationProperty|NamedIndividual)\(/;

// Canonical Protégé declaration ordering: classes, then object/data/annotation
// properties, then named individuals.
const DECL_KEYWORD_RANK: Record<string, number> = {
  Class: 0, ObjectProperty: 1, DataProperty: 2, AnnotationProperty: 3, NamedIndividual: 4,
};

function entityDeclRank(entity: OWLEntityUnion): number {
  switch (entity.type) {
    case 'class':             return DECL_KEYWORD_RANK.Class;
    case 'objectProperty':    return DECL_KEYWORD_RANK.ObjectProperty;
    case 'dataProperty':      return DECL_KEYWORD_RANK.DataProperty;
    case 'annotationProperty':return DECL_KEYWORD_RANK.AnnotationProperty;
    case 'individual':        return DECL_KEYWORD_RANK.NamedIndividual;
  }
}

// Matches entity cluster header comments: "# Class: ...", "# ObjectProperty: ...", etc.
const CLUSTER_HEADER_RE = /^\s*#\s*(Class|ObjectProperty|DataProperty|AnnotationProperty|Individual):/;

// GCI axiom: SubClassOf where the first argument is a complex class expression —
// identified by an uppercase-leading OWL keyword (ObjectIntersectionOf, ObjectSomeValuesFrom,
// DataSomeValuesFrom, etc.). Named classes start with '<' or ':' (CURIE prefix), never uppercase.
// This matches both full-IRI form (<A>) and CURIE-prefix form (:a) files.
// Consistent with the same check in SegmentIndex.buildModelSegmentIndex and
// AxiomSync.isGCIAxiomLine.
const GCI_RE = /^\s*SubClassOf\(\s*[A-Z]/;

/**
 * Insert a new entity Declaration and entity cluster into an OWL Functional
 * Syntax document. Returns the modified document text.
 *
 * Cluster insertion strategy (in priority order):
 *   1. After the last existing entity cluster header (anchors to the cluster section
 *      regardless of where GCI axioms happen to be in the file)
 *   2. Before the first GCI axiom (`SubClassOf(ObjectIntersectionOf(...) ...)`)
 *   3. Before the Ontology closing `)`
 *
 * For non-functional formats, shows a warning and returns documentText unchanged.
 */
export function insertNewEntity(
  documentText: string,
  entity: OWLEntityUnion,
  model: OntologyModel,
  outRanges?: vscode.Range[],
): string {
  if (model.sourceFormat !== 'functional') {
    vscode.window.showWarningMessage(
      'Entity creation is only supported for OWL Functional Syntax in this release.',
    );
    return documentText;
  }

  const lines = documentText.split('\n');

  // Collect every Declaration line with its kind-rank and indentation so the new
  // declaration can be grouped with same-kind declarations (e.g. a new Class lands
  // among the Class declarations, before the ObjectProperty block).
  const decls: Array<{ idx: number; rank: number; indent: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DECL_LINE_RE.exec(lines[i] ?? '');
    if (m) { decls.push({ idx: i, rank: DECL_KEYWORD_RANK[m[2]], indent: m[1] }); }
  }
  // Last declaration of ANY kind — marks the end of the declaration block, used to
  // anchor the cluster search below.
  const lastDeclIdx = decls.length > 0 ? decls[decls.length - 1].idx : -1;

  // Decide where the new declaration goes and what indentation it should use.
  const newRank = entityDeclRank(entity);
  let declInsertIdx = -1; // splice index; -1 means "no existing declarations"
  let declIndent = '';
  if (decls.length > 0) {
    const sameKind = decls.filter(d => d.rank === newRank);
    if (sameKind.length > 0) {
      // After the last declaration of the same kind.
      const anchor = sameKind[sameKind.length - 1];
      declInsertIdx = anchor.idx + 1;
      declIndent = anchor.indent;
    } else {
      // No same-kind declarations: insert before the first higher-ranked kind to
      // keep canonical ordering, else after the last declaration.
      const after = decls.find(d => d.rank > newRank);
      const anchor = after ?? decls[decls.length - 1];
      declInsertIdx = after ? after.idx : anchor.idx + 1;
      declIndent = anchor.indent;
    }
  }

  // Find the Ontology closing ) — a bare ')' with optional whitespace
  let closingParenIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*\)\s*$/.test(lines[i] ?? '')) {
      closingParenIdx = i;
      break;
    }
  }

  if (closingParenIdx === -1) {
    return documentText + '\n' + declIndent + declarationBodyFor(entity);
  }

  // Find the last entity cluster header that appears AFTER the declarations block.
  // This anchors cluster insertion to the actual cluster section, regardless of
  // where GCI axioms are located in the file.
  const searchFrom = lastDeclIdx === -1 ? 0 : lastDeclIdx + 1;
  let lastClusterHeaderIdx = -1;
  for (let i = searchFrom; i < closingParenIdx; i++) {
    if (CLUSTER_HEADER_RE.test(lines[i] ?? '')) {
      lastClusterHeaderIdx = i;
    }
  }

  // Match the indentation already used by existing clusters so insertion never
  // changes the file's format. Captured BEFORE any splice (line indices are still
  // valid here). Defaults to column 0 — the Protégé/SNOMED canonical style — when
  // the file has no clusters yet.
  const clusterIndent = lastClusterHeaderIdx >= 0
    ? (/^[ \t]*/.exec(lines[lastClusterHeaderIdx] ?? '')?.[0] ?? '')
    : '';

  // Determine cluster insertion point
  let clusterInsertIdx = closingParenIdx; // default: just before closing )

  if (lastClusterHeaderIdx !== -1) {
    // Walk forward from the last cluster header to find where its cluster ends:
    // either the next cluster header, a GCI axiom, a property chain, or closing ).
    for (let i = lastClusterHeaderIdx + 1; i <= closingParenIdx; i++) {
      const line = lines[i] ?? '';
      if (
        CLUSTER_HEADER_RE.test(line) ||
        GCI_RE.test(line) ||
        /^\s*SubObjectPropertyOf\(ObjectPropertyChain\(/.test(line) ||
        /^\s*\)\s*$/.test(line)
      ) {
        clusterInsertIdx = i;
        break;
      }
    }
  } else {
    // No existing clusters — prefer before the first GCI axiom
    for (let i = searchFrom; i < closingParenIdx; i++) {
      if (GCI_RE.test(lines[i] ?? '')) {
        clusterInsertIdx = i;
        break;
      }
    }
  }

  // Insert the Declaration, grouped with same-kind declarations.
  const declLine = declIndent + declarationBodyFor(entity);
  let declLineIdx: number;
  if (declInsertIdx === -1) {
    // No existing declarations: drop it in just before the closing ).
    declLineIdx = closingParenIdx;
    lines.splice(closingParenIdx, 0, declLine);
    closingParenIdx++;
    if (clusterInsertIdx >= closingParenIdx - 1) { clusterInsertIdx++; }
  } else {
    declLineIdx = declInsertIdx;
    lines.splice(declInsertIdx, 0, declLine);
    if (closingParenIdx >= declInsertIdx) { closingParenIdx++; }
    if (clusterInsertIdx >= declInsertIdx) { clusterInsertIdx++; }
  }

  // Insert the entity cluster, matching existing cluster indentation and
  // separated from surrounding content by a single blank line on each side
  // (without doubling an existing blank).
  const clusterLines = generateEntityCluster(entity, model).map(l => clusterIndent + l);
  const prevBlank = (lines[clusterInsertIdx - 1] ?? '').trim() === '';
  const nextBlank = (lines[clusterInsertIdx] ?? '').trim() === '';
  const lead = prevBlank ? [] : [''];
  const trail = nextBlank ? [] : [''];
  const insertBlock = [...lead, ...clusterLines, ...trail];
  lines.splice(clusterInsertIdx, 0, ...insertBlock);

  // Report the inserted line ranges so the caller can highlight them (display-only;
  // the cluster splice happens after the declaration splice, and the cluster always
  // sits after the declaration, so declLineIdx is already final).
  if (outRanges) {
    outRanges.push(new vscode.Range(declLineIdx, 0, declLineIdx, declLine.length));
    const clusterStart = clusterInsertIdx + lead.length;
    const clusterEnd = clusterStart + clusterLines.length - 1;
    const lastLen = clusterLines[clusterLines.length - 1]?.length ?? 0;
    outRanges.push(new vscode.Range(clusterStart, 0, clusterEnd, lastLen));
  }

  return lines.join('\n');
}
