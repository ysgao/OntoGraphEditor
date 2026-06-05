import type { OntologyModel, OWLEntityUnion } from './OntologyModel';

const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const SKOS_ALT_LABEL = 'http://www.w3.org/2004/02/skos/core#altLabel';

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
