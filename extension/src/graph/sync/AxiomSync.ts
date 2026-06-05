import * as vscode from 'vscode';
import { generateEntityCluster } from '../serializer/FunctionalSerializer';
import { manchesterToFunctional } from '../utils/ExpressionUtils';
import { temporaryClassIris } from '../views/DLQueryState.js';
import { beginSyncWrite, endSyncWrite } from './reloadGuard';
import { RawTextDocument, applyWorkspaceEditsToText, countLineDelta, type OffsetEdit } from './RawTextDocument';
import type { EditSummary } from '../model/SegmentIndex';
import type {
  OWLEntity,
  OWLClass,
  OWLObjectProperty,
  OWLDataProperty,
  OWLAnnotationProperty,
  OWLIndividual,
  OntologyModel,
  EntitySegment,
} from '../model/OntologyModel';
import { createEmptyModel, BUILTIN_ANNOTATION_PROP_IRIS } from '../model/OntologyModel';

const BUILTIN_ANN_SET = new Set(BUILTIN_ANNOTATION_PROP_IRIS);

const RDFS_PREFIX = 'http://www.w3.org/2000/01/rdf-schema#';
const RDFS_ANN_TO_TOKEN = new Map<string, string>([
  [`${RDFS_PREFIX}label`,       'rdfs:label'],
  [`${RDFS_PREFIX}comment`,     'rdfs:comment'],
  [`${RDFS_PREFIX}seeAlso`,     'rdfs:seeAlso'],
  [`${RDFS_PREFIX}isDefinedBy`, 'rdfs:isDefinedBy'],
]);

// ── Shared helpers ─────────────────────────────────────────────────────────────

function detectFunctionalIndent(lines: string[]): string {
  for (const line of lines) {
    if (/^\s+[A-Za-z(]/.test(line) && !line.trimStart().startsWith('Prefix')) {
      return line.match(/^(\s+)/)?.[1] ?? '  ';
    }
  }
  return '  ';
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
        return bestName + localName;
      }
    }
  }
  return `<${iri}>`;
}

// Detect which prefixes appear as CURIEs in sample lines (e.g. an entity's own axiom lines).
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

