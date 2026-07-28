/** One synthetic placeholder occupying a single intermediate layer-slot for an edge whose
 *  parent and child sit more than one layer apart. Never a real ontology entity — `id` is
 *  synthesized from the owning edge and layer, never an IRI, so it can never collide with (or be
 *  mistaken for) a real `DiagramNode.iri`. Internal to `src/uml/`; never exposed past
 *  `computeLayout()`'s return value (see `contracts/layout-module-contract.md`). */
export interface DummyNode {
  id: string;
  layer: number;
  ownerEdgeId: string;
}

export interface DummyChainResult {
  dummies: DummyNode[];
  /** Full occupant-id path per edge that needed at least one dummy, in layer order:
   *  `[parentIri, dummy1, dummy2, ..., childIri]`. An edge with no entry here spans at most one
   *  layer and needs no dummy-based routing. */
  chainsByEdgeId: Map<string, string[]>;
}

interface DepthLookupNode { iri: string; depth: number; }
interface DummyableEdge { id: string; parentIri: string; childIri: string; }

/**
 * Expands every edge whose child sits more than one layer below its parent into a chain of
 * dummy nodes, one per intermediate layer (`LayeredGraphAlgorithm.md` §2). An edge whose child is
 * at most one layer below its parent is left alone (no entry in `chainsByEdgeId`). An edge whose
 * child is NOT strictly deeper than its parent (`gap <= 0` — a back-edge from a cycle, per
 * `depthNormalization.ts`'s own cycle guard, or an inverted/ancestor edge) also contributes no
 * dummies: there is no "intermediate layer" to speak of, and forcing one would loop or produce a
 * nonsensical negative-length chain.
 */
export function insertDummyNodes(nodes: DepthLookupNode[], edges: DummyableEdge[]): DummyChainResult {
  const depthByIri = new Map(nodes.map(n => [n.iri, n.depth]));
  const dummies: DummyNode[] = [];
  const chainsByEdgeId = new Map<string, string[]>();

  for (const e of edges) {
    const parentDepth = depthByIri.get(e.parentIri);
    const childDepth = depthByIri.get(e.childIri);
    if (parentDepth === undefined || childDepth === undefined) { continue; }

    const gap = childDepth - parentDepth;
    if (gap <= 1) { continue; }

    const chain: string[] = [e.parentIri];
    for (let layer = parentDepth + 1; layer < childDepth; layer++) {
      const id = `__dummy__${e.id}__${layer}`;
      dummies.push({ id, layer, ownerEdgeId: e.id });
      chain.push(id);
    }
    chain.push(e.childIri);
    chainsByEdgeId.set(e.id, chain);
  }

  return { dummies, chainsByEdgeId };
}
