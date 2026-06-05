import * as N3 from 'n3';
import type { OntologyModel } from '../model/OntologyModel';

const { Store, DataFactory } = N3;
const { namedNode, literal, quad } = DataFactory;

const RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL  = 'http://www.w3.org/2002/07/owl#';
const XSD  = 'http://www.w3.org/2001/XMLSchema#';

export interface QueryResult {
  columns: string[];
  rows: Record<string, string>[];
  elapsed: number;
  total: number;
}

type Binding = Record<string, N3.Term>;

function termToString(term: N3.Term): string {
  if (term.termType === 'NamedNode') {
    return `<${term.value}>`;
  }
  if (term.termType === 'Literal') {
    const lit = term as N3.Literal;
    if (lit.language) {
      return `"${lit.value}"@${lit.language}`;
    }
    if (lit.datatype && lit.datatype.value !== `${XSD}string`) {
      return `"${lit.value}"^^<${lit.datatype.value}>`;
    }
    return lit.value;
  }
  if (term.termType === 'BlankNode') {
    return `_:${term.value}`;
  }
  return term.value;
}

export class SparqlExecutor {
  private store: N3.Store;

  constructor(model: OntologyModel) {
    this.store = new Store();
    this.buildStore(model);
  }

  private add(s: string, p: string, o: N3.NamedNode | N3.Literal | N3.BlankNode): void {
    this.store.add(quad(namedNode(s), namedNode(p), o));
  }

  private addN(s: string, p: string, o: string): void {
    this.store.add(quad(namedNode(s), namedNode(p), namedNode(o)));
  }

  private addL(s: string, p: string, value: string, langOrDt?: string, isDt = false): void {
    let lit: N3.Literal;
    if (isDt && langOrDt) {
      lit = literal(value, namedNode(langOrDt));
    } else if (!isDt && langOrDt) {
      lit = literal(value, langOrDt);
    } else {
      lit = literal(value);
    }
    this.store.add(quad(namedNode(s), namedNode(p), lit));
  }

  private buildStore(model: OntologyModel): void {
    // Classes
    for (const cls of model.classes.values()) {
      this.addN(cls.iri, `${RDF}type`, `${OWL}Class`);
      for (const sup of cls.superClassIris) {
        this.addN(cls.iri, `${RDFS}subClassOf`, sup);
      }
      for (const eq of cls.equivalentClassIris) {
        this.addN(cls.iri, `${OWL}equivalentClass`, eq);
      }
      for (const dis of cls.disjointClassIris) {
        this.addN(cls.iri, `${OWL}disjointWith`, dis);
      }
      this.addLabels(cls.iri, cls.labels);
      this.addAnnotations(cls.iri, cls.annotations);
    }

    // Object properties
    for (const prop of model.objectProperties.values()) {
      this.addN(prop.iri, `${RDF}type`, `${OWL}ObjectProperty`);
      for (const sup of prop.superPropertyIris) {
        this.addN(prop.iri, `${RDFS}subPropertyOf`, sup);
      }
      for (const dom of prop.domainIris) {
        this.addN(prop.iri, `${RDFS}domain`, dom);
      }
      for (const rng of prop.rangeIris) {
        this.addN(prop.iri, `${RDFS}range`, rng);
      }
      if (prop.inverseOfIri) {
        this.addN(prop.iri, `${OWL}inverseOf`, prop.inverseOfIri);
      }
      if (prop.isTransitive) {
        this.addN(prop.iri, `${RDF}type`, `${OWL}TransitiveProperty`);
      }
      if (prop.isSymmetric) {
        this.addN(prop.iri, `${RDF}type`, `${OWL}SymmetricProperty`);
      }
      if (prop.isFunctional) {
        this.addN(prop.iri, `${RDF}type`, `${OWL}FunctionalProperty`);
      }
      if (prop.isInverseFunctional) {
        this.addN(prop.iri, `${RDF}type`, `${OWL}InverseFunctionalProperty`);
      }
      this.addLabels(prop.iri, prop.labels);
      this.addAnnotations(prop.iri, prop.annotations);
    }

    // Data properties
    for (const prop of model.dataProperties.values()) {
      this.addN(prop.iri, `${RDF}type`, `${OWL}DatatypeProperty`);
      for (const sup of prop.superPropertyIris) {
        this.addN(prop.iri, `${RDFS}subPropertyOf`, sup);
      }
      for (const dom of prop.domainIris) {
        this.addN(prop.iri, `${RDFS}domain`, dom);
      }
      for (const rng of prop.rangeIris) {
        this.addN(prop.iri, `${RDFS}range`, rng);
      }
      this.addLabels(prop.iri, prop.labels);
      this.addAnnotations(prop.iri, prop.annotations);
    }

    // Annotation properties
    for (const prop of model.annotationProperties.values()) {
      this.addN(prop.iri, `${RDF}type`, `${OWL}AnnotationProperty`);
      this.addLabels(prop.iri, prop.labels);
      this.addAnnotations(prop.iri, prop.annotations);
    }

    // Individuals
    for (const ind of model.individuals.values()) {
      for (const typeIri of ind.classIris) {
        this.addN(ind.iri, `${RDF}type`, typeIri);
      }
      for (const opa of ind.objectPropertyAssertions) {
        this.addN(ind.iri, opa.propertyIri, opa.targetIri);
      }
      for (const dpa of ind.dataPropertyAssertions) {
        const dt = dpa.datatype;
        if (dt) {
          this.addL(ind.iri, dpa.propertyIri, dpa.value, dt, true);
        } else {
          this.addL(ind.iri, dpa.propertyIri, dpa.value);
        }
      }
      this.addLabels(ind.iri, ind.labels);
      this.addAnnotations(ind.iri, ind.annotations);
    }
  }