// Post-process a generated line by replacing each <full-IRI> token with its file-convention form.
function applyFileIriConvention(line: string, prefixes: Map<string, string>, usedPrefixes: Set<string>): string {
  return line.replace(/<([^<>"\s]+)>/g, (_, iri) => abbreviateIri(iri, prefixes, usedPrefixes));
}

// Replace all bare full IRIs in a stored Manchester expression with abbreviated form
const BARE_IRI_RE = /https?:\/\/[^\s(),{}[\]]+/g;
function abbreviateExprIris(expr: string, prefixes: Map<string, string>): string {
  return expr.replace(BARE_IRI_RE, iri => abbreviateIri(iri, prefixes));
}

function fmtLiteral(value: string, lang?: string): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  return lang ? `"${esc}"@${lang}` : `"${esc}"`;
}

function fmtDataLiteral(value: string, datatype?: string): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  if (datatype) {
    return `"${esc}"^^${abbreviateIri(datatype, new Map())}`;
  }
  return `"${esc}"`;
}

// Produce annotation predicate segments from entity.labels and entity.annotations
function entityAnnotationSegs(entity: OWLEntity, prefixes: Map<string, string>): string[] {
  const segs: string[] = [];
  for (const [lang, vals] of Object.entries(entity.labels)) {
    for (const v of vals) {
      segs.push(`${abbreviateIri(`${RDFS_PREFIX}label`, prefixes)} ${fmtLiteral(v, lang || undefined)}`);
    }
  }
  for (const [propIri, vals] of Object.entries(entity.annotations)) {
    for (const raw of vals) {
      const at = raw.lastIndexOf('@');
      const hasLang = at > 0 && /^[A-Za-z][A-Za-z0-9\-]*$/.test(raw.slice(at + 1));
      const text = hasLang ? raw.slice(0, at) : raw;
      const lang = hasLang ? raw.slice(at + 1) : undefined;
      segs.push(`${abbreviateIri(propIri, prefixes)} ${fmtLiteral(text, lang)}`);
    }
  }
  return segs;
}

// ── OWL Functional Syntax (.ofn / .owf) ───────────────────────────────────────

// Keywords whose lines we manage (delete old, insert new) per entity
const CLASS_AXIOM_KWS = new Set([
  'SubClassOf', 'EquivalentClasses', 'DisjointClasses', 'DisjointUnion',
]);
const OBJ_PROP_AXIOM_KWS = new Set([
  'SubObjectPropertyOf', 'ObjectPropertyDomain', 'ObjectPropertyRange',
  'FunctionalObjectProperty', 'InverseFunctionalObjectProperty',
  'TransitiveObjectProperty', 'SymmetricObjectProperty', 'AsymmetricObjectProperty',
  'ReflexiveObjectProperty', 'IrreflexiveObjectProperty', 'InverseObjectProperties',
  'EquivalentObjectProperties', 'DisjointObjectProperties',
]);
const DATA_PROP_AXIOM_KWS = new Set([
  'SubDataPropertyOf', 'DataPropertyDomain', 'DataPropertyRange',
  'FunctionalDataProperty',
]);
const ANN_PROP_AXIOM_KWS = new Set([
  'SubAnnotationPropertyOf', 'AnnotationPropertyDomain', 'AnnotationPropertyRange',
]);
const INDIVIDUAL_AXIOM_KWS = new Set([
  'ClassAssertion', 'ObjectPropertyAssertion', 'DataPropertyAssertion',
  'NegativeObjectPropertyAssertion', 'NegativeDataPropertyAssertion',
  'SameIndividual', 'DifferentIndividuals',
]);

function entityAxiomKeywords(entity: OWLEntity): Set<string> {
  switch (entity.type) {
    case 'class':              return CLASS_AXIOM_KWS;
    case 'objectProperty':     return OBJ_PROP_AXIOM_KWS;
    case 'dataProperty':       return DATA_PROP_AXIOM_KWS;
    case 'annotationProperty': return ANN_PROP_AXIOM_KWS;
    case 'individual':         return INDIVIDUAL_AXIOM_KWS;
  }
}

function generateFunctionalAxiomLines(entity: OWLEntity): string[] {
  // Use a dummy model for the serializer helper
  const dummyModel = createEmptyModel('dummy.ofn');
  const clusterLines = generateEntityCluster(entity, dummyModel);
  
  // Strip the comment header and initial annotations from the cluster
  // because AxiomSync manages logical axioms separately from AnnotationSync.
  // EXCEPT: In the new consistent arrangement, we WANT them clustered.
  // Actually, AxiomSync and AnnotationSync might conflict if we are not careful.
  // For now, let's keep it minimal to just logical axioms but using the same formatting.
  
  const lines: string[] = [];
  const iri = entity.iri;
  const a = (i: string) => `<${i}>`;

  if (entity.type === 'class') {
    const cls = entity as OWLClass;
    for (const eq of cls.equivalentClassIris) {
      lines.push(`  EquivalentClasses(${a(iri)} ${a(eq)})`);
    }
    for (const expr of cls.equivalentClassExpressions) {
      const fn = manchesterToFunctional(expr);
      if (fn) lines.push(`  EquivalentClasses(${a(iri)} ${fn})`);
    }
    for (const sup of cls.superClassIris) {
      lines.push(`  SubClassOf(${a(iri)} ${a(sup)})`);
    }
    for (const expr of cls.superClassExpressions) {
      const fn = manchesterToFunctional(expr);
      if (fn) lines.push(`  SubClassOf(${a(iri)} ${fn})`);
    }
    for (const dj of cls.disjointClassIris) {
      lines.push(`  DisjointClasses(${a(iri)} ${a(dj)})`);
    }
  } else if (entity.type === 'objectProperty') {
    const prop = entity as OWLObjectProperty;
    for (const sup of prop.superPropertyIris) {
      lines.push(`  SubObjectPropertyOf(${a(iri)} ${a(sup)})`);
    }
    for (const dom of prop.domainIris) {
      lines.push(`  ObjectPropertyDomain(${a(iri)} ${a(dom)})`);
    }
    for (const rng of prop.rangeIris) {
      lines.push(`  ObjectPropertyRange(${a(iri)} ${a(rng)})`);
    }
    if (prop.isFunctional)         lines.push(`  FunctionalObjectProperty(${a(iri)})`);
    if (prop.isInverseFunctional)  lines.push(`  InverseFunctionalObjectProperty(${a(iri)})`);
    if (prop.isTransitive)         lines.push(`  TransitiveObjectProperty(${a(iri)})`);
    if (prop.isSymmetric)          lines.push(`  SymmetricObjectProperty(${a(iri)})`);
    if (prop.isReflexive)          lines.push(`  ReflexiveObjectProperty(${a(iri)})`);
    if (prop.isIrreflexive)        lines.push(`  IrreflexiveObjectProperty(${a(iri)})`);
    if (prop.isAsymmetric)         lines.push(`  AsymmetricObjectProperty(${a(iri)})`);
    if (prop.inverseOfIri)         lines.push(`  InverseObjectProperties(${a(iri)} ${a(prop.inverseOfIri)})`);
    for (const eq of (prop.equivalentPropertyIris ?? []))
      lines.push(`  EquivalentObjectProperties(${a(iri)} ${a(eq)})`);
    for (const disj of (prop.disjointPropertyIris ?? []))
      lines.push(`  DisjointObjectProperties(${a(iri)} ${a(disj)})`);
    for (const chain of (prop.propertyChains ?? []))
      lines.push(`  SubObjectPropertyOf(ObjectPropertyChain(${chain.map(a).join(' ')}) ${a(iri)})`);
  } else if (entity.type === 'dataProperty') {
    const prop = entity as OWLDataProperty;
    for (const sup of prop.superPropertyIris) {
      lines.push(`  SubDataPropertyOf(${a(iri)} ${a(sup)})`);
    }
    for (const dom of prop.domainIris) {
      lines.push(`  DataPropertyDomain(${a(iri)} ${a(dom)})`);
    }
    for (const rng of prop.rangeIris) {
      lines.push(`  DataPropertyRange(${a(iri)} ${a(rng)})`);
    }
    if (prop.isFunctional) lines.push(`  FunctionalDataProperty(${a(iri)})`);
  } else if (entity.type === 'annotationProperty') {
    const prop = entity as OWLAnnotationProperty;
    for (const sup of prop.superPropertyIris) {
      lines.push(`  SubAnnotationPropertyOf(${a(iri)} ${a(sup)})`);
    }
    for (const dom of prop.domainIris) {
      lines.push(`  AnnotationPropertyDomain(${a(iri)} ${a(dom)})`);
    }
    for (const rng of prop.rangeIris) {
      lines.push(`  AnnotationPropertyRange(${a(iri)} ${a(rng)})`);
    }
  } else if (entity.type === 'individual') {
    const ind = entity as OWLIndividual;
    for (const cls of ind.classIris) {
      lines.push(`  ClassAssertion(${a(cls)} ${a(iri)})`);
    }
    for (const opa of ind.objectPropertyAssertions) {
      lines.push(`  ObjectPropertyAssertion(${a(opa.propertyIri)} ${a(iri)} ${a(opa.targetIri)})`);
    }
    for (const dpa of ind.dataPropertyAssertions) {
      lines.push(`  DataPropertyAssertion(${a(dpa.propertyIri)} ${a(iri)} ${fmtDataLiteral(dpa.value, dpa.datatype)})`);
    }
  }

  return lines;
}

// Match a line to an axiom keyword and verify the entity IRI is in the owned
// Check if `line` starts with `kw(<ws>?form<delim>` — first argument equals form.
function startsWithFormArg(line: string, kw: string, form: string): boolean {
  const prefix = `${kw}(`;
  if (!line.startsWith(prefix)) return false;
  let i = prefix.length;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  if (!line.startsWith(form, i)) return false;
  const after = i + form.length;
  if (after >= line.length) return false;
  const c = line.charCodeAt(after);
  return c === 32 || c === 9 || c === 41 || c === 44;
}

// Check if `line` ends with `form)` at the top-level — last argument equals form.
function endsWithFormArg(line: string, form: string): boolean {
  let s = line;
  while (s.length > 0 && (s.charCodeAt(s.length - 1) === 32 || s.charCodeAt(s.length - 1) === 9)) s = s.slice(0, -1);
  if (!s.endsWith(')')) return false;
  let inner = s.slice(0, -1);
  while (inner.length > 0 && (inner.charCodeAt(inner.length - 1) === 32 || inner.charCodeAt(inner.length - 1) === 9)) inner = inner.slice(0, -1);
  if (!inner.endsWith(form)) return false;
  const at = inner.length - form.length;
  if (at === 0) return false;
  const prev = inner.charCodeAt(at - 1);
  return prev === 32 || prev === 9 || prev === 41;
}

// Check whether the 2nd top-level token of `kw(...)` equals `form`.
function secondArgIs(line: string, kw: string, form: string): boolean {
  const prefix = `${kw}(`;
  if (!line.startsWith(prefix)) return false;
  let i = prefix.length;
  let depth = 1;
  const tokens: string[] = [];
  let cur = '';
  while (i < line.length && depth > 0 && tokens.length < 2) {
    const c = line[i];
    if (c === '(') { depth++; cur += c; }
    else if (c === ')') {
      depth--;
      if (depth === 0) break;
      cur += c;
    } else if (depth === 1 && (c === ' ' || c === '\t')) {
      if (cur.length > 0) { tokens.push(cur); cur = ''; }
    } else {
      cur += c;
    }
    i++;
  }
  if (cur.length > 0 && tokens.length < 2) tokens.push(cur);
  return tokens[1] === form;
}

// Detect whether `line` is a logical axiom owned by `entity`. Accepts entity
// IRIs in both `<full-IRI>` and prefix:CURIE forms — required because the file
// may store entity references in either form and `applyFileIriConvention`
// rewrites generated lines to match the file's form.
function isEntityAxiomLine(
  line: string, entity: OWLEntity, keywords: Set<string>, prefixes: Map<string, string>,
): boolean {
  const trimmed = line.trimStart();
  const kw = trimmed.match(/^([A-Za-z]+)\s*\(/);
  if (!kw || !keywords.has(kw[1])) return false;

  const forms = entityTokenForms(entity.iri, prefixes);
  const isFirst = forms.some(f => startsWithFormArg(trimmed, kw[1], f));
  const isLast = forms.some(f => endsWithFormArg(trimmed, f));

  switch (entity.type) {
    case 'class':
      if (kw[1] === 'SubClassOf') {
        // GCI: entity is the LAST arg and the FIRST arg is a complex expression
        // (i.e. NOT a form of this entity).
        return isFirst || (!isFirst && isLast);
      }
      return isFirst;

    case 'objectProperty':
      if (kw[1] === 'SubObjectPropertyOf' && trimmed.includes('ObjectPropertyChain(')) {
        return isLast;
      }
      return isFirst;

    case 'dataProperty':
    case 'annotationProperty':
      return isFirst;

    case 'individual':
      if (kw[1] === 'ClassAssertion' || kw[1] === 'ObjectPropertyAssertion' || kw[1] === 'DataPropertyAssertion') {
        return forms.some(f => secondArgIs(trimmed, kw[1], f));
      }
      return isFirst;
  }
}

// Build all tokens that resolve to this entity in a file: the bracket form
// `<full-IRI>` plus the CURIE form `prefix:localName` (longest matching
// prefix). `applyFileIriConvention` rewrites generated lines into CURIE form
// when the file uses one, so the line-recognition predicate must accept both.
function entityTokenForms(iri: string, prefixes: Map<string, string>): string[] {
  const forms: string[] = [`<${iri}>`];
  const sorted = [...prefixes.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [name, expansion] of sorted) {
    if (expansion.length > 0 && iri.startsWith(expansion)) {
      forms.push(name + iri.slice(expansion.length));
      break;
    }
  }
  return forms;
}

// True only for GCI SubClassOf lines: SubClassOf(complexExpr <entity>)
// Distinguished from regular SubClassOf(<entity> ...) by the complex LHS.
// Accepts both <full-IRI> and prefix:CURIE forms for the entity argument.
function isGCIAxiomLine(line: string, entity: OWLEntity, prefixes: Map<string, string>): boolean {
  if (entity.type !== 'class') return false;
  const trimmed = line.trimStart().replace(/\s+$/, '');
  if (!/^SubClassOf\s*\(/.test(trimmed)) return false;
  if (!trimmed.endsWith(')')) return false;

  // First argument must be a COMPLEX class expression — uppercase-leading
  // OWL keyword like `ObjectSomeValuesFrom(`, `ObjectIntersectionOf(`, etc.
  // If it starts with `<`, `:`, or a lowercase prefix it's a NAMED class
  // (regular SubClassOf), not a GCI. Without this guard,
  // `SubClassOf(:OtherEntity :ThisEntity)` would be misclassified as a GCI
  // whenever ThisEntity is the superclass.
  let firstArgPos = 'SubClassOf('.length;
  while (firstArgPos < trimmed.length &&
         (trimmed.charCodeAt(firstArgPos) === 32 || trimmed.charCodeAt(firstArgPos) === 9)) {
    firstArgPos++;
  }
  const firstCh = trimmed.charCodeAt(firstArgPos);
  const isComplexLhs = firstCh >= 65 && firstCh <= 90; // 'A'..'Z'
  if (!isComplexLhs) return false;

  // Last argument must be the entity in some form.
  const forms = entityTokenForms(entity.iri, prefixes);
  const inner = trimmed.slice('SubClassOf('.length, -1).replace(/\s+$/, '');
  for (const form of forms) {
    if (!inner.endsWith(form)) continue;
    const at = inner.length - form.length;
    if (at === 0) continue;
    const prevCh = inner.charCodeAt(at - 1);
    if (prevCh === 32 || prevCh === 9 || prevCh === 41) return true; // space, tab, ')'
  }
  return false;
}

// Generates only the GCI axiom lines (SubClassOf(complexExpr <entity>)) for functional syntax.
function generateFunctionalGCILines(entity: OWLEntity): string[] {
  if (entity.type !== 'class') return [];
  const cls = entity as OWLClass;
  const a = (i: string) => `<${i}>`;
  const lines: string[] = [];
  for (const expr of cls.gciExpressions ?? []) {
    const fn = manchesterToFunctional(expr);
    if (fn) lines.push(`  SubClassOf(${fn} ${a(cls.iri)})`);
  }
  return lines;
}

// Returns the Declaration keyword for Declaration(Keyword(<iri>)) matching.
function entityDeclarationKeyword(entity: OWLEntity): string {
  switch (entity.type) {
    case 'class':              return 'Class';
    case 'objectProperty':     return 'ObjectProperty';
    case 'dataProperty':       return 'DataProperty';
    case 'annotationProperty': return 'AnnotationProperty';
    case 'individual':         return 'NamedIndividual';
  }
}

// Returns the last line index that "anchors" the entity in a functional-syntax document:
// the entity's Declaration line or its last AnnotationAssertion. Returns -1 if neither found.
function findEntityAnchorLine(lines: string[], entity: OWLEntity): number {
  const entityToken = `<${entity.iri}>`;
  const escapedToken = entityToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declKw = entityDeclarationKeyword(entity);
  const declarationRe = new RegExp(
    `^\\s*Declaration\\s*\\(\\s*${declKw}\\s*\\(\\s*${escapedToken}\\s*\\)`
  );
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (declarationRe.test(lines[i])) {
      anchor = Math.max(anchor, i);
      continue;
    }
    if (/\bAnnotationAssertion\b/.test(lines[i]) && lines[i].includes(entityToken)) {
      anchor = Math.max(anchor, i);
    }
  }
  return anchor;
}

interface SyncResult {
  edit: vscode.WorkspaceEdit;
  changedRanges: vscode.Range[];
  /** Line numbers (in pre-edit text) where a GCI insert/delete is applied.
   *  Used by syncAxiomsToDocument to label OffsetEdit entries as 'gci' for
   *  the incremental segment-index updater. Functional format only. */
  gciEditLines?: Set<number>;
  deletedGciPositions?: Map<string, number>;
  deletedRegAxiomPositions?: Map<string, number>;
}

function changedLineRanges(startLine: number, lines: readonly string[]): vscode.Range[] {
  return lines.map((line, i) => new vscode.Range(startLine + i, 0, startLine + i, line.length));
}

// ── Diff-based insertion helpers ──────────────────────────────────────────────

function getAxiomKeyword(line: string): string | null {
  const m = line.trimStart().match(/^([A-Za-z]+)\s*\(/);
  return m ? m[1] : null;
}

// Relative ordering within a class cluster (lower = earlier).
// Keywords absent from this map all share priority 99 (property/individual axioms).
const AXIOM_KW_PRIORITY: Readonly<Record<string, number>> = {
  EquivalentClasses: 0, EquivalentUnion: 0,
  SubClassOf: 1,
  DisjointClasses: 2, DisjointUnion: 2,
};

// Find where to insert a new axiom with the given keyword.
// Uses keyword priority so EquivalentClasses always lands before SubClassOf, etc.
// Falls back to the position of the first removed line of the same keyword (in-place replacement),
// then to after the last kept line, then to anchor+1.
function findInsertionPointForKeyword(
  kw: string,
  keptLineIdxs: number[],
  removedLineIdxs: number[],
  lines: string[],
  anchor: number,
  fallbackLine: number,
): number {
  const myPriority = AXIOM_KW_PRIORITY[kw] ?? 99;
  let lastSameIdx = -1;
  let lastLowerPriorityIdx = -1;
  let firstHigherPriorityIdx = -1;

  for (const i of keptLineIdxs) {
    const lineKw = getAxiomKeyword(lines[i]);
    if (!lineKw) { continue; }
    const p = AXIOM_KW_PRIORITY[lineKw] ?? 99;
    if (lineKw === kw) {
      lastSameIdx = i;
    } else if (p < myPriority && i > lastLowerPriorityIdx) {
      lastLowerPriorityIdx = i;
    } else if (p > myPriority && (firstHigherPriorityIdx < 0 || i < firstHigherPriorityIdx)) {
      firstHigherPriorityIdx = i;
    }
  }

  if (lastSameIdx >= 0) { return lastSameIdx + 1; }
  if (lastLowerPriorityIdx >= 0) { return lastLowerPriorityIdx + 1; }
  if (firstHigherPriorityIdx >= 0) { return firstHigherPriorityIdx; }
  // No kept line established a position; use the first removed line of the same keyword
  // (the new line replaces it in-place when combined with the delete in the same edit).
  const firstRemovedSameKw = removedLineIdxs.find(i => getAxiomKeyword(lines[i]) === kw);
  if (firstRemovedSameKw !== undefined) { return firstRemovedSameKw; }
  const lastKeptIdx = keptLineIdxs.length > 0 ? keptLineIdxs[keptLineIdxs.length - 1] : -1;
  if (lastKeptIdx >= 0) { return lastKeptIdx + 1; }
  return anchor >= 0 ? anchor + 1 : fallbackLine;
}

function syncAxiomsFunctional(
  doc: vscode.TextDocument,
  entity: OWLEntity,
  segment?: EntitySegment,
  gciSegment?: EntitySegment,
  closingParenLine?: number,
  gciInsertLine?: number,
  positionHints?: { gcis: Map<string, number>; regAxioms: Map<string, number> },
): SyncResult | null {
  const text = doc.getText();
  const keywords = entityAxiomKeywords(entity);
  const filePrefixes = parsePrefixes(text, 'functional');

  // ── Build entity's chunk: per-line list (SNOMED-scale fast path) or contiguous slice ──
  const useLineList = !!(segment && segment.lineIndices && segment.lineCharStarts);
  let chunkLines: string[];
  // chunkAbsLines[k] = absolute file line number for chunkLines[k]
  let chunkAbsLines: number[];
  if (useLineList) {
    const idx = segment!.lineIndices!;
    const starts = segment!.lineCharStarts!;
    chunkLines = new Array(idx.length);
    chunkAbsLines = new Array(idx.length);
    for (let k = 0; k < idx.length; k++) {
      const start = starts[k];
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      chunkLines[k] = text.slice(start, end);
      chunkAbsLines[k] = idx[k];
    }
  } else {
    const lineOffset = segment?.startLine ?? 0;
    const chunkText = segment
      ? text.slice(segment.startChar, Math.min(segment.endChar + 4096, text.length))
      : text;
    chunkLines = chunkText.split('\n');
    chunkAbsLines = new Array(chunkLines.length);
    for (let i = 0; i < chunkLines.length; i++) chunkAbsLines[i] = lineOffset + i;
  }

  // Chunk-relative indices for regular axiom lines
  const existingRegChunkIdxs: number[] = [];
  for (let i = 0; i < chunkLines.length; i++) {
    if (isEntityAxiomLine(chunkLines[i], entity, keywords, filePrefixes) && !isGCIAxiomLine(chunkLines[i], entity, filePrefixes)) {
      existingRegChunkIdxs.push(i);
    }
  }

  // ── GCI axioms: scan gciSegment chunk (GCIs are at end of file, outside cluster) ──

  const existingGciAbsIdxs: number[] = [];
  const gciLineTrimmed: string[] = [];

  if (gciSegment) {
    const gciLineOff = gciSegment.startLine;
    const gciChunk = text.slice(gciSegment.startChar, Math.min(gciSegment.endChar + 4096, text.length));
    const gciChunkLines = gciChunk.split('\n');
    for (let i = 0; i < gciChunkLines.length; i++) {
      if (isGCIAxiomLine(gciChunkLines[i], entity, filePrefixes)) {
        existingGciAbsIdxs.push(gciLineOff + i);
        gciLineTrimmed.push(gciChunkLines[i].trim());
      }
    }
  } else if (!segment) {
    // No segment: full-text scan for GCIs (fallback, same as pre-optimization path)
    for (let i = 0; i < chunkLines.length; i++) {
      if (isEntityAxiomLine(chunkLines[i], entity, keywords, filePrefixes) && isGCIAxiomLine(chunkLines[i], entity, filePrefixes)) {
        existingGciAbsIdxs.push(i);
        gciLineTrimmed.push(chunkLines[i].trim());
      }
    }
  }

  // ── Indent detection ─────────────────────────────────────────────────────────

  // Prefer entity's own existing axiom line indent; for SNOMED-style files where axiom lines
  // have no leading whitespace, this yields '' (match file convention exactly).
  const firstChunkIdx = existingRegChunkIdxs[0] ?? -1;
  let indent: string;
  if (firstChunkIdx >= 0) {
    indent = chunkLines[firstChunkIdx].match(/^(\s+)/)?.[1] ?? (useLineList ? '' : detectFunctionalIndent(chunkLines));
  } else if (useLineList) {
    let detected = '';
    for (const s of chunkLines) {
      const m = s.match(/^(\s+)/);
      if (m) { detected = m[1]; break; }
    }
    indent = detected;
  } else {
    indent = detectFunctionalIndent(chunkLines);
  }

  // ── Generate model lines ─────────────────────────────────────────────────────

  // Detect IRI-form convention from the entity's own existing AXIOM lines only (CURIE vs full).
  // Annotation lines are excluded: in SNOMED-scale files, annotations use base-prefix CURIEs
  // while axioms use full IRIs — mixing them would cause false positive prefix detection.
  const axiomOnlyChunkLines = useLineList
    ? chunkLines.filter(l => !l.trimStart().startsWith('AnnotationAssertion('))
    : chunkLines;
  const usedPrefixes = useLineList ? detectUsedPrefixesFromLines(axiomOnlyChunkLines, filePrefixes) : new Set<string>();

  // Dedupe model lines by trimmed text. Required so the multiset diff treats
  // each distinct axiom as a single intended copy — without this, files that
  // already contain duplicates (from a pre-fix save) keep their duplicates
  // forever because parser → model → serializer reproduces them 1:1.
  const dedupeLines = (lines: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of lines) {
      const k = l.trim();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
    return out;
  };
  const modelRegLines = dedupeLines(generateFunctionalAxiomLines(entity)
    .map(l => applyFileIriConvention(indent + l.trimStart(), filePrefixes, usedPrefixes)));
  const modelGciLines = dedupeLines(generateFunctionalGCILines(entity)
    .map(l => applyFileIriConvention(indent + l.trimStart(), filePrefixes, usedPrefixes)));

  // ── Diff regular axioms (chunk-relative) ─────────────────────────────────────

  // Multiset diff: when file has N copies of a line and model has M, remove
  // max(0, N-M) and add max(0, M-N). Required because parser duplicates carry
  // through to the file (one save-without-dedup begets another); a set-based
  // diff would treat both sides as "present" and never clean up the extras.
  const regRemoveChunkIdxs: number[] = [];
  const regAddLines: string[] = [];
  {
    const fileGroups = new Map<string, number[]>();
    for (const ci of existingRegChunkIdxs) {
      const k = chunkLines[ci].trim();
      const arr = fileGroups.get(k);
      if (arr) arr.push(ci); else fileGroups.set(k, [ci]);
    }
    const modelByKey = new Map<string, string[]>();
    for (const l of modelRegLines) {
      const k = l.trim();
      const arr = modelByKey.get(k);
      if (arr) arr.push(l); else modelByKey.set(k, [l]);
    }
    for (const [k, indices] of fileGroups) {
      const wanted = modelByKey.get(k)?.length ?? 0;
      for (let i = wanted; i < indices.length; i++) regRemoveChunkIdxs.push(indices[i]);
    }
    for (const [k, lines] of modelByKey) {
      const have = fileGroups.get(k)?.length ?? 0;
      for (let i = have; i < lines.length; i++) regAddLines.push(lines[i]);
    }
  }

  // ── Diff GCI axioms (absolute) ────────────────────────────────────────────────

  const gciRemoveAbsIdxs: number[] = [];
  const gciAddLines: string[] = [];
  {
    const fileGroups = new Map<string, number[]>();
    for (let j = 0; j < gciLineTrimmed.length; j++) {
      const k = gciLineTrimmed[j];
      const arr = fileGroups.get(k);
      if (arr) arr.push(existingGciAbsIdxs[j]); else fileGroups.set(k, [existingGciAbsIdxs[j]]);
    }
    const modelByKey = new Map<string, string[]>();
    for (const l of modelGciLines) {
      const k = l.trim();
      const arr = modelByKey.get(k);
      if (arr) arr.push(l); else modelByKey.set(k, [l]);
    }
    for (const [k, indices] of fileGroups) {
      const wanted = modelByKey.get(k)?.length ?? 0;
      for (let i = wanted; i < indices.length; i++) gciRemoveAbsIdxs.push(indices[i]);
    }
    for (const [k, lines] of modelByKey) {
      const have = fileGroups.get(k)?.length ?? 0;
      for (let i = have; i < lines.length; i++) gciAddLines.push(lines[i]);
    }
  }

  if (regRemoveChunkIdxs.length === 0 && regAddLines.length === 0 &&
      gciRemoveAbsIdxs.length === 0 && gciAddLines.length === 0) {
    return null;
  }

  // ── Anchor (chunk-relative) ───────────────────────────────────────────────────

  const anchorChunk = findEntityAnchorLine(chunkLines, entity);

  // ── Precomputed global positions (absolute) ───────────────────────────────────

  const absClosingParenLine = closingParenLine ?? (() => {
    const allLines = text.split('\n');
    let cp = allLines.length > 1 ? allLines.length - 1 : allLines.length;
    for (let i = allLines.length - 1; i >= 0; i--) {
      if (allLines[i].trim() === ')') { cp = i; break; }
    }
    return cp;
  })();

  const absGciInsertAt = gciInsertLine ?? (() => {
    const allLines = text.split('\n');
    let gi = absClosingParenLine;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].trim().startsWith('SubObjectPropertyOf(ObjectPropertyChain')) { gi = i; break; }
    }
    return gi;
  })();

  // ── Insertion points (chunk-relative for regular, absolute for GCIs) ──────────

  const regRemoveChunkSet = new Set(regRemoveChunkIdxs);
  const keptChunkIdxs = existingRegChunkIdxs.filter(ci => !regRemoveChunkSet.has(ci));
  const chunkFallback = anchorChunk >= 0 ? anchorChunk + 1 : chunkLines.length - 1;

  const insertsByChunkLine = new Map<number, string[]>();
  const regHintInsertsMap = new Map<number, string[]>();

  for (const line of regAddLines) {
    const trimmed = line.trim();
    const hintLine = positionHints?.regAxioms.get(trimmed);
    if (hintLine !== undefined) {
      if (!regHintInsertsMap.has(hintLine)) regHintInsertsMap.set(hintLine, []);
      regHintInsertsMap.get(hintLine)!.push(line);
    } else {
      const kw = getAxiomKeyword(line) ?? '';
      const atChunk = findInsertionPointForKeyword(
        kw, keptChunkIdxs, regRemoveChunkIdxs, chunkLines, anchorChunk, chunkFallback,
      );
      if (!insertsByChunkLine.has(atChunk)) insertsByChunkLine.set(atChunk, []);
      insertsByChunkLine.get(atChunk)!.push(line);
    }
  }

  // ── Build WorkspaceEdit (absolute positions) ──────────────────────────────────

  const edit = new vscode.WorkspaceEdit();

  // Map chunk index → absolute file line. Past-end inserts go right after last entity line.
  const chunkToAbs = (ci: number): number => {
    if (ci < chunkAbsLines.length) return chunkAbsLines[ci];
    return chunkAbsLines.length > 0 ? chunkAbsLines[chunkAbsLines.length - 1] + 1 : ci;
  };

  // Track which pre-edit line numbers are GCI-related so syncAxiomsToDocument
  // can label the corresponding OffsetEdit entries for the incremental
  // segment-index update.
  const gciEditLines = new Set<number>(gciRemoveAbsIdxs);

  const allRemovesAbs = [
    ...regRemoveChunkIdxs.map(ci => chunkAbsLines[ci]),
    ...gciRemoveAbsIdxs,
  ].sort((a, b) => b - a);

  const allRemovedAbsSorted = [...allRemovesAbs].sort((a, b) => a - b);
  const postDeleteLine = (preLine: number): number =>
    preLine - allRemovedAbsSorted.filter(l => l < preLine).length;

  const gciRemoveSet = new Set(gciRemoveAbsIdxs);
  const deletedGciPositions = new Map<string, number>();
  for (let j = 0; j < existingGciAbsIdxs.length; j++) {
    if (gciRemoveSet.has(existingGciAbsIdxs[j])) {
      deletedGciPositions.set(gciLineTrimmed[j], postDeleteLine(existingGciAbsIdxs[j]));
    }
  }
  const deletedRegAxiomPositions = new Map<string, number>();
  for (const ci of regRemoveChunkIdxs) {
    const preLine = chunkAbsLines[ci];
    deletedRegAxiomPositions.set(chunkLines[ci].trim(), postDeleteLine(preLine));
  }

  for (const absI of allRemovesAbs) {
    edit.delete(doc.uri, new vscode.Range(absI, 0, absI + 1, 0));
  }

  for (const [chunkAt, insertLines] of insertsByChunkLine) {
    edit.insert(doc.uri, new vscode.Position(chunkToAbs(chunkAt), 0), insertLines.join('\n') + '\n');
  }

  const gciInsertsMap = new Map<number, string[]>();
  for (const addLine of gciAddLines) {
    const trimmed = addLine.trim();
    const hintLine = positionHints?.gcis.get(trimmed);
    const absPos = hintLine ?? absGciInsertAt;
    if (!gciInsertsMap.has(absPos)) gciInsertsMap.set(absPos, []);
    gciInsertsMap.get(absPos)!.push(addLine);
  }
  for (const [absPos, insertLines] of gciInsertsMap) {
    edit.insert(doc.uri, new vscode.Position(absPos, 0), insertLines.join('\n') + '\n');
    gciEditLines.add(absPos);
  }
  for (const [absPos, insertLines] of regHintInsertsMap) {
    edit.insert(doc.uri, new vscode.Position(absPos, 0), insertLines.join('\n') + '\n');
  }

  // ── changedRanges in post-edit coordinates ────────────────────────────────────

  const changedRanges: vscode.Range[] = [];
  const allRemovesSorted = [...allRemovesAbs].sort((a, b) => a - b);
  const allInsertions: Array<[number, string[]]> = [
    ...[...insertsByChunkLine.entries()].map(([ci, ls]) => [chunkToAbs(ci), ls] as [number, string[]]),
    ...[...gciInsertsMap.entries()].map(([absPos, ls]) => [absPos, ls] as [number, string[]]),
    ...[...regHintInsertsMap.entries()].map(([absPos, ls]) => [absPos, ls] as [number, string[]]),
  ].sort((a, b) => a[0] - b[0]);

  for (const [origLine, insertedLines] of allInsertions) {
    const deletedBefore = allRemovesSorted.filter(d => d < origLine).length;
    const insertedBefore = allInsertions
      .filter(([pos]) => pos < origLine)
      .reduce((sum, [, ls]) => sum + ls.length, 0);
    const postStart = origLine - deletedBefore + insertedBefore;
    for (let i = 0; i < insertedLines.length; i++) {
      changedRanges.push(new vscode.Range(postStart + i, 0, postStart + i, insertedLines[i].length));
    }
  }

  return { edit, changedRanges, gciEditLines, deletedGciPositions, deletedRegAxiomPositions };
}

