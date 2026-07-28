import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';
import { parseConjuncts } from '../utils/ManchesterFormatting';
import type { Conjunct } from '../utils/ManchesterFormatting';
import type { DiagramNode, DiagramEdge, ExcludedRelation } from './diagramModel';
import { renumberDepthsLongestPath } from './depthNormalization';

/** Default node/relationship cap, mirroring MAX_NODES in src/commands/openVisualization.ts. */
export const DEFAULT_MAX_NODES = 200;

export interface ExtractOptions {
  /** Object property IRIs treated as composition (part-of) relationships (FR-004a). */
  compositionProperties: string[];
  /** Overridable for tests; production callers should omit this and take the default. */
  maxNodes?: number;
  preferredLang?: string;
}

export interface ExtractResult {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  excludedRelations: ExcludedRelation[];
  nodeCapReached: boolean;
  /** IRIs of rendered nodes that are themselves lateralized (own a "Laterality some Left/Right"
   *  restriction — NOT "Laterality some Side", which marks the generic reference concept itself,
   *  not a side-specific variant) — see `LATERALITY_PROPERTY`. Callers
   *  (`src/commands/generateUmlDiagram.ts`) use this to seed the node-exclusion set by default,
   *  since a lateralized variant (e.g. "Left kidney") is usually structural noise next to the
   *  reference concept ("Kidney") in a UML breakdown diagram. */
  lateralizedIris: string[];
  /** IRIs of rendered nodes whose label starts with "Entire " — populated only by
   *  `extractInferredUmlDiagram` (spec 032-uml-inferred-subtypes, Inferred view). Undefined for
   *  `extractUmlDiagram` (Stated view), which has no "entire concept" exclusion concept at all —
   *  see that function's own anchor-resolution handling of "Entire X" instead. Callers seed the
   *  default node-exclusion set with this alongside `lateralizedIris` when in Inferred mode. */
  entireIris?: string[];
}

/** Every class's own parsed conjuncts (merging structured `superClassIris`/`equivalentClassIris`
 *  with `parseConjuncts()` over the Manchester-expression arrays) — used to walk UP toward a
 *  class's own supertypes/wholes, and inverted (see `buildReverseIndex`) to walk DOWN toward
 *  whatever else declares itself a subtype/part of a given class. Most classes in a real ontology
 *  only ever appear on the "own conjuncts" side (they declare a superclass; nothing else declares
 *  them as its own supertype) — a downward-only search would show nothing for the vast majority
 *  of entities a user might click, which is exactly the bug this two-directional design fixes. */
function buildConjunctsByClass(model: OntologyModel): Map<string, Conjunct[]> {
  const conjunctsByClass = new Map<string, Conjunct[]>();

  for (const cls of model.classes.values()) {
    const conjuncts: Conjunct[] = [];
    for (const sup of cls.superClassIris) { conjuncts.push({ kind: 'bare', targetIri: sup }); }
    for (const eq of cls.equivalentClassIris) { conjuncts.push({ kind: 'bare', targetIri: eq }); }
    for (const expr of cls.superClassExpressions) { conjuncts.push(...parseConjuncts(expr)); }
    for (const expr of cls.equivalentClassExpressions) { conjuncts.push(...parseConjuncts(expr)); }
    conjunctsByClass.set(cls.iri, conjuncts);
  }

  return conjunctsByClass;
}

interface ReverseIndexEntry {
  childIri: string;
  kind: 'bare' | 'restriction';
  propertyIri?: string;
}

/** Inverts `conjunctsByClass` by target IRI so downward BFS can look up "who points at me" in
 *  O(1) instead of rescanning every class per hop. */
