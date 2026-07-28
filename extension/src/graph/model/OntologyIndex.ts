import type { OntologyModel, OWLEntityUnion } from './OntologyModel';
import { expressionContainsIri } from './AxiomDisplay';

const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const SKOS_ALT_LABEL = 'http://www.w3.org/2004/02/skos/core#altLabel';

/**
 * Top-level named-class IRIs from a flat and-conjunction Manchester expression.
 * A named-class conjunct is a bare IRI (no spaces); restrictions like
 * "propIri some fillerIri" contain spaces and are excluded.
 */
export function extractNamedConjuncts(expr: string): string[] {
  let depth = 0;
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') { depth++; continue; }
    if (expr[i] === ')') { depth--; continue; }
    if (depth === 0 && expr.slice(i, i + 5) === ' and ') {
      parts.push(expr.slice(start, i).trim());
      start = i + 5;
      i += 4;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.filter(p => p.startsWith('http') && !p.includes(' '));
}

function entityByIri(model: OntologyModel, iri: string): OWLEntityUnion | undefined {
  return model.classes.get(iri)
    ?? model.objectProperties.get(iri)
    ?? model.dataProperties.get(iri)
    ?? model.annotationProperties.get(iri)
    ?? model.individuals.get(iri);
}

/**
 * Direct subtype IRIs of `iri`: for a class, subclasses via plain `SubClassOf`,
 * or via a named conjunct in an `EquivalentClasses`/complex-`SubClassOf`
 * expression (conjunction-elimination case — a named subclass whose stated
 * definition names its parent as one conjunct rather than a plain SubClassOf).
 * For an object/data/annotation property, sub-properties via `superPropertyIris`.
 * Individuals have no subtype concept and always return [].
 */
export function getDirectSubtypes(iri: string, model: OntologyModel): string[] {
  const entity = entityByIri(model, iri);
  if (!entity) { return []; }

  if (entity.type === 'class') {
    const direct: string[] = [];
    for (const potentialSub of model.classes.values()) {
      if (potentialSub.iri === iri) { continue; }
      const viaSubClassOf = potentialSub.superClassIris.includes(iri);
      const viaEquivalent = potentialSub.equivalentClassExpressions.some(
        expr => extractNamedConjuncts(expr).includes(iri)
      );
      const viaSuperClassExpression = potentialSub.superClassExpressions.some(
        expr => extractNamedConjuncts(expr).includes(iri)
      );
      if (viaSubClassOf || viaEquivalent || viaSuperClassExpression) {
        direct.push(potentialSub.iri);
      }
    }
    return direct;
  }

  if (entity.type === 'objectProperty' || entity.type === 'dataProperty' || entity.type === 'annotationProperty') {
    const map = entity.type === 'objectProperty' ? model.objectProperties
      : entity.type === 'dataProperty' ? model.dataProperties
      : model.annotationProperties;
    const direct: string[] = [];
    for (const potentialSub of map.values()) {
      if (potentialSub.iri === iri) { continue; }
      if (potentialSub.superPropertyIris.includes(iri)) { direct.push(potentialSub.iri); }
    }
    return direct;
  }

  return [];
}

/**
 * Full transitive-descendant closure of `iri` (direct subtypes, their subtypes,
 * and so on), computed by repeated application of {@link getDirectSubtypes}.
 * Cycle-safe via a visited set (a well-formed ontology has no subtype cycles,
 * but a malformed one must not hang this traversal).
 */
export function getTransitiveSubtypes(iri: string, model: OntologyModel): string[] {
  const visited = new Set<string>();
  const queue = [...getDirectSubtypes(iri, model)];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (visited.has(next)) { continue; }
    visited.add(next);
    for (const child of getDirectSubtypes(next, model)) {
      if (!visited.has(child)) { queue.push(child); }
    }
  }
  return [...visited];
}

/**
 * Every entity whose own axiom-bearing fields (class/property expressions,
 * IRIs, or individual assertions) reference `iri` anywhere. Does not require
 * `iri` to resolve to an existing entity — a deleted entity's IRI can still
 * safely be scanned for (it simply won't match anything new).
 *
 * Used to find which entities' cached editor display must be invalidated
 * after a label rename, mirroring the field list `updateIriReferencesInModel`
 * (src/views/EntityEditorPanel.ts) already scans for IRI renames.
 */