// ── Manchester Syntax (.omn) ───────────────────────────────────────────────────

const FRAME_KW_RE = /^(Class|ObjectProperty|DataProperty|AnnotationProperty|Individual)\s*:\s*(.*)/;
const TOPLEVEL_KW_RE = /^(Class|ObjectProperty|DataProperty|AnnotationProperty|Individual|DisjointClasses|EquivalentClasses|Prefix|Ontology)\s*:/;
const SECTION_KW_RE = /^\s+(Annotations|SubClassOf|EquivalentTo|DisjointWith|Domain|Range|Characteristics|InverseOf|SubPropertyOf|Types|Facts)\s*:/;

function findManchesterEntityFrame(
  lines: string[], entityIri: string, prefixes: Map<string, string>,
): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FRAME_KW_RE);
    if (!m) continue;
    if (resolveIri(m[2].trim(), prefixes) !== entityIri) continue;
    let end = i + 1;
    while (end < lines.length && !TOPLEVEL_KW_RE.test(lines[end])) { end++; }
    return { start: i, end };
  }
  return null;
}

function generateManchesterAxiomSections(entity: OWLEntity, prefixes: Map<string, string>): string {
  const ab = (iri: string) => abbreviateIri(iri, prefixes);
  const abExpr = (e: string) => abbreviateExprIris(e, prefixes);
  const lines: string[] = [];

  if (entity.type === 'class') {
    const cls = entity as OWLClass;
    const subItems = [
      ...cls.superClassIris.map(ab),
      ...cls.superClassExpressions.map(abExpr),
    ];
    if (subItems.length > 0) {
      lines.push(`    SubClassOf: ${subItems.join(',\n        ')}`);
    }
    const eqItems = [
      ...cls.equivalentClassIris.map(ab),
      ...cls.equivalentClassExpressions.map(abExpr),
    ];
    if (eqItems.length > 0) {
      lines.push(`    EquivalentTo: ${eqItems.join(',\n        ')}`);
    }
    if (cls.disjointClassIris.length > 0) {
      lines.push(`    DisjointWith: ${cls.disjointClassIris.map(ab).join(',\n        ')}`);
    }
  } else if (entity.type === 'objectProperty') {
    const prop = entity as OWLObjectProperty;
    if (prop.superPropertyIris.length > 0) {
      lines.push(`    SubPropertyOf: ${prop.superPropertyIris.map(ab).join(',\n        ')}`);
    }
    if (prop.domainIris.length > 0) {
      lines.push(`    Domain: ${prop.domainIris.map(ab).join(',\n        ')}`);
    }
    if (prop.rangeIris.length > 0) {
      lines.push(`    Range: ${prop.rangeIris.map(ab).join(',\n        ')}`);
    }
    const chars: string[] = [];
    if (prop.isFunctional)         chars.push('Functional');
    if (prop.isInverseFunctional)  chars.push('InverseFunctional');
    if (prop.isTransitive)         chars.push('Transitive');
    if (prop.isSymmetric)          chars.push('Symmetric');
    if (prop.isReflexive)          chars.push('Reflexive');
    if (prop.isIrreflexive)        chars.push('Irreflexive');
    if (prop.isAsymmetric)         chars.push('Asymmetric');
    if (chars.length > 0) lines.push(`    Characteristics: ${chars.join(', ')}`);
    if (prop.inverseOfIri) lines.push(`    InverseOf: ${ab(prop.inverseOfIri)}`);
    if ((prop.equivalentPropertyIris ?? []).length > 0)
      lines.push(`    EquivalentTo: ${prop.equivalentPropertyIris!.map(ab).join(',\n        ')}`);
    if ((prop.disjointPropertyIris ?? []).length > 0)
      lines.push(`    DisjointWith: ${prop.disjointPropertyIris!.map(ab).join(',\n        ')}`);
    for (const chain of (prop.propertyChains ?? []))
      lines.push(`    SubPropertyChain: ${chain.map(ab).join(' o ')}`);
  } else if (entity.type === 'dataProperty') {
    const prop = entity as OWLDataProperty;
    if (prop.superPropertyIris.length > 0) {
      lines.push(`    SubPropertyOf: ${prop.superPropertyIris.map(ab).join(',\n        ')}`);
    }
    if (prop.domainIris.length > 0) {
      lines.push(`    Domain: ${prop.domainIris.map(ab).join(',\n        ')}`);
    }
    if (prop.rangeIris.length > 0) {
      lines.push(`    Range: ${prop.rangeIris.map(ab).join(',\n        ')}`);
    }
    if (prop.isFunctional) lines.push('    Characteristics: Functional');
  } else if (entity.type === 'annotationProperty') {
    const prop = entity as OWLAnnotationProperty;
    if (prop.superPropertyIris.length > 0) {
      lines.push(`    SubPropertyOf: ${prop.superPropertyIris.map(ab).join(',\n        ')}`);
    }
    if (prop.domainIris.length > 0) {
      lines.push(`    Domain: ${prop.domainIris.map(ab).join(',\n        ')}`);
    }
    if (prop.rangeIris.length > 0) {
      lines.push(`    Range: ${prop.rangeIris.map(ab).join(',\n        ')}`);
    }
  } else if (entity.type === 'individual') {
    const ind = entity as OWLIndividual;
    if (ind.classIris.length > 0) {
      lines.push(`    Types: ${ind.classIris.map(ab).join(',\n        ')}`);
    }
    const facts: string[] = [
      ...ind.objectPropertyAssertions.map(a => `${ab(a.propertyIri)} ${ab(a.targetIri)}`),
      ...ind.dataPropertyAssertions.map(a => {
        const lit = fmtDataLiteralManchester(a.value, a.datatype, prefixes);
        return `${ab(a.propertyIri)} ${lit}`;
      }),
    ];
    if (facts.length > 0) {
      lines.push(`    Facts: ${facts.join(',\n        ')}`);
    }
  }

  return lines.join('\n');
}