function buildReverseIndex(conjunctsByClass: Map<string, Conjunct[]>): Map<string, ReverseIndexEntry[]> {
  const reverseIndex = new Map<string, ReverseIndexEntry[]>();

  const addEntry = (targetIri: string, entry: ReverseIndexEntry): void => {
    let list = reverseIndex.get(targetIri);
    if (!list) { list = []; reverseIndex.set(targetIri, list); }
    list.push(entry);
  };

  for (const [classIri, conjuncts] of conjunctsByClass) {
    for (const conjunct of conjuncts) {
      if (conjunct.kind === 'bare') {
        addEntry(conjunct.targetIri, { childIri: classIri, kind: 'bare' });
      } else {
        addEntry(conjunct.targetIri, { childIri: classIri, kind: 'restriction', propertyIri: conjunct.propertyIri });
      }
    }
  }

  return reverseIndex;
}

/**
 * SNOMED CT's "All or part of" object property — links a clinical body-structure concept (e.g.
 * "Middle ear structure") to the separate "Entire X" continuant concept that the actual part-of
 * axioms attach to (e.g. "Entire middle ear"), and that the clinical concept's OWN subtype
 * hierarchy runs through a different, much larger genus ("Body structure") than the continuant
 * hierarchy does. Per `uml-diagram-generation-spec.md` §3, the diagram is generated ENTIRELY in
 * "Entire X" terms — resolved once, up front — rather than mixing the two: the clinical concept's
 * generalization ancestors are irrelevant noise for a structural breakdown diagram, and the
 * continuant hierarchy's own genus terms are a bounded, anatomically meaningful set (confirmed
 * empirically against anatomy.owl: "Entire liver"'s own ancestors are 4 concrete anatomical
 * containers, not the "Body structure" mega-hub the clinical hierarchy funnels through). This is
 * a safe, always-on check: an ontology with no clinical/continuant split (the common case outside
 * SNOMED, per spec §11) simply never has a conjunct using this property, so resolution is a no-op
 * and the root falls back to `focusIri` unchanged.
 */
const ANCHOR_PROPERTY = 'http://snomed.info/id/733928003';

/**
 * SNOMED CT's "Laterality" attribute — e.g. `SubClassOf(Kidney and (Laterality some Left))` marks
 * a class as a lateralized variant ("Left kidney") of some reference concept ("Kidney"). Only
 * `Left`/`Right` targets count as lateralized — `Side` (SNOMED's generic, unspecified-side
 * qualifier, e.g. on "Entire middle ear" itself rather than "Entire left middle ear") is NOT a
 * lateralized variant, it just notes that laterality applies to the concept without committing to
 * one; a class asserting `Laterality some Side` is the reference concept, not a side-specific one.
 * Safe no-op outside SNOMED-style ontologies, same as `ANCHOR_PROPERTY`: a conjunct using this
 * property simply never occurs, so `isLateralized` never matches.
 */
const LATERALITY_PROPERTY = 'http://snomed.info/id/272741003';
const LATERALITY_LEFT = 'http://snomed.info/id/7771000';
const LATERALITY_RIGHT = 'http://snomed.info/id/24028007';

/** True when `conjuncts` (a class's OWN parsed conjuncts, from `conjunctsByClass`) includes a
 *  `Laterality some Left`/`Right` restriction — i.e. the class itself is a lateralized variant,
 *  not merely related to one, and not just the generic "applies to some unspecified Side"
 *  reference concept. */
function isLateralized(conjuncts: Conjunct[]): boolean {
  return conjuncts.some(c => c.kind === 'restriction' && c.propertyIri === LATERALITY_PROPERTY
    && (c.targetIri === LATERALITY_LEFT || c.targetIri === LATERALITY_RIGHT));
}

/** Resolves the diagram's actual root: if `focusIri` has its own "All or part of" restriction,
 *  the root is that restriction's target (the "Entire X" concept); otherwise the root is
 *  `focusIri` itself, unresolved. */
function resolveAnchor(focusIri: string, conjunctsByClass: Map<string, Conjunct[]>): string {
  const anchorConjunct = (conjunctsByClass.get(focusIri) ?? []).find(
    c => c.kind === 'restriction' && c.propertyIri === ANCHOR_PROPERTY,
  );
  return anchorConjunct && anchorConjunct.kind === 'restriction' ? anchorConjunct.targetIri : focusIri;
}

