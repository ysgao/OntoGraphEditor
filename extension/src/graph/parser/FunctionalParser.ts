import {
  createEmptyModel, OntologyModel,
  OWLClass, OWLObjectProperty, OWLDataProperty, OWLAnnotationProperty, OWLIndividual,
} from '../model/OntologyModel';
import { manchesterToFunctional } from '../utils/ExpressionUtils';

const BUILTIN_PREFIXES: [string, string][] = [
  ['owl:', 'http://www.w3.org/2002/07/owl#'],
  ['rdf:', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs:', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd:', 'http://www.w3.org/2001/XMLSchema#'],
  ['xml:', 'http://www.w3.org/XML/1998/namespace'],
];
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

// ── Tokenizer ────────────────────────────────────────────────────────────────

interface Tok {
  type: 'IRI' | 'STRING' | 'LPAREN' | 'RPAREN' | 'WORD' | 'INT';
  value: string;
  lang?: string;
  datatype?: string;
}

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (ch <= ' ') { i++; continue; }
    if (ch === '#') { while (i < n && text[i] !== '\n') i++; continue; }
    if (ch === '(') { toks.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (ch === ')') { toks.push({ type: 'RPAREN', value: ')' }); i++; continue; }

    if (ch === '<') {
      const s = ++i;
      while (i < n && text[i] !== '>') i++;
      toks.push({ type: 'IRI', value: text.slice(s, i++) });
      continue;
    }

    if (ch === '"') {
      i++;
      const s = i;
      while (i < n) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') { i++; break; }
        i++;
      }
      const raw = text.slice(s, i - 1)
        .replace(/\\"/g, '"').replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
      let lang: string | undefined;
      let datatype: string | undefined;
      if (i < n && text[i] === '@') {
        const ls = ++i;
        while (i < n && /[A-Za-z0-9\-]/.test(text[i])) i++;
        lang = text.slice(ls, i);
      } else if (i + 1 < n && text[i] === '^' && text[i + 1] === '^') {
        i += 2;
        if (i < n && text[i] === '<') {
          const ds = ++i;
          while (i < n && text[i] !== '>') i++;
          datatype = text.slice(ds, i++);
        } else {
          const ds = i;
          while (i < n && text[i] > ' ' && text[i] !== ')') i++;
          datatype = text.slice(ds, i);
        }
      }
      toks.push({ type: 'STRING', value: raw, lang, datatype });
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const s = i;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      toks.push({ type: 'INT', value: text.slice(s, i) });
      continue;
    }

    const s = i;
    while (i < n && text[i] > ' ' && text[i] !== '(' && text[i] !== ')' && text[i] !== '<' && text[i] !== '"') i++;
    if (i > s) toks.push({ type: 'WORD', value: text.slice(s, i) });
  }
  return toks;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export class FunctionalParser {
  private toks: Tok[];
  private pos = 0;
  private prefixes = new Map<string, string>(BUILTIN_PREFIXES);
  private model: OntologyModel;
  private lastStringLang: string | undefined;

  // O(1) dedup sets, keyed by entity IRI — avoid O(n) .includes() on arrays
  private readonly _superClassSets = new Map<string, Set<string>>();
  private readonly _equivalentClassSets = new Map<string, Set<string>>();
  private readonly _disjointClassSets = new Map<string, Set<string>>();
  private readonly _superPropertySets = new Map<string, Set<string>>();
  private readonly _domainSets = new Map<string, Set<string>>();
  private readonly _rangeSets = new Map<string, Set<string>>();
  private readonly _classIriSets = new Map<string, Set<string>>();

  private addUnique(map: Map<string, Set<string>>, key: string, value: string): boolean {
    let set = map.get(key);
    if (!set) { set = new Set<string>(); map.set(key, set); }
    if (set.has(value)) { return false; }
    set.add(value);
    return true;
  }

  constructor(text: string, sourceUri: string) {
    this.toks = tokenize(text);
    this.model = createEmptyModel(sourceUri);
  }

  parse(): OntologyModel {
    while (this.pos < this.toks.length) {
      const t = this.peek();
      if (!t) break;
      if (t.type === 'WORD' && t.value === 'Prefix') this.parsePrefixDecl();
      else if (t.type === 'WORD' && t.value === 'Ontology') this.parseOntology();
      else this.advance();
    }
    return this.model;
  }

  // ── Prefix( name= IRI ) ─────────────────────────────────────────────────────
  private parsePrefixDecl(): void {
    this.advance(); // Prefix
    this.expectLParen();
    // name token: ":=" or "dc11:=" (= may be separate if whitespace)
    let prefixKey = '';
    while (this.peek() && this.peek()!.type !== 'IRI') {
      const t = this.advance();
      if (t.value !== '=') prefixKey += t.value;
    }
    // prefixKey is now e.g. "dc11:" or ":"  (the trailing = was stripped)
    // Strip any stray = that merged
    prefixKey = prefixKey.replace(/=\s*$/, '');
    const iriTok = this.advance();
    if (iriTok.type === 'IRI') this.prefixes.set(prefixKey, iriTok.value);
    this.expectRParen();
  }

  // ── Ontology( [IRI [versionIRI]] axiom* ) ──────────────────────────────────
  private parseOntology(): void {
    this.advance(); // Ontology
    this.expectLParen();
    if (this.peek()?.type === 'IRI') this.model.metadata.iri = this.advance().value;
    if (this.peek()?.type === 'IRI') this.model.metadata.versionIri = this.advance().value;
    while (this.pos < this.toks.length && this.peek()?.type !== 'RPAREN') {
      this.parseAxiom();
    }
    this.expectRParen();
  }

  // ── Dispatch one axiom ──────────────────────────────────────────────────────
  private parseAxiom(): void {
    const t = this.peek();
    if (!t || t.type !== 'WORD') { this.advance(); return; }
    switch (t.value) {
      case 'Annotation':                     return this.parseOntologyAnnotation();
      case 'Import':                         return this.parseImport();
      case 'Declaration':                    return this.parseDeclaration();
      case 'SubClassOf':                     return this.parseSubClassOf();
      case 'EquivalentClasses':              return this.parseEquivalentClasses();
      case 'DisjointClasses':               return this.parseDisjointClasses();
      case 'DisjointUnion':                  return this.parseDisjointUnion();
      case 'AnnotationAssertion':            return this.parseAnnotationAssertion();
      case 'SubObjectPropertyOf':            return this.parseSubObjectPropertyOf();
      case 'SubDataPropertyOf':             return this.parseSubDataPropertyOf();
      case 'SubAnnotationPropertyOf':        return this.parseSubAnnotationPropertyOf();
      case 'ObjectPropertyDomain':          return this.parseObjectPropertyDomain();
      case 'ObjectPropertyRange':           return this.parseObjectPropertyRange();
      case 'DataPropertyDomain':            return this.parseDataPropertyDomain();
      case 'DataPropertyRange':             return this.skipFullBlock();
      case 'FunctionalObjectProperty':       return this.parsePropCharacteristic('objectProperty', 'isFunctional');
      case 'InverseFunctionalObjectProperty':return this.parsePropCharacteristic('objectProperty', 'isInverseFunctional');
      case 'TransitiveObjectProperty':       return this.parsePropCharacteristic('objectProperty', 'isTransitive');
      case 'SymmetricObjectProperty':        return this.parsePropCharacteristic('objectProperty', 'isSymmetric');
      case 'FunctionalDataProperty':         return this.parsePropCharacteristic('dataProperty', 'isFunctional');
      case 'InverseObjectProperties':        return this.parseInverseObjectProperties();
      case 'EquivalentObjectProperties':     return this.parseEquivalentOrDisjointObjectProperties('equivalentPropertyIris');
      case 'DisjointObjectProperties':       return this.parseEquivalentOrDisjointObjectProperties('disjointPropertyIris');
      case 'EquivalentDataProperties':
      case 'DisjointDataProperties':         return this.skipFullBlock();
      case 'ClassAssertion':                 return this.parseClassAssertion();
      case 'ObjectPropertyAssertion':        return this.parseObjectPropertyAssertion();
      case 'NegativeObjectPropertyAssertion':return this.skipFullBlock();
      case 'DataPropertyAssertion':          return this.parseDataPropertyAssertion();
      case 'NegativeDataPropertyAssertion':  return this.skipFullBlock();
      case 'SameIndividual':
      case 'DifferentIndividuals':
      case 'HasKey':
      case 'DatatypeDefinition':
      case 'SWRL':                           return this.skipFullBlock();
      case 'ReflexiveObjectProperty':        return this.parsePropCharacteristic('objectProperty', 'isReflexive');
      case 'IrreflexiveObjectProperty':      return this.parsePropCharacteristic('objectProperty', 'isIrreflexive');
      case 'AsymmetricObjectProperty':       return this.parsePropCharacteristic('objectProperty', 'isAsymmetric');
      default:                               return this.skipFullBlock();
    }
  }

  // ── Individual axiom parsers ─────────────────────────────────────────────────

  private parseOntologyAnnotation(): void {
    this.advance(); // Annotation
    this.expectLParen();
    this.skipAxiomAnnotations();
    const pa = this.readIri();
    const val = this.readAnnotationValue();
    this.expectRParen();
    const arr = this.model.metadata.annotations[pa] ?? [];
    arr.push(val); this.model.metadata.annotations[pa] = arr;
  }

  private parseImport(): void {
    this.advance(); this.expectLParen();
    this.model.metadata.imports.push(this.readIri());
    this.expectRParen();
  }

  private parseDeclaration(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const entityKw = this.advance().value;
    this.expectLParen();
    const iri = this.readIri();
    this.expectRParen(); this.expectRParen();
    switch (entityKw) {
      case 'Class':               this.getOrCreateClass(iri); break;
      case 'ObjectProperty':      this.getOrCreateObjectProp(iri); break;
      case 'DataProperty':        this.getOrCreateDataProp(iri); break;
      case 'AnnotationProperty':  this.getOrCreateAnnotationProp(iri); break;
      case 'NamedIndividual':     this.getOrCreateIndividual(iri); break;
    }
  }

  private parseSubClassOf(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const subExpr = this.readClassExpression();
    const supExpr = this.readClassExpression();
    this.expectRParen();
    const subIri = this.asIri(subExpr);
    const supIri = this.asIri(supExpr);

    if (subIri) {
      const cls = this.getOrCreateClass(subIri);
      if (supIri) {
        if (this.addUnique(this._superClassSets, subIri, supIri)) cls.superClassIris.push(supIri);
      } else {
        cls.superClassExpressions.push(supExpr);
      }
    } else if (supIri) {
      // GCI: complex left-hand side — attach to the right-hand named class
      const cls = this.getOrCreateClass(supIri);
      cls.gciExpressions.push(subExpr);
    } else {
      // GCI: both sides complex — store as a complete functional syntax string
      const subFS = manchesterToFunctional(subExpr);
      const supFS = manchesterToFunctional(supExpr);
      if (subFS && supFS) {
        this.model.standaloneGcis.push(`SubClassOf(${subFS} ${supFS})`);
      }
    }
  }

  private parseEquivalentClasses(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const exprs: string[] = [];
    while (this.peek()?.type !== 'RPAREN') exprs.push(this.readClassExpression());
    this.expectRParen();
    for (let i = 0; i < exprs.length; i++) {
      const iri = this.asIri(exprs[i]); if (!iri) continue;
      const cls = this.getOrCreateClass(iri);
      for (let j = 0; j < exprs.length; j++) {
        if (i === j) continue;
        const otherIri = this.asIri(exprs[j]);
        if (otherIri) { if (this.addUnique(this._equivalentClassSets, iri, otherIri)) cls.equivalentClassIris.push(otherIri); }
        else cls.equivalentClassExpressions.push(exprs[j]);
      }
    }
  }

  private parseDisjointClasses(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const iris: string[] = [];
    while (this.peek()?.type !== 'RPAREN') {
      const iri = this.asIri(this.readClassExpression());
      if (iri) iris.push(iri);
    }
    this.expectRParen();
    for (const iri of iris) {
      const cls = this.getOrCreateClass(iri);
      for (const other of iris) {
        if (other !== iri && this.addUnique(this._disjointClassSets, iri, other)) cls.disjointClassIris.push(other);
      }
    }
  }

  private parseDisjointUnion(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const classIri = this.readIri(); // the defined class
    const members: string[] = [];
    while (this.peek()?.type !== 'RPAREN') {
      const iri = this.asIri(this.readClassExpression());
      if (iri) members.push(iri);
    }
    this.expectRParen();
    const cls = this.getOrCreateClass(classIri);
    for (const m of members) if (this.addUnique(this._disjointClassSets, classIri, m)) cls.disjointClassIris.push(m);
  }

  private parseAnnotationAssertion(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const pa = this.readIri();
    const subject = this.readIri();
    const val = this.readAnnotationValue();
    this.expectRParen();

    // Ensure the annotation property is registered even if never explicitly declared
    this.getOrCreateAnnotationProp(pa);

    // subject must already be declared; if not, skip
    const entity =
      this.model.classes.get(subject) ??
      this.model.objectProperties.get(subject) ??
      this.model.dataProperties.get(subject) ??
      this.model.annotationProperties.get(subject) ??
      this.model.individuals.get(subject);
    if (!entity) return;

    if (pa === RDFS_LABEL) {
      const lang = this.lastStringLang ?? '';
      const arr = entity.labels[lang] ?? [];
      arr.push(val); entity.labels[lang] = arr;
    } else {
      const arr = entity.annotations[pa] ?? [];
      arr.push(this.lastStringLang ? `${val}@${this.lastStringLang}` : val);
      entity.annotations[pa] = arr;
    }
  }

  private parseSubObjectPropertyOf(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    if (this.peek()?.value === 'ObjectPropertyChain') {
      this.advance(); this.expectLParen();
      const chainMembers: string[] = [];
      while (this.peek()?.type !== 'RPAREN' && this.peek()) chainMembers.push(this.readIri());
      this.expectRParen();
      const sup = this.readIri();
      this.expectRParen();
      const p = this.getOrCreateObjectProp(sup);
      if (!p.propertyChains) p.propertyChains = [];
      p.propertyChains.push(chainMembers);
      return;
    }
    const sub = this.readIri(); const sup = this.readIri();
    this.expectRParen();
    const p = this.getOrCreateObjectProp(sub);
    if (this.addUnique(this._superPropertySets, sub, sup)) p.superPropertyIris.push(sup);
  }

  private parseEquivalentOrDisjointObjectProperties(field: 'equivalentPropertyIris' | 'disjointPropertyIris'): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const iris: string[] = [];
    while (this.peek()?.type !== 'RPAREN' && this.peek()) iris.push(this.readIri());
    this.expectRParen();
    for (let i = 0; i < iris.length; i++) {
      const p = this.getOrCreateObjectProp(iris[i]);
      if (!p[field]) p[field] = [];
      for (let j = 0; j < iris.length; j++) {
        if (i !== j && !p[field]!.includes(iris[j])) p[field]!.push(iris[j]);
      }
    }
  }

  private parseSubDataPropertyOf(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const sub = this.readIri(); const sup = this.readIri();
    this.expectRParen();
    const p = this.getOrCreateDataProp(sub);
    if (this.addUnique(this._superPropertySets, sub, sup)) p.superPropertyIris.push(sup);
  }

  private parseSubAnnotationPropertyOf(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const sub = this.readIri(); const sup = this.readIri();
    this.expectRParen();
    const p = this.getOrCreateAnnotationProp(sub);
    if (this.addUnique(this._superPropertySets, sub, sup)) p.superPropertyIris.push(sup);
  }

  private parseObjectPropertyDomain(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const propIri = this.readIri();
    const domExpr = this.readClassExpression();
    this.expectRParen();
    const p = this.getOrCreateObjectProp(propIri);
    const domIri = this.asIri(domExpr);
    if (domIri && this.addUnique(this._domainSets, propIri, domIri)) p.domainIris.push(domIri);
  }

  private parseObjectPropertyRange(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const propIri = this.readIri();
    const rangeExpr = this.readClassExpression();
    this.expectRParen();
    const p = this.getOrCreateObjectProp(propIri);
    const rangeIri = this.asIri(rangeExpr);
    if (rangeIri && this.addUnique(this._rangeSets, propIri, rangeIri)) p.rangeIris.push(rangeIri);
  }

  private parseDataPropertyDomain(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const propIri = this.readIri();
    const domExpr = this.readClassExpression();
    this.expectRParen();
    const p = this.getOrCreateDataProp(propIri);
    const domIri = this.asIri(domExpr);
    if (domIri && this.addUnique(this._domainSets, propIri, domIri)) p.domainIris.push(domIri);
  }

  private parsePropCharacteristic(kind: 'objectProperty' | 'dataProperty', flag: string): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const iri = this.readIri();
    this.expectRParen();
    const p = kind === 'objectProperty' ? this.getOrCreateObjectProp(iri) : this.getOrCreateDataProp(iri);
    (p as unknown as Record<string, unknown>)[flag] = true;
  }

  private parseInverseObjectProperties(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const p1 = this.readIri(); const p2 = this.readIri();
    this.expectRParen();
    const prop1 = this.getOrCreateObjectProp(p1);
    const prop2 = this.getOrCreateObjectProp(p2);
    prop1.inverseOfIri = p2; prop2.inverseOfIri = p1;
  }

  private parseClassAssertion(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const classExpr = this.readClassExpression();
    const indIri = this.readIri();
    this.expectRParen();
    const ind = this.getOrCreateIndividual(indIri);
    const classIri = this.asIri(classExpr);
    if (classIri && this.addUnique(this._classIriSets, indIri, classIri)) ind.classIris.push(classIri);
  }

  private parseObjectPropertyAssertion(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const prop = this.readIri(); const src = this.readIri(); const tgt = this.readIri();
    this.expectRParen();
    this.getOrCreateIndividual(src).objectPropertyAssertions.push({ propertyIri: prop, targetIri: tgt });
  }

  private parseDataPropertyAssertion(): void {
    this.advance(); this.expectLParen();
    this.skipAxiomAnnotations();
    const prop = this.readIri(); const src = this.readIri();
    const valTok = this.advance();
    const dt = valTok.datatype;
    this.expectRParen();
    this.getOrCreateIndividual(src).dataPropertyAssertions.push({ propertyIri: prop, value: valTok.value, datatype: dt });
  }

  // ── Class expression → string (Manchester-like) ─────────────────────────────

  private readClassExpression(): string {
    const t = this.peek();
    if (!t) return '';
    if (t.type === 'IRI') return this.advance().value;
    if (t.type === 'WORD') {
      // Could be a prefixed name (e.g. owl:Thing) or an OWL keyword
      switch (t.value) {
        case 'ObjectIntersectionOf': return this.readNAry('and');
        case 'ObjectUnionOf':        return this.readNAry('or');
        case 'ObjectComplementOf':   { this.advance(); this.expectLParen(); const i = this.readClassExpression(); this.expectRParen(); return `not (${i})`; }
        case 'ObjectSomeValuesFrom': return this.readBinary('some');
        case 'ObjectAllValuesFrom':  return this.readBinary('only');
        case 'ObjectHasValue':       return this.readBinary('value');
        case 'ObjectHasSelf':        { this.advance(); this.expectLParen(); const p = this.readIri(); this.expectRParen(); return `${p} Self`; }
        case 'ObjectMinCardinality': return this.readCardinality('min');
        case 'ObjectMaxCardinality': return this.readCardinality('max');
        case 'ObjectExactCardinality':return this.readCardinality('exactly');
        case 'ObjectOneOf':          return this.readObjectOneOf();
        case 'DataSomeValuesFrom':
        case 'DataAllValuesFrom':
        case 'DataHasValue':
        case 'DataMinCardinality':
        case 'DataMaxCardinality':
        case 'DataExactCardinality':
        case 'DataIntersectionOf':
        case 'DataUnionOf':
        case 'DataComplementOf':
        case 'DataOneOf':
        case 'DatatypeRestriction':  { this.advance(); this.skipNestedBlock(); return '[data]'; }
        default: {
          const iri = this.expandWord(this.advance().value);
          return iri;
        }
      }
    }
    return this.advance().value;
  }

  private readNAry(op: string): string {
    this.advance(); this.expectLParen();
    const parts: string[] = [];
    while (this.peek()?.type !== 'RPAREN') parts.push(this.readClassExpression());
    this.expectRParen();
    return parts.join(` ${op} `);
  }

  private readBinary(op: string): string {
    this.advance(); this.expectLParen();
    const prop = this.readIri();
    const filler = this.readClassExpression();
    this.expectRParen();
    return `${prop} ${op} ${filler}`;
  }

  private readCardinality(op: string): string {
    this.advance(); this.expectLParen();
    const n = this.advance().value;
    const prop = this.readIri();
    let filler = '';
    if (this.peek()?.type !== 'RPAREN') filler = ' ' + this.readClassExpression();
    this.expectRParen();
    return `${prop} ${op} ${n}${filler}`;
  }

  private readObjectOneOf(): string {
    this.advance(); this.expectLParen();
    const iris: string[] = [];
    while (this.peek()?.type !== 'RPAREN') iris.push(this.readIri());
    this.expectRParen();
    return `{${iris.join(', ')}}`;
  }

  // ── IRI & annotation value readers ─────────────────────────────────────────

  private readIri(): string {
    const t = this.advance();
    if (t.type === 'IRI') return t.value;
    if (t.type === 'WORD') return this.expandWord(t.value);
    return t.value;
  }

  private readAnnotationValue(): string {
    this.lastStringLang = undefined;
    const t = this.peek();
    if (!t) return '';
    if (t.type === 'IRI') return this.advance().value;
    if (t.type === 'STRING') {
      const st = this.advance();
      this.lastStringLang = st.lang;
      return st.value;
    }
    if (t.type === 'WORD') return this.expandWord(this.advance().value);
    return this.advance().value;
  }

  private expandWord(word: string): string {
    const colon = word.indexOf(':');
    if (colon < 0) return word;
    const prefix = word.slice(0, colon + 1);
    const local = word.slice(colon + 1);
    const base = this.prefixes.get(prefix);
    return base !== undefined ? base + local : word;
  }

  /** Return the string as a named class IRI only if it is a bare IRI with no spaces. */
  private asIri(expr: string): string | null {
    if (expr.includes(' ') || expr.includes('(')) return null; // complex expression
    return /^(https?:|urn:|file:)/.test(expr) ? expr : null;
  }

  // ── Skip helpers ────────────────────────────────────────────────────────────

  private skipAxiomAnnotations(): void {
    while (this.peek()?.type === 'WORD' && this.peek()?.value === 'Annotation') {
      this.advance(); // Annotation keyword
      this.skipNestedBlock(); // (...)
    }
  }

  /** Skip one parenthesized block starting at the current LPAREN */
  private skipNestedBlock(): void {
    if (this.peek()?.type !== 'LPAREN') return;
    this.advance(); // (
    let depth = 1;
    while (this.pos < this.toks.length && depth > 0) {
      const t = this.advance();
      if (t.type === 'LPAREN') depth++;
      else if (t.type === 'RPAREN') depth--;
    }
  }

  /** Skip entire keyword(...) block including the keyword itself */
  private skipFullBlock(): void {
    this.advance(); // keyword
    this.skipNestedBlock();
  }

  // ── Low-level helpers ───────────────────────────────────────────────────────

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private advance(): Tok { return this.toks[this.pos++] ?? { type: 'WORD', value: '' }; }
  private expectLParen(): void { if (this.peek()?.type === 'LPAREN') this.advance(); }
  private expectRParen(): void { if (this.peek()?.type === 'RPAREN') this.advance(); }

  // ── Entity factory methods ──────────────────────────────────────────────────

  private getOrCreateClass(iri: string): OWLClass {
    let e = this.model.classes.get(iri);
    if (!e) {
      e = { iri, type: 'class', labels: {}, annotations: {},
        superClassIris: [], equivalentClassIris: [], disjointClassIris: [],
        superClassExpressions: [], equivalentClassExpressions: [], gciExpressions: [] };
      this.model.classes.set(iri, e);
    }
    return e;
  }

  private getOrCreateObjectProp(iri: string): OWLObjectProperty {
    let e = this.model.objectProperties.get(iri);
    if (!e) {
      e = { iri, type: 'objectProperty', labels: {}, annotations: {},
        superPropertyIris: [], domainIris: [], rangeIris: [] };
      this.model.objectProperties.set(iri, e);
    }
    return e;
  }

  private getOrCreateDataProp(iri: string): OWLDataProperty {
    let e = this.model.dataProperties.get(iri);
    if (!e) {
      e = { iri, type: 'dataProperty', labels: {}, annotations: {},
        superPropertyIris: [], domainIris: [], rangeIris: [] };
      this.model.dataProperties.set(iri, e);
    }
    return e;
  }

  private getOrCreateAnnotationProp(iri: string): OWLAnnotationProperty {
    let e = this.model.annotationProperties.get(iri);
    if (!e) {
      e = { iri, type: 'annotationProperty', labels: {}, annotations: {},
        superPropertyIris: [], domainIris: [], rangeIris: [] };
      this.model.annotationProperties.set(iri, e);
    }
    return e;
  }

  private getOrCreateIndividual(iri: string): OWLIndividual {
    let e = this.model.individuals.get(iri);
    if (!e) {
      e = { iri, type: 'individual', labels: {}, annotations: {},
        classIris: [], objectPropertyAssertions: [], dataPropertyAssertions: [] };
      this.model.individuals.set(iri, e);
    }
    return e;
  }
}