function fmtDataLiteralManchester(value: string, datatype: string | undefined, prefixes: Map<string, string>): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  if (datatype) {
    return `"${esc}"^^${abbreviateIri(datatype, prefixes)}`;
  }
  return `"${esc}"`;
}

// Axiom section keywords we manage (NOT Annotations — that's AnnotationSync's job)
const MANAGED_SECTION_KWS = new Set([
  'SubClassOf', 'EquivalentTo', 'DisjointWith',
  'SubPropertyOf', 'Domain', 'Range', 'Characteristics', 'InverseOf',
  'SubPropertyChain',
  'Types', 'Facts',
]);

function syncAxiomsManchester(doc: vscode.TextDocument, entity: OWLEntity): SyncResult | null {
  const text = doc.getText();
  const lines = text.split('\n');
  const prefixes = parsePrefixes(text, 'manchester');
  const frame = findManchesterEntityFrame(lines, entity.iri, prefixes);
  if (!frame) return null;

  // Find ranges of existing managed sections within the frame
  // Collect: [{ start, end }] sorted by start
  const managedRanges: { start: number; end: number }[] = [];
  let i = frame.start + 1;
  while (i < frame.end) {
    const secM = lines[i].match(/^\s+(Annotations|SubClassOf|EquivalentTo|DisjointWith|Domain|Range|Characteristics|InverseOf|SubPropertyOf|Types|Facts)\s*:/);
    if (secM) {
      const kw = secM[1];
      const secStart = i;
      let secEnd = i + 1;
      while (secEnd < frame.end && !SECTION_KW_RE.test(lines[secEnd])) { secEnd++; }
      if (MANAGED_SECTION_KWS.has(kw)) {
        managedRanges.push({ start: secStart, end: secEnd });
      }
      i = secEnd;
    } else {
      i++;
    }
  }

  const newSections = generateManchesterAxiomSections(entity, prefixes);

  // If nothing to delete and nothing to add, no-op
  if (managedRanges.length === 0 && newSections === '') return null;

  // Idempotency: if the existing managed section text equals the new content, skip the write.
  // trimEnd() strips trailing whitespace/empty lines that appear between the last section
  // and the next frame keyword (or EOF), which are included in managedRanges.end but not
  // in the generated output.
  if (managedRanges.length > 0 && newSections !== '') {
    const existingText = managedRanges
      .map(r => lines.slice(r.start, r.end).join('\n'))
      .join('\n');
    if (existingText.trimEnd() === newSections.trimEnd()) { return null; }
  }

  const edit = new vscode.WorkspaceEdit();
  let changedAt = frame.start + 1;

  if (managedRanges.length > 0) {
    // Replace the first managed range with new content, delete the rest
    const first = managedRanges[0];
    changedAt = first.start;
    const newContent = newSections.length > 0 ? newSections + '\n' : '';
    const startPos = doc.lineAt(first.start).range.start;
    const endPos = doc.lineAt(first.end - 1).rangeIncludingLineBreak.end;
    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newContent);

    // Delete remaining managed ranges in reverse order
    for (const r of [...managedRanges.slice(1)].reverse()) {
      const s = doc.lineAt(r.start).range.start;
      const e = doc.lineAt(r.end - 1).rangeIncludingLineBreak.end;
      edit.delete(doc.uri, new vscode.Range(s, e));
    }
  } else if (newSections.length > 0) {
    // No existing managed sections — find insertion point: after Annotations if present, else after frame header
    let insertLine = frame.start + 1;
    for (let j = frame.start + 1; j < frame.end; j++) {
      if (/^\s+Annotations\s*:/.test(lines[j])) {
        // skip to end of annotations section
        insertLine = j + 1;
        while (insertLine < frame.end && !SECTION_KW_RE.test(lines[insertLine])) { insertLine++; }
        break;
      }
    }
    changedAt = insertLine;
    edit.insert(doc.uri, new vscode.Position(insertLine, 0), newSections + '\n');
  }

  return { edit, changedRanges: changedLineRanges(changedAt, newSections ? newSections.split('\n') : []) };
}