export function findEntitiesReferencingIri(model: OntologyModel, iri: string): OWLEntityUnion[] {
  const found: OWLEntityUnion[] = [];

  for (const cls of model.classes.values()) {
    if (
      cls.superClassIris.includes(iri)
      || cls.equivalentClassIris.includes(iri)
      || cls.disjointClassIris.includes(iri)
      || cls.superClassExpressions.some(e => expressionContainsIri(e, iri))
      || cls.equivalentClassExpressions.some(e => expressionContainsIri(e, iri))
      || cls.gciExpressions.some(e => expressionContainsIri(e, iri))
    ) {
      found.push(cls);
    }
  }
  for (const prop of model.objectProperties.values()) {
    if (
      prop.superPropertyIris.includes(iri)
      || prop.domainIris.includes(iri)
      || prop.rangeIris.includes(iri)
      || prop.inverseOfIri === iri
      || (prop.equivalentPropertyIris?.includes(iri) ?? false)
      || (prop.disjointPropertyIris?.includes(iri) ?? false)
      || (prop.propertyChains?.some(chain => chain.includes(iri)) ?? false)
    ) {
      found.push(prop);
    }
  }
  for (const prop of model.dataProperties.values()) {
    if (prop.superPropertyIris.includes(iri) || prop.domainIris.includes(iri) || prop.rangeIris.includes(iri)) {
      found.push(prop);
    }
  }
  for (const prop of model.annotationProperties.values()) {
    if (prop.superPropertyIris.includes(iri) || prop.domainIris.includes(iri) || prop.rangeIris.includes(iri)) {
      found.push(prop);
    }
  }
  for (const ind of model.individuals.values()) {
    if (
      ind.classIris.includes(iri)
      || ind.objectPropertyAssertions.some(a => a.propertyIri === iri || a.targetIri === iri)
      || ind.dataPropertyAssertions.some(a => a.propertyIri === iri)
    ) {
      found.push(ind);
    }
  }

  return found;
}

export class OntologyIndex {
  private iriToEntity = new Map<string, OWLEntityUnion>();
  private labelToIris = new Map<string, string[]>();
  /** IRI → array of individual labels (lowercase, lang-tag stripped) for token search */
  private searchText = new Map<string, string[]>();
  /** Lowercase IRI local name → IRI, for exact-name lookup only */
  private localNameToIri = new Map<string, string>();

  constructor(private model: OntologyModel) {
    this.rebuild();
  }

  /** Strip lang tag and lowercase in one pass — avoids two separate string allocations per label. */
  private static stripAndLower(value: string): string {
    const at = value.lastIndexOf('@');
    return (at > 0 ? value.slice(0, at) : value).toLowerCase();
  }

  /**
   * Score a single label text against query tokens.
   * Rewards word-prefix matches (e.g. token "live" vs word "liver") over
   * mid-word substrings (e.g. "live" in "delivery"), keeping exact/prefix
   * label matches at their original high scores.
   */
  private static labelScore(text: string, tokens: string[], queryLower: string): number {
    if (text === queryLower) { return 100; }
    if (text.startsWith(queryLower)) { return 50 - text.length * 0.01; }
    // Word-prefix quality: for each token find the best-matching word
    const words = text.split(/\s+/);
    let quality = 0;
    for (const token of tokens) {
      let best = 0;
      for (const word of words) {
        if (word === token)            { best = 4; break; }
        if (word.startsWith(token))    { best = Math.max(best, 3); }
        else if (word.includes(token)) { best = Math.max(best, 1); }
      }
      quality += best;
    }
    return (quality / tokens.length) * 5 - text.length * 0.01;
  }

  private addToIndex(iri: string, key: string): void {
    const existing = this.labelToIris.get(key);
    if (!existing) { this.labelToIris.set(key, [iri]); return; }
    if (!existing.includes(iri)) { existing.push(iri); }
  }