  private addLabels(iri: string, labels: Record<string, string[]>): void {
    for (const [lang, vals] of Object.entries(labels)) {
      for (const v of vals) {
        if (lang) {
          this.addL(iri, `${RDFS}label`, v, lang);
        } else {
          this.addL(iri, `${RDFS}label`, v);
        }
      }
    }
  }

  private addAnnotations(iri: string, annotations: Record<string, string[]>): void {
    for (const [propIri, vals] of Object.entries(annotations)) {
      for (const v of vals) {
        this.addL(iri, propIri, v);
      }
    }
  }

  execute(sparqlQuery: string): QueryResult {
    const start = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Parser } = require('sparqljs') as { Parser: new (opts?: object) => { parse(q: string): SparqlQuery } };
    const parser = new Parser({
      prefixes: {
        rdf:  RDF,
        rdfs: RDFS,
        owl:  OWL,
        xsd:  XSD,
      },
    });

    let parsed: SparqlQuery;
    try {
      parsed = parser.parse(sparqlQuery);
    } catch (e) {
      throw new Error(`SPARQL parse error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (parsed.type !== 'query' || parsed.queryType !== 'SELECT') {
      throw new Error('Only SELECT queries are supported.');
    }

    // Resolve prefixes declared in the query
    const prefixes: Record<string, string> = {
      rdf: RDF, rdfs: RDFS, owl: OWL, xsd: XSD,
      ...parsed.prefixes,
    };

    // Determine projected variables
    const selectVars = parsed.variables;
    let projectedVars: string[] | null = null;
    if (Array.isArray(selectVars) && selectVars.length > 0 && selectVars[0] !== '*') {
      projectedVars = (selectVars as Array<{ value: string }>).map(v => v.value);
    }

    // Execute WHERE clause patterns
    let bindings: Binding[] = [{}];
    if (parsed.where) {
      bindings = this.executeGroupPattern(parsed.where, bindings, prefixes);
    }

    // Handle DISTINCT
    if (parsed.distinct) {
      bindings = deduplicateBindings(bindings, projectedVars);
    }

    // Handle ORDER BY
    if (parsed.order && parsed.order.length > 0) {
      bindings = this.applyOrderBy(bindings, parsed.order);
    }

    const total = bindings.length;

    // Handle OFFSET
    if (parsed.offset && parsed.offset > 0) {
      bindings = bindings.slice(parsed.offset);
    }

    // Handle LIMIT (cap at 1000)
    const effectiveLimit = parsed.limit ? Math.min(parsed.limit, 1000) : 1000;
    bindings = bindings.slice(0, effectiveLimit);

    // Project variables
    const allVars = projectedVars ?? getAllVariables(bindings);
    const rows: Record<string, string>[] = bindings.map(b => {
      const row: Record<string, string> = {};
      for (const v of allVars) {
        const term = b[v];
        if (term !== undefined) {
          row[v] = termToString(term);
        }
      }
      return row;
    });

    return {
      columns: allVars,
      rows,
      elapsed: Date.now() - start,
      total,
    };
  }

  private executeGroupPattern(
    patterns: SparqlPattern[],
    bindings: Binding[],
    prefixes: Record<string, string>,
  ): Binding[] {
    for (const pattern of patterns) {
      bindings = this.executePattern(pattern, bindings, prefixes);
    }
    return bindings;
  }

  private executePattern(
    pattern: SparqlPattern,
    bindings: Binding[],
    prefixes: Record<string, string>,
  ): Binding[] {
    if (pattern.type === 'bgp') {
      return this.executeBgp(pattern.triples ?? [], bindings, prefixes);
    }
    if (pattern.type === 'optional') {
      return this.executeOptional(pattern.patterns ?? [], bindings, prefixes);
    }
    if (pattern.type === 'filter') {
      if (!pattern.expression) { return bindings; }
      const expr = pattern.expression;
      return bindings.filter(b => this.evalFilter(expr, b, prefixes));
    }
    if (pattern.type === 'union') {
      const pats = pattern.patterns ?? [];
      const leftPats  = pats[0]?.patterns ?? (pats[0] ? [pats[0]] : []);
      const rightPats = pats[1]?.patterns ?? (pats[1] ? [pats[1]] : []);
      const left  = this.executeGroupPattern(leftPats,  bindings, prefixes);
      const right = this.executeGroupPattern(rightPats, bindings, prefixes);
      return [...left, ...right];
    }
    if (pattern.type === 'group') {
      return this.executeGroupPattern(pattern.patterns ?? [], bindings, prefixes);
    }
    // Unknown pattern type — skip
    return bindings;
  }

  private executeBgp(
    triples: SparqlTriple[],
    bindings: Binding[],
    prefixes: Record<string, string>,
  ): Binding[] {
    for (const triple of triples) {
      const newBindings: Binding[] = [];
      for (const binding of bindings) {
        const s = resolveTerm(triple.subject, binding, prefixes);
        const p = resolveTerm(triple.predicate, binding, prefixes);
        const o = resolveTerm(triple.object, binding, prefixes);

        const sNode = s ? (s.termType === 'NamedNode' ? namedNode(s.value) : null) : null;
        const pNode = p ? (p.termType === 'NamedNode' ? namedNode(p.value) : null) : null;
        const oNode = o ? termToN3(o) : null;

        const quads = this.store.getQuads(sNode, pNode, oNode, null);
        for (const q of quads) {
          const extended = extendBinding(binding, triple.subject, q.subject);
          if (extended === null) { continue; }
          const extended2 = extendBinding(extended, triple.predicate, q.predicate);
          if (extended2 === null) { continue; }
          const extended3 = extendBinding(extended2, triple.object, q.object);
          if (extended3 === null) { continue; }
          newBindings.push(extended3);
        }
      }
      bindings = newBindings;
    }
    return bindings;
  }

  private executeOptional(
    patterns: SparqlPattern[],
    outerBindings: Binding[],
    prefixes: Record<string, string>,
  ): Binding[] {
    const result: Binding[] = [];
    for (const outer of outerBindings) {
      const innerBindings = this.executeGroupPattern(patterns, [outer], prefixes);
      if (innerBindings.length === 0) {
        result.push(outer);
      } else {
        for (const inner of innerBindings) {
          result.push({ ...outer, ...inner });
        }
      }
    }
    return result;
  }

  private evalFilter(
    expr: SparqlExpression,
    binding: Binding,
    prefixes: Record<string, string>,
  ): boolean {
    if (!expr) { return true; }

    if (expr.type === 'operation') {
      const op = expr.operator?.toLowerCase() ?? '';
      const args = expr.args ?? [];

      if (op === '=' || op === '==' || op === 'http://www.w3.org/2001/xpath-functions#equals') {
        const l = this.evalExpr(args[0], binding, prefixes);
        const r = this.evalExpr(args[1], binding, prefixes);
        return termsEqual(l, r);
      }
      if (op === '!=' || op === 'http://www.w3.org/2001/xpath-functions#not-equal') {
        const l = this.evalExpr(args[0], binding, prefixes);
        const r = this.evalExpr(args[1], binding, prefixes);
        return !termsEqual(l, r);
      }
      if (op === '<') {
        return compareTerms(this.evalExpr(args[0], binding, prefixes), this.evalExpr(args[1], binding, prefixes)) < 0;
      }
      if (op === '>') {
        return compareTerms(this.evalExpr(args[0], binding, prefixes), this.evalExpr(args[1], binding, prefixes)) > 0;
      }
      if (op === '<=') {
        return compareTerms(this.evalExpr(args[0], binding, prefixes), this.evalExpr(args[1], binding, prefixes)) <= 0;
      }
      if (op === '>=') {
        return compareTerms(this.evalExpr(args[0], binding, prefixes), this.evalExpr(args[1], binding, prefixes)) >= 0;
      }
      if (op === '&&') {
        return this.evalFilter(args[0], binding, prefixes) && this.evalFilter(args[1], binding, prefixes);
      }
      if (op === '||') {
        return this.evalFilter(args[0], binding, prefixes) || this.evalFilter(args[1], binding, prefixes);
      }
      if (op === '!') {
        return !this.evalFilter(args[0], binding, prefixes);
      }
      if (op === 'regex' || op === 'http://www.w3.org/2001/xpath-functions#matches') {
        const val = termValue(this.evalExpr(args[0], binding, prefixes));
        const pat = termValue(this.evalExpr(args[1], binding, prefixes));
        const flags = args[2] ? termValue(this.evalExpr(args[2], binding, prefixes)) : '';
        try { return new RegExp(pat, flags).test(val); } catch { return false; }
      }
      if (op === 'contains' || op === 'http://www.w3.org/2001/xpath-functions#contains') {
        const val = termValue(this.evalExpr(args[0], binding, prefixes));
        const sub = termValue(this.evalExpr(args[1], binding, prefixes));
        return val.includes(sub);
      }
      if (op === 'strstarts' || op === 'http://www.w3.org/2001/xpath-functions#starts-with') {
        const val = termValue(this.evalExpr(args[0], binding, prefixes));
        const sub = termValue(this.evalExpr(args[1], binding, prefixes));
        return val.startsWith(sub);
      }
      if (op === 'strends' || op === 'http://www.w3.org/2001/xpath-functions#ends-with') {
        const val = termValue(this.evalExpr(args[0], binding, prefixes));
        const sub = termValue(this.evalExpr(args[1], binding, prefixes));
        return val.endsWith(sub);
      }
      if (op === 'lang') {
        const t = this.evalExpr(args[0], binding, prefixes);
        if (t && t.termType === 'Literal') { return !!(t as N3.Literal).language; }
        return false;
      }
      if (op === 'isiri' || op === 'isuri') {
        const t = this.evalExpr(args[0], binding, prefixes);
        return t?.termType === 'NamedNode';
      }
      if (op === 'isliteral') {
        const t = this.evalExpr(args[0], binding, prefixes);
        return t?.termType === 'Literal';
      }
      if (op === 'str') {
        // used as filter — treat as truthy if non-empty
        const t = this.evalExpr(args[0], binding, prefixes);
        return !!t && termValue(t).length > 0;
      }
      if (op === 'bound') {
        const varName = args[0]?.value ?? '';
        return binding[varName] !== undefined;
      }
    }

    if (expr.type === 'functionCall') {
      // handle langMatches as a filter
      const fn = expr.function?.value ?? '';
      if (fn === `${RDF}langMatches` || fn.toLowerCase().includes('langmatches')) {
        const args = expr.args ?? [];
        const langTag = termValue(this.evalExpr(args[0], binding, prefixes)).toLowerCase();
        const range = termValue(this.evalExpr(args[1], binding, prefixes)).toLowerCase();
        return range === '*' ? langTag.length > 0 : langTag === range || langTag.startsWith(range + '-');
      }
    }

    // Fallback: evaluate as expression and check truthiness
    const val = this.evalExpr(expr, binding, prefixes);
    if (!val) { return false; }
    if (val.termType === 'Literal') {
      const v = (val as N3.Literal).value;
      if (v === 'false' || v === '0' || v === '') { return false; }
    }
    return true;
  }

  private evalExpr(
    expr: SparqlExpression,
    binding: Binding,
    prefixes: Record<string, string>,
  ): N3.Term | undefined {
    if (!expr) { return undefined; }

    // Variable
    if (expr.termType === 'Variable' || expr.type === 'variable') {
      const name: string = expr.value ?? (expr as { variable?: { value: string } }).variable?.value ?? '';
      return binding[name];
    }

    // Named node / IRI
    if (expr.termType === 'NamedNode') {
      return namedNode(expr.value ?? '');
    }

    // Literal
    if (expr.termType === 'Literal') {
      const e = expr as unknown as { value: string; language?: string; datatype?: { value: string } };
      if (e.language) { return literal(e.value, e.language); }
      if (e.datatype) { return literal(e.value, namedNode(e.datatype.value)); }
      return literal(e.value);
    }

    if (expr.type === 'operation') {
      const op = expr.operator?.toLowerCase() ?? '';
      const args = expr.args ?? [];
      if (op === 'str') {
        const t = this.evalExpr(args[0], binding, prefixes);
        return t ? literal(termValue(t)) : undefined;
      }
      if (op === 'lang') {
        const t = this.evalExpr(args[0], binding, prefixes);
        if (t && t.termType === 'Literal') { return literal((t as N3.Literal).language ?? ''); }
        return literal('');
      }
      if (op === 'ucase') {
        const t = this.evalExpr(args[0], binding, prefixes);
        return t ? literal(termValue(t).toUpperCase()) : undefined;
      }
      if (op === 'lcase') {
        const t = this.evalExpr(args[0], binding, prefixes);
        return t ? literal(termValue(t).toLowerCase()) : undefined;
      }
      if (op === 'concat') {
        const parts = args.map(a => termValue(this.evalExpr(a, binding, prefixes)));
        return literal(parts.join(''));
      }
      if (op === 'strlen') {
        const t = this.evalExpr(args[0], binding, prefixes);
        return literal(String(termValue(t).length), namedNode(`${XSD}integer`));
      }
    }

    if (expr.type === 'functionCall') {
      const fn = expr.function?.value ?? '';
      const args = (expr as { args?: SparqlExpression[] }).args ?? [];
      if (fn.toLowerCase().includes('langmatches')) {
        const langTag = termValue(this.evalExpr(args[0], binding, prefixes)).toLowerCase();
        const range = termValue(this.evalExpr(args[1], binding, prefixes)).toLowerCase();
        const matches = range === '*' ? langTag.length > 0 : langTag === range || langTag.startsWith(range + '-');
        return literal(matches ? 'true' : 'false', namedNode(`${XSD}boolean`));
      }
    }

    return undefined;
  }

  private applyOrderBy(bindings: Binding[], orderClauses: SparqlOrderClause[]): Binding[] {
    return [...bindings].sort((a, b) => {
      for (const clause of orderClauses) {
        const va = termValue(this.evalExprSafe(clause.expression, a));
        const vb = termValue(this.evalExprSafe(clause.expression, b));
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        if (cmp !== 0) { return clause.descending ? -cmp : cmp; }
      }
      return 0;
    });
  }

  private evalExprSafe(expr: SparqlExpression, binding: Binding): N3.Term | undefined {
    try { return this.evalExpr(expr, binding, {}); } catch { return undefined; }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function termValue(term: N3.Term | undefined): string {
  return term?.value ?? '';
}

function termsEqual(a: N3.Term | undefined, b: N3.Term | undefined): boolean {
  if (!a || !b) { return false; }
  if (a.termType !== b.termType) { return false; }
  if (a.value !== b.value) { return false; }
  if (a.termType === 'Literal' && b.termType === 'Literal') {
    const la = a as N3.Literal, lb = b as N3.Literal;
    if ((la.language ?? '') !== (lb.language ?? '')) { return false; }
    if ((la.datatype?.value ?? '') !== (lb.datatype?.value ?? '')) { return false; }
  }
  return true;
}

function compareTerms(a: N3.Term | undefined, b: N3.Term | undefined): number {
  const av = termValue(a), bv = termValue(b);
  // numeric comparison if both look like numbers
  const an = Number(av), bn = Number(bv);
  if (!isNaN(an) && !isNaN(bn)) { return an - bn; }
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function termToN3(term: N3.Term): N3.Term | null {
  if (term.termType === 'NamedNode') { return namedNode(term.value); }
  if (term.termType === 'Literal') {
    const lit = term as N3.Literal;
    if (lit.language) { return literal(lit.value, lit.language); }
    if (lit.datatype) { return literal(lit.value, namedNode(lit.datatype.value)); }
    return literal(lit.value);
  }
  return null;
}

function resolveTerm(
  sparqlTerm: SparqlTerm,
  binding: Binding,
  _prefixes: Record<string, string>,
): N3.Term | undefined {
  if (!sparqlTerm) { return undefined; }
  if (sparqlTerm.termType === 'Variable') {
    const varName: string = sparqlTerm.value ?? '';
    return binding[varName];
  }
  if (sparqlTerm.termType === 'NamedNode') {
    return namedNode(sparqlTerm.value ?? '');
  }
  if (sparqlTerm.termType === 'Literal') {
    const lit = sparqlTerm as unknown as { value: string; language?: string; datatype?: { value: string } };
    if (lit.language) { return literal(lit.value, lit.language); }
    if (lit.datatype) { return literal(lit.value, namedNode(lit.datatype.value)); }
    return literal(lit.value);
  }
  return undefined;
}

function extendBinding(
  binding: Binding,
  sparqlTerm: SparqlTerm,
  quadTerm: N3.Term,
): Binding | null {
  if (!sparqlTerm || sparqlTerm.termType !== 'Variable') { return binding; }
  const varName: string = sparqlTerm.value ?? '';
  if (varName === '') { return binding; }
  if (binding[varName] !== undefined) {
    return termsEqual(binding[varName], quadTerm) ? binding : null;
  }
  return { ...binding, [varName]: quadTerm };
}

function getAllVariables(bindings: Binding[]): string[] {
  const vars = new Set<string>();
  for (const b of bindings) {
    for (const k of Object.keys(b)) { vars.add(k); }
  }
  return [...vars];
}

function deduplicateBindings(bindings: Binding[], projectedVars: string[] | null): Binding[] {
  const seen = new Set<string>();
  return bindings.filter(b => {
    const key = JSON.stringify(
      (projectedVars ?? Object.keys(b)).map(v => [v, b[v] ? termToString(b[v]) : ''])
    );
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

// ── sparqljs type shims (minimal, for internal use) ───────────────────────────

interface SparqlQuery {
  type: 'query' | 'update';
  queryType?: 'SELECT' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE';
  variables?: Array<{ value: string }> | ['*'];
  where?: SparqlPattern[];
  prefixes: Record<string, string>;
  distinct?: boolean;
  order?: SparqlOrderClause[];
  limit?: number;
  offset?: number;
}

interface SparqlOrderClause {
  expression: SparqlExpression;
  descending?: boolean;
}

interface SparqlPattern {
  type: 'bgp' | 'optional' | 'filter' | 'union' | 'group' | string;
  triples?: SparqlTriple[];
  patterns?: SparqlPattern[];
  expression?: SparqlExpression;
}

interface SparqlTriple {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
}

interface SparqlTerm {
  termType?: string;
  value?: string;
  language?: string;
  datatype?: { value: string };
  type?: string;
  variable?: { value: string };
}

interface SparqlExpression {
  type?: string;
  termType?: string;
  value?: string;
  operator?: string;
  args?: SparqlExpression[];
  function?: { value: string };
  language?: string;
  datatype?: { value: string };
}