// ── Turtle Syntax (.ttl / .n3) ────────────────────────────────────────────────

function splitTurtlePredicates(blockText: string): string[] {
  const segments: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < blockText.length; i++) {
    const ch = blockText[i];
    if (ch === '"' && blockText[i - 1] !== '\\') { inStr = !inStr; cur += ch; continue; }
    if (!inStr && ch === ';') { segments.push(cur.trim()); cur = ''; continue; }
    if (!inStr && ch === '.' && (i + 1 >= blockText.length || /\s/.test(blockText[i + 1]))) {
      const t = cur.trim(); if (t) segments.push(t); cur = ''; continue;
    }
    cur += ch;
  }
  const t = cur.trim(); if (t) segments.push(t);
  return segments.filter(Boolean);
}

function generateTurtleStructuralSegs(entity: OWLEntity, prefixes: Map<string, string>): string[] {
  const ab = (iri: string) => abbreviateIri(iri, prefixes);
  const segs: string[] = [];

  if (entity.type === 'class') {
    const cls = entity as OWLClass;
    segs.push(`rdf:type owl:Class`);
    for (const sup of cls.superClassIris) segs.push(`rdfs:subClassOf ${ab(sup)}`);
    for (const eq of cls.equivalentClassIris) segs.push(`owl:equivalentClass ${ab(eq)}`);
    for (const dj of cls.disjointClassIris) segs.push(`owl:disjointWith ${ab(dj)}`);
    // Complex expressions (superClassExpressions, equivalentClassExpressions) require blank nodes — skip for Turtle
  } else if (entity.type === 'objectProperty') {
    const prop = entity as OWLObjectProperty;
    // Build rdf:type values
    const types = ['owl:ObjectProperty'];
    if (prop.isTransitive)        types.push('owl:TransitiveProperty');
    if (prop.isSymmetric)         types.push('owl:SymmetricProperty');
    if (prop.isFunctional)        types.push('owl:FunctionalProperty');
    if (prop.isInverseFunctional) types.push('owl:InverseFunctionalProperty');
    if (prop.isReflexive)         types.push('owl:ReflexiveProperty');
    if (prop.isIrreflexive)       types.push('owl:IrreflexiveProperty');
    if (prop.isAsymmetric)        types.push('owl:AsymmetricProperty');
    segs.push(`rdf:type ${types.join(' , ')}`);
    for (const sup of prop.superPropertyIris) segs.push(`rdfs:subPropertyOf ${ab(sup)}`);
    for (const dom of prop.domainIris) segs.push(`rdfs:domain ${ab(dom)}`);
    for (const rng of prop.rangeIris) segs.push(`rdfs:range ${ab(rng)}`);
    if (prop.inverseOfIri) segs.push(`owl:inverseOf ${ab(prop.inverseOfIri)}`);
    for (const eq of (prop.equivalentPropertyIris ?? [])) segs.push(`owl:equivalentProperty ${ab(eq)}`);
    for (const disj of (prop.disjointPropertyIris ?? [])) segs.push(`owl:propertyDisjointWith ${ab(disj)}`);
    for (const chain of (prop.propertyChains ?? []))
      segs.push(`owl:propertyChainAxiom ( ${chain.map(ab).join(' ')} )`);
  } else if (entity.type === 'dataProperty') {
    const prop = entity as OWLDataProperty;
    const types = ['owl:DatatypeProperty'];
    if (prop.isFunctional) types.push('owl:FunctionalProperty');
    segs.push(`rdf:type ${types.join(' , ')}`);
    for (const sup of prop.superPropertyIris) segs.push(`rdfs:subPropertyOf ${ab(sup)}`);
    for (const dom of prop.domainIris) segs.push(`rdfs:domain ${ab(dom)}`);
    for (const rng of prop.rangeIris) segs.push(`rdfs:range ${ab(rng)}`);
  } else if (entity.type === 'annotationProperty') {
    const prop = entity as OWLAnnotationProperty;
    segs.push(`rdf:type owl:AnnotationProperty`);
    for (const sup of prop.superPropertyIris) segs.push(`rdfs:subPropertyOf ${ab(sup)}`);
    for (const dom of prop.domainIris) segs.push(`rdfs:domain ${ab(dom)}`);
    for (const rng of prop.rangeIris) segs.push(`rdfs:range ${ab(rng)}`);
  } else if (entity.type === 'individual') {
    const ind = entity as OWLIndividual;
    const types = ['owl:NamedIndividual', ...ind.classIris.map(ab)];
    segs.push(`rdf:type ${types.join(' , ')}`);
    for (const opa of ind.objectPropertyAssertions) {
      segs.push(`${ab(opa.propertyIri)} ${ab(opa.targetIri)}`);
    }
    for (const dpa of ind.dataPropertyAssertions) {
      segs.push(`${ab(dpa.propertyIri)} ${fmtDataLiteralTurtle(dpa.value, dpa.datatype, prefixes)}`);
    }
  }

  return segs;
}