  rebuild(): void {
    this.iriToEntity.clear();
    this.labelToIris.clear();
    this.searchText.clear();
    this.localNameToIri.clear();
    for (const map of [
      this.model.classes,
      this.model.objectProperties,
      this.model.dataProperties,
      this.model.annotationProperties,
      this.model.individuals,
    ] as const) {
      for (const entity of map.values()) {
        this.iriToEntity.set(entity.iri, entity as OWLEntityUnion);

        const allValues: string[] = [];
        for (const labels of Object.values(entity.labels)) {
          for (const label of labels) {
            const key = OntologyIndex.stripAndLower(label);
            this.addToIndex(entity.iri, key);
            allValues.push(key);
          }
        }
        for (const annotIri of [SKOS_PREF_LABEL, SKOS_ALT_LABEL]) {
          const values = entity.annotations[annotIri];
          if (values) {
            for (const val of values) {
              const key = OntologyIndex.stripAndLower(val);
              this.addToIndex(entity.iri, key);
              allValues.push(key);
            }
          }
        }
        // Single backward scan — avoids two lastIndexOf calls per entity.
        // Local name goes into the exact-match index only; not into allValues
        // (prevents substring queries like "123" from matching numeric SNOMED IDs).
        const iri = entity.iri;
        let sep = -1;
        for (let j = iri.length - 1; j >= 0; j--) {
          const c = iri.charCodeAt(j);
          if (c === 35 /* # */ || c === 47 /* / */) { sep = j; break; }
        }
        const localName = sep >= 0 ? iri.slice(sep + 1) : iri;
        if (localName) {
          this.localNameToIri.set(localName.toLowerCase(), entity.iri);
        }
        this.searchText.set(entity.iri, allValues);
      }
    }
  }

  getByIri(iri: string): OWLEntityUnion | undefined {
    return this.iriToEntity.get(iri);
  }

  /** Exact IRI local-name lookup (case-insensitive), e.g. "Koala" for `...#Koala`. */
  getByLocalName(localName: string): OWLEntityUnion | undefined {
    const iri = this.localNameToIri.get(localName.toLowerCase());
    return iri ? this.iriToEntity.get(iri) : undefined;
  }

  searchByLabel(query: string, maxResults = 50): OWLEntityUnion[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) { return []; }
    const matches: { entity: OWLEntityUnion; score: number }[] = [];
    const queryLower = query.toLowerCase().trim();

    // Step 1 — exact local-name match (score 200, ranks above all label matches)
    const exactIri = this.localNameToIri.get(queryLower);
    if (exactIri) {
      const e = this.iriToEntity.get(exactIri);
      if (e) { matches.push({ entity: e, score: 200 }); }
    }

    // Step 2 — cross-field label match
    for (const [iri, labels] of this.searchText) {
      if (iri === exactIri) { continue; }
      // All tokens must appear somewhere across the label set (cross-field check)
      if (!tokens.every(t => labels.some(text => text.includes(t)))) { continue; }

      let bestScore = -1;
      for (const text of labels) {
        // Prefer single-label match (all tokens in one label string)
        if (tokens.every(t => text.includes(t))) {
          const score = OntologyIndex.labelScore(text, tokens, queryLower);
          if (score > bestScore) { bestScore = score; }
        }
      }
      if (bestScore === -1) {
        // Cross-field only: tokens span multiple labels
        const avgLen = labels.reduce((s, t) => s + t.length, 0) / labels.length;
        bestScore = 1 - avgLen * 0.001;
      }
      const entity = this.iriToEntity.get(iri);
      if (entity) { matches.push({ entity, score: bestScore }); }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, maxResults).map(m => m.entity);
  }

  /** Return all entities whose label exactly equals the given string (case-insensitive). */
  exactMatchByLabel(label: string): OWLEntityUnion[] {
    const iris = this.labelToIris.get(label.toLowerCase()) ?? [];
    return iris.map(iri => this.iriToEntity.get(iri)).filter((e): e is OWLEntityUnion => e !== undefined);
  }

  get classCount(): number { return this.model.classes.size; }
  get objectPropertyCount(): number { return this.model.objectProperties.size; }
  get dataPropertyCount(): number { return this.model.dataProperties.size; }
  get individualCount(): number { return this.model.individuals.size; }
}