/** Strips a leading "Entire " (case-insensitive) from a label — the diagram operates entirely in
 *  "Entire X" terms (see `resolveAnchor`) for correct relationships, but displays the more
 *  natural "X" a user actually searched for or clicked, per the resolved design direction.
 *  Re-capitalizes the first letter of what remains ("Entire liver" → "Liver", not "liver") since
 *  the word immediately after "Entire " is normally lowercase mid-sentence-style in these labels. */
export function stripEntirePrefix(label: string): string {
  const stripped = label.replace(/^entire\s+/i, '');
  if (stripped === label || stripped.length === 0) { return stripped; }
  return stripped[0].toUpperCase() + stripped.slice(1);
}

function labelFor(model: OntologyModel, iri: string, preferredLang: string): string {
  const cls = model.classes.get(iri);
  const raw = cls ? getLabel(cls, preferredLang) : (iri.split(/[#/]/).pop() || iri);
  return stripEntirePrefix(raw);
}

/** Strips a "structure of " prefix or a " structure" suffix (case-insensitive) from a label —
 *  e.g. "Kidney structure" or "Structure of kidney" both display as "Kidney" in the Inferred view
 *  (spec 032-uml-inferred-subtypes). Re-capitalizes the first letter of what remains, same
 *  convention as `stripEntirePrefix`. Inferred-view-only: the Stated view's `labelFor` above is
 *  unaffected — "Entire X" substitution and "X structure" simplification are two independent
 *  display rules that only ever apply in their own respective view. Checks the "structure of "
 *  prefix first so a label matching neither pattern falls through unchanged; a label that somehow
 *  matched both (unlikely — "structure of X structure") would only have the prefix stripped. */
export function stripStructureLabel(label: string): string {
  const prefixMatch = label.match(/^structure of\s+(.+)$/i);
  const rest = prefixMatch ? prefixMatch[1] : label.match(/^(.+?)\s+structure$/i)?.[1];
  if (rest === undefined || rest.length === 0) { return label; }
  return rest[0].toUpperCase() + rest.slice(1);
}

/** Property IRIs backing an excluded relation are usually object properties, but the model
 *  doesn't restrict what a SubClassOf restriction's property could resolve to — checked against
 *  every property map rather than assuming object property specifically. */
function propertyLabelFor(model: OntologyModel, iri: string, preferredLang: string): string {
  const entity = model.objectProperties.get(iri) ?? model.dataProperties.get(iri) ?? model.annotationProperties.get(iri);
  return entity ? getLabel(entity, preferredLang) : (iri.split(/[#/]/).pop() || iri);
}

/**
 * Mechanically extracts a UML diagram rooted at `focusIri`: composition (part-of) and
 * generalization (subtype) relationships derived purely from the ontology's own axioms — no
 * AI/LLM judgment call of any kind (spec FR-004, FR-008).
 *
 * The diagram's actual root is `resolveAnchor(focusIri)` (spec §3) — for SNOMED-style ontologies
 * this resolves a clicked clinical concept to its "Entire X" continuant, and ALL traversal below
 * happens in that single space (never mixing clinical and continuant IRIs), which is what makes
 * both the extracted relationships AND the resulting layout correct: the earlier design that
 * spliced the continuant's children onto the clinical concept while keeping the clinical
 * concept's OWN ancestors produced a graph mixing two different concept spaces, causing
 * mispositioned/overlapping edges. Labels display the more natural "X" (stripping "Entire ") —
 * see `stripEntirePrefix`.
 *
 * Two distinct traversals, mirroring `buildGraphData`'s shape in
 * `src/commands/openVisualization.ts`:
 *  1. **Direct ancestors of the root only** — one hop, via the root's own conjuncts, never
 *     expanded further (same as `buildGraphData`'s "direct supertype pre-pass": always shown, not
 *     part of the depth-based BFS). Kept non-recursive as a defensive measure against a
 *     combinatorial explosion should some other ontology's continuant hierarchy have its own
 *     hub concept, even though anatomy.owl's does not.
 *  2. **Downward BFS from the root**, `depth` hops, via the reverse index (whatever declares
 *     itself a subtype/part of the current frontier) — the actual multi-hop breakdown.
 */
export function extractUmlDiagram(
  model: OntologyModel,
  focusIri: string,
  depth: number,
  options: ExtractOptions,
): ExtractResult {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const preferredLang = options.preferredLang ?? 'en';
  const compositionSet = new Set(options.compositionProperties);

  const conjunctsByClass = buildConjunctsByClass(model);
  const reverseIndex = buildReverseIndex(conjunctsByClass);
  const rootIri = resolveAnchor(focusIri, conjunctsByClass);

  const nodeDepth = new Map<string, number>();
  nodeDepth.set(rootIri, 0);
  const hiddenRelationsFrom = new Set<string>();
  const edgeMap = new Map<string, DiagramEdge>();
  const excludedKeys = new Set<string>();
  const excludedRelations: ExcludedRelation[] = [];
  let nodeCapReached = false;

  const addEdge = (parentIri: string, childIri: string, kind: 'composition' | 'generalization', propertyIri?: string): void => {
    const id = `${parentIri}|${childIri}|${kind}|${propertyIri ?? ''}`;
    if (!edgeMap.has(id)) { edgeMap.set(id, { id, parentIri, childIri, kind, propertyIri }); }
  };

  const addExcluded = (fromIri: string, propertyIri: string, targetIri: string): void => {
    const key = `${fromIri}|${propertyIri}|${targetIri}`;
    if (!excludedKeys.has(key)) {
      excludedKeys.add(key);
      excludedRelations.push({
        fromIri, propertyIri, targetIri,
        fromLabel: labelFor(model, fromIri, preferredLang),
        propertyLabel: propertyLabelFor(model, propertyIri, preferredLang),
        targetLabel: labelFor(model, targetIri, preferredLang),
      });
    }
  };

  const tryAddNode = (iri: string, atDepth: number): 'added' | 'existing' | 'capped' => {
    if (nodeDepth.has(iri)) { return 'existing'; }
    if (nodeDepth.size >= maxNodes) { return 'capped'; }
    nodeDepth.set(iri, atDepth);
    return 'added';
  };

  // A qualifying (bare/composition-property) conjunct always classifies the same way regardless
  // of which direction discovered it — parentIri is always the whole/supertype, childIri the
  // part/subtype. Returns whether the node was newly added (caller decides whether to expand it).
  const processConjunct = (
    ownerIri: string,
    otherIri: string,
    conjunctKind: 'bare' | 'restriction',
    propertyIri: string | undefined,
    ownerIsChild: boolean,
    otherDepth: number,
  ): boolean => {
    if (conjunctKind === 'restriction' && !compositionSet.has(propertyIri!)) {
      addExcluded(ownerIri, propertyIri!, otherIri);
      return false;
    }

    const kind: 'composition' | 'generalization' = conjunctKind === 'bare' ? 'generalization' : 'composition';
    const parentIri = ownerIsChild ? otherIri : ownerIri;
    const childIri = ownerIsChild ? ownerIri : otherIri;

    const result = tryAddNode(otherIri, otherDepth);
    if (result === 'capped') {
      hiddenRelationsFrom.add(ownerIri);
      nodeCapReached = true;
      return false;
    }
    addEdge(parentIri, childIri, kind, propertyIri);
    return result === 'added';
  };

  // 1. Direct ancestors of the root ONLY — one hop, never expanded further. Depth -1 (not +1):
  // the downward BFS below independently assigns the root's own children depth 1, and an
  // ancestor sharing that same row/depth with unrelated descendants is exactly what produced
  // the reported "edges cross other class boxes" bug — the ancestor bridge edge's connecting
  // line swept straight across that shared row, since `layout.ts` maps depth to a fixed row.
  // A negative depth keeps ancestors on their own row, strictly above the root's row (depth 0).
  for (const conjunct of conjunctsByClass.get(rootIri) ?? []) {
    const propertyIri = conjunct.kind === 'restriction' ? conjunct.propertyIri : undefined;
    processConjunct(rootIri, conjunct.targetIri, conjunct.kind, propertyIri, /* ownerIsChild */ true, -1);
  }

  // 2. Downward BFS from the root, `depth` hops, via the reverse index only.
  let frontier = [rootIri];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];

    for (const iri of frontier) {
      const iriDepth = nodeDepth.get(iri)!;
      for (const entry of reverseIndex.get(iri) ?? []) {
        if (processConjunct(iri, entry.childIri, entry.kind, entry.propertyIri, /* ownerIsChild */ false, iriDepth + 1)) {
          next.push(entry.childIri);
        }
      }
    }

    frontier = next;
    if (frontier.length === 0) { break; }
  }

  // Nodes queued for a hop that never ran (depth exhausted) still have further descendants —
  // flag them so the diagram can indicate "more exists" (FR-005 edge case).
  for (const iri of frontier) {
    const hasMoreDown = (reverseIndex.get(iri) ?? []).some(
      e => e.kind === 'bare' || compositionSet.has(e.propertyIri ?? ''),
    );
    if (hasMoreDown) { hiddenRelationsFrom.add(iri); }
  }

  const rawNodes: DiagramNode[] = [...nodeDepth.entries()].map(([iri, nDepth]) => ({
    iri,
    label: labelFor(model, iri, preferredLang),
    depth: nDepth,
    isRoot: iri === rootIri,
    hasHiddenRelations: hiddenRelationsFrom.has(iri),
  }));

  const edges = removeRedundantEdges([...edgeMap.values()]);

  // A dual-relationship node (FR-011) discovered via one parent during BFS keeps THAT parent's
  // depth, even when a SECOND, much deeper parent also points at it — the shortest-path depth
  // above can leave the node level-with or ABOVE that second parent's own row, which fails
  // `diagramGeometry.ts`'s "child below parent" bus-group test for that edge and routes it as an
  // uncollision-checked off-axis bridge instead, free to cross arbitrary other edges (reported:
  // "Tympanic ostium of eustachian tube" positioned above its own generalization parent "Ostium
  // of eustachian tube", because a separate, shallower composition parent — "Tympanic cavity" —
  // discovered it first). Recomputing depth as the LONGEST path from root (same fix already
  // applied post-exclusion in `nodeExclusion.ts`) keeps every node strictly below every one of
  // its own parents.
  const nodes = renumberDepthsLongestPath(rawNodes, edges);

  const lateralizedIris = nodes
    .filter(n => !n.isRoot && isLateralized(conjunctsByClass.get(n.iri) ?? []))
    .map(n => n.iri);

  return { nodes, edges, excludedRelations, nodeCapReached, lateralizedIris };
}

export interface InferredExtractOptions {
  /** Overridable for tests; production callers should omit this and take the default. */
  maxNodes?: number;
  preferredLang?: string;
}

function inferredLabelFor(model: OntologyModel, iri: string, preferredLang: string): string {
  const cls = model.classes.get(iri);
  const raw = cls ? getLabel(cls, preferredLang) : (iri.split(/[#/]/).pop() || iri);
  return stripStructureLabel(raw);
}

/** Inverts an `inferredSubClasses`-shaped map (parent IRI → child IRIs) into child IRI → parent
 *  IRIs, so the Inferred view's one-hop ancestor pre-pass (mirroring `extractUmlDiagram`'s own
 *  pre-pass, see below) can look up "who is `iri` inferred to be a direct subtype of" without
 *  rescanning the whole map per lookup. */
function buildInferredParentsIndex(inferredSubClasses: Map<string, Set<string>>): Map<string, string[]> {
  const parentsOf = new Map<string, string[]>();
  for (const [parentIri, childIris] of inferredSubClasses) {
    for (const childIri of childIris) {
      let list = parentsOf.get(childIri);
      if (!list) { list = []; parentsOf.set(childIri, list); }
      list.push(parentIri);
    }
  }
  return parentsOf;
}

/**
 * Mechanically extracts an INFERRED-view UML diagram rooted at `focusIri`: generalization
 * (is-a) relationships derived PURELY from the reasoner's classified hierarchy
 * (`model.inferredSubClasses`) — never mixed with `extractUmlDiagram`'s asserted-axiom traversal
 * (spec 032-uml-inferred-subtypes, second refinement). Composition ("part of") relationships are
 * never included in this view — there is no equivalent "inferred part-of" hierarchy on the model,
 * and this view is generalization-only by design. `focusIri` is used AS-IS as the diagram root —
 * unlike `extractUmlDiagram`, there is no "All or part of" anchor-hop to an "Entire X" continuant,
 * since that mechanism is itself part-of/composition-flavored and doesn't apply here.
 *
 * Two "entities to auto-hide by default" categories are surfaced (`lateralizedIris`/`entireIris`),
 * mirroring `extractUmlDiagram`'s own `lateralizedIris`; the caller (`src/commands/
 * generateUmlDiagram.ts`) seeds the node-exclusion set with both, revealable via the same
 * "show full subhierarchy" toggle used for the Stated view:
 *  - **Lateralized** classes (own a "Laterality some Left/Right" restriction) — same check as the
 *    Stated view, since this inspects a class's own asserted definition, not its traversal source.
 *  - **"Entire X"** classes (label starts with "Entire ") — noise in a pure is-a breakdown of a
 *    "structure"-style entity; unlike the Stated view, this view does not substitute or anchor on
 *    them, it just optionally hides them by default alongside lateralized variants.
 *
 * A no-op (single-node result) when `model.isClassified` is false — there is no inferred hierarchy
 * to walk. Never itself triggers classification.
 */
export function extractInferredUmlDiagram(
  model: OntologyModel,
  focusIri: string,
  depth: number,
  options: InferredExtractOptions = {},
): ExtractResult {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const preferredLang = options.preferredLang ?? 'en';
  const rootIri = focusIri;

  // Defensive guard, matching the established pattern elsewhere on this model (e.g.
  // `openVisualization.ts`): `model.inferredSubClasses` is only ever populated alongside
  // `isClassified` by `classifyOntology()`, but a stale/leftover map from before a reload
  // shouldn't be walked as if it were current — never triggers classification either way.
  const inferredSubClasses = model.isClassified ? model.inferredSubClasses : new Map<string, Set<string>>();

  // Only used to detect (a) whether a given inferred pair is ALSO directly asserted, for the
  // solid-vs-dashed distinction within this fully-inferred view (a relationship confirmed by both
  // reasoning AND a direct axiom is still worth distinguishing from a reasoner-only one), and
  // (b) a node's own Laterality restriction for `lateralizedIris`. Never used to determine SCOPE —
  // scope here comes exclusively from `inferredSubClasses` above.
  const conjunctsByClass = buildConjunctsByClass(model);
  const inferredParentsOf = buildInferredParentsIndex(inferredSubClasses);

  const nodeDepth = new Map<string, number>();
  nodeDepth.set(rootIri, 0);
  const hiddenRelationsFrom = new Set<string>();
  const edgeMap = new Map<string, DiagramEdge>();
  let nodeCapReached = false;

  const tryAddNode = (iri: string, atDepth: number): 'added' | 'existing' | 'capped' => {
    if (nodeDepth.has(iri)) { return 'existing'; }
    if (nodeDepth.size >= maxNodes) { return 'capped'; }
    nodeDepth.set(iri, atDepth);
    return 'added';
  };

  const isAlsoAsserted = (parentIri: string, childIri: string): boolean =>
    (conjunctsByClass.get(childIri) ?? []).some(c => c.kind === 'bare' && c.targetIri === parentIri);

  const addInferredEdge = (parentIri: string, childIri: string): void => {
    const id = `${parentIri}|${childIri}|generalization|`;
    if (!edgeMap.has(id)) {
      edgeMap.set(id, {
        id, parentIri, childIri, kind: 'generalization',
        isInferred: isAlsoAsserted(parentIri, childIri) ? undefined : true,
      });
    }
  };

  // 1. Direct inferred ancestors of the root ONLY — one hop, depth -1, same rationale as
  // `extractUmlDiagram`'s own ancestor pre-pass (own row, never expanded further).
  for (const parentIri of inferredParentsOf.get(rootIri) ?? []) {
    const result = tryAddNode(parentIri, -1);
    if (result === 'capped') { hiddenRelationsFrom.add(rootIri); nodeCapReached = true; continue; }
    addInferredEdge(parentIri, rootIri);
  }

  // 2. Downward BFS from the root, `depth` hops, via `inferredSubClasses` directly — no
  // reverse-index inversion needed, since it's already keyed parent → children.
  let frontier = [rootIri];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];

    for (const iri of frontier) {
      const iriDepth = nodeDepth.get(iri)!;
      for (const childIri of inferredSubClasses.get(iri) ?? []) {
        const result = tryAddNode(childIri, iriDepth + 1);
        if (result === 'capped') { hiddenRelationsFrom.add(iri); nodeCapReached = true; continue; }
        addInferredEdge(iri, childIri);
        if (result === 'added') { next.push(childIri); }
      }
    }

    frontier = next;
    if (frontier.length === 0) { break; }
  }

  // Nodes queued for a hop that never ran (depth exhausted) still have further descendants —
  // flag them so the diagram can indicate "more exists", same as `extractUmlDiagram`.
  for (const iri of frontier) {
    if ((inferredSubClasses.get(iri)?.size ?? 0) > 0) { hiddenRelationsFrom.add(iri); }
  }

  const rawNodes: DiagramNode[] = [...nodeDepth.entries()].map(([iri, nDepth]) => ({
    iri,
    label: inferredLabelFor(model, iri, preferredLang),
    depth: nDepth,
    isRoot: iri === rootIri,
    hasHiddenRelations: hiddenRelationsFrom.has(iri),
  }));

  const edges = removeRedundantEdges([...edgeMap.values()]);
  const nodes = renumberDepthsLongestPath(rawNodes, edges);

  const lateralizedIris = nodes
    .filter(n => !n.isRoot && isLateralized(conjunctsByClass.get(n.iri) ?? []))
    .map(n => n.iri);
  const entireIris = nodes
    .filter(n => !n.isRoot && /^entire\s+/i.test(n.label))
    .map(n => n.iri);

  return { nodes, edges, excludedRelations: [], nodeCapReached, lateralizedIris, entireIris };
}

/** Drops a direct parent→child edge when an alternate path already connects them through some
 *  other node, at any depth and MIXING kinds freely (A is-a B, B part-of C ⟹ a direct A part-of C
 *  edge is transitively implied — subsumption is monotonic, so whatever B is part of, its subtype
 *  A is part of too; the same logic chains through any number of intermediate is-a/part-of hops).
 *  Only one edge should ever connect a given pair of nodes: real ontologies sometimes assert both
 *  the direct relationship and the (possibly mixed-kind) chain that already implies it explicitly.
 *  Reachability is checked with the direct edge's own first hop excluded (rather than a plain
 *  "is there a path" test), so a 2-node cycle (A↔B, no third node) correctly keeps both edges —
 *  there is no OTHER path between them, only the direct one in each direction. */
function removeRedundantEdges(edges: DiagramEdge[]): DiagramEdge[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    let list = adjacency.get(edge.parentIri);
    if (!list) { list = []; adjacency.set(edge.parentIri, list); }
    list.push(edge.childIri);
  }

  const redundantIds = new Set<string>();
  for (const edge of edges) {
    if (hasAlternatePath(edge.parentIri, edge.childIri, adjacency)) {
      redundantIds.add(edge.id);
    }
  }

  return edges.filter(edge => !redundantIds.has(edge.id));
}

/** Breadth-first reachability from `from` to `to`, forbidden from taking the direct `from`→`to`
 *  hop as its FIRST step (any later step back through an edge with the same endpoints is fine —
 *  it just means the alternate path revisits it, which the visited-set already handles safely). */
function hasAlternatePath(from: string, to: string, adjacency: Map<string, string[]>): boolean {
  const visited = new Set<string>([from]);
  const queue = (adjacency.get(from) ?? []).filter(next => next !== to);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) { return true; }
    if (visited.has(current)) { continue; }
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) { queue.push(next); }
  }

  return false;
}