function fmtDataLiteralTurtle(value: string, datatype: string | undefined, prefixes: Map<string, string>): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  if (datatype) {
    return `"${esc}"^^${abbreviateIri(datatype, prefixes)}`;
  }
  return `"${esc}"`;
}

function syncAxiomsTurtle(doc: vscode.TextDocument, entity: OWLEntity): SyncResult | null {
  const text = doc.getText();
  const lines = text.split('\n');
  const prefixes = parsePrefixes(text, 'turtle');

  const entityFull = `<${entity.iri}>`;
  const entityAbbrev = abbreviateIri(entity.iri, prefixes);
  const entityTokens = [entityFull, entityAbbrev].filter((v, i, a) => a.indexOf(v) === i);
  const subjectRe = new RegExp(
    `^(${entityTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s`,
  );

  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (subjectRe.test(lines[i])) { blockStart = i; break; }
  }
  if (blockStart < 0) return null;

  let blockEnd = blockStart;
  while (blockEnd < lines.length) {
    if (lines[blockEnd].trim().endsWith('.')) { blockEnd++; break; }
    blockEnd++;
  }

  const blockText = lines.slice(blockStart, blockEnd).join('\n');
  const segments = splitTurtlePredicates(blockText);
  if (segments.length === 0) return null;

  // Extract subject token and first predicate-object segment from first block segment
  const firstSeg = segments[0];
  const subjectMatch = firstSeg.match(subjectRe);
  const subjectToken = subjectMatch ? subjectMatch[0].trim() : entityAbbrev;
  const firstPredSeg = subjectMatch ? firstSeg.slice(subjectMatch[0].length).trim() : firstSeg;

  // Structural segments are always regenerated from the model (authoritative).
  const newStructSegs = generateTurtleStructuralSegs(entity, prefixes);

  // Extract existing annotation segments from the file block in file order and key them.
  // This preserves the on-disk annotation order for unchanged annotations.
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
        existingAnnotSegs.push({ seg, key: `${predIri}|${rawText}|${lang ?? ''}` });
      }
    }
  }
  const fileAnnotKeySet = new Set(existingAnnotSegs.map(x => x.key));

  // Model annotation segments with their canonical keys.
  const modelAnnotSegs = entityAnnotationSegs(entity, prefixes).map(seg => {
    const pred = seg.split(/\s+/)[0];
    const predIri = resolveIri(pred, prefixes);
    const litMatch = seg.match(/"((?:[^"\\]|\\.)*)"\s*(?:@([A-Za-z][A-Za-z0-9-]*))?/);
    if (!litMatch) { return null; }
    const rawText = litMatch[1]
      .replace(/\\n/g, '\n').replace(/\\r/g, '\r')
      .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const lang = litMatch[2] || undefined;
    return { seg, key: `${predIri}|${rawText}|${lang ?? ''}` };
  }).filter((x): x is { seg: string; key: string } => x !== null);
  const modelAnnotKeySet = new Set(modelAnnotSegs.map(x => x.key));

  // Diff: kept annotations in file order, new annotations appended.
  const keptAnnot = existingAnnotSegs.filter(x => modelAnnotKeySet.has(x.key));
  const toAddAnnot = modelAnnotSegs.filter(x => !fileAnnotKeySet.has(x.key));

  const allSegs = [...newStructSegs, ...keptAnnot.map(x => x.seg), ...toAddAnnot.map(x => x.seg)];
  if (allSegs.length === 0) return null;

  // Detect continuation indent from the existing block; fall back to 4 spaces.
  const existingIndent = (() => {
    for (let i = blockStart + 1; i < blockEnd; i++) {
      const m = lines[i].match(/^(\s+)/);
      if (m) { return m[1]; }
    }
    return '    ';
  })();

  const rebuiltLines: string[] = [];
  rebuiltLines.push(`${subjectToken} ${allSegs[0]}${allSegs.length === 1 ? ' .' : ' ;'}`);
  for (let i = 1; i < allSegs.length; i++) {
    rebuiltLines.push(`${existingIndent}${allSegs[i]}${i === allSegs.length - 1 ? ' .' : ' ;'}`);
  }

  // Idempotency: skip write if rebuilt block matches existing block exactly.
  const existingBlock = lines.slice(blockStart, blockEnd).join('\n');
  if (rebuiltLines.join('\n') === existingBlock) { return null; }

  const edit = new vscode.WorkspaceEdit();
  const replaceStart = doc.lineAt(blockStart).range.start;
  const replaceEnd = doc.lineAt(blockEnd - 1).rangeIncludingLineBreak.end;
  edit.replace(doc.uri, new vscode.Range(replaceStart, replaceEnd), rebuiltLines.join('\n') + '\n');
  return { edit, changedRanges: changedLineRanges(blockStart, rebuiltLines) };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function syncAxiomsToDocument(
  uri: vscode.Uri,
  entity: OWLEntity,
  sourceFormat?: string,
  rawContent?: string,
  segment?: EntitySegment,
  gciSegment?: EntitySegment,
  closingParenLine?: number,
  gciInsertLine?: number,
  skipWrite = false,
  positionHints?: { gcis: Map<string, number>; regAxioms: Map<string, number> },
): Promise<{ changedRanges: vscode.Range[]; updatedText: string; lineDelta: number; editSummaries: EditSummary[]; deletedGciPositions?: Map<string, number>; deletedRegAxiomPositions?: Map<string, number> } | null> {
  if (temporaryClassIris.has(entity.iri)) { return null; }
  const fmt = sourceFormat ?? extensionFormat(uri.fsPath.toLowerCase());
  if (!fmt) { return null; }

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
    result = syncAxiomsFunctional(doc, entity, segment, gciSegment, closingParenLine, gciInsertLine, positionHints);
  } else if (fmt === 'manchester') {
    result = syncAxiomsManchester(doc, entity);
  } else if (fmt === 'turtle') {
    result = syncAxiomsTurtle(doc, entity);
  }

  if (!result) { return null; }

  const hint = segment ? { startLine: segment.startLine, startChar: segment.startChar } : undefined;
  const offsetEdits: OffsetEdit[] = [];
  const updatedText = applyWorkspaceEditsToText(text, result.edit, hint, offsetEdits);
  const gciLines = result.gciEditLines ?? new Set<number>();
  const editSummaries: EditSummary[] = offsetEdits.map(o => ({
    ...o,
    segmentMap: gciLines.has(o.oldStartLine) ? ('gci' as const) : ('entity' as const),
  }));
  if (!skipWrite) {
    const uriKey = uri.toString();
    beginSyncWrite(uriKey);
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedText));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fname = uri.fsPath.split(/[\\/]/).pop() ?? '';
      console.error(`[OntoGraph syncAxioms] writeFile FAILED: ${msg}`);
      void vscode.window.showErrorMessage(`OntoGraph: cannot write '${fname}' — ${msg}.`);
      return null;
    } finally {
      endSyncWrite(uriKey);
    }
  }

  return {
    changedRanges: result.changedRanges,
    updatedText,
    lineDelta: countLineDelta(result.edit),
    editSummaries,
    deletedGciPositions: result.deletedGciPositions,
    deletedRegAxiomPositions: result.deletedRegAxiomPositions,
  };
}

function extensionFormat(fsPath: string): string | undefined {
  if (fsPath.endsWith('.ofn') || fsPath.endsWith('.owf')) return 'functional';
  if (fsPath.endsWith('.omn')) return 'manchester';
  if (fsPath.endsWith('.ttl') || fsPath.endsWith('.n3')) return 'turtle';
  return undefined;
}
