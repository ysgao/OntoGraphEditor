import type { DiagramNode, DiagramEdge } from './diagramModel';

/**
 * Recomputes `depth` as the LONGEST path from root over the edge graph — not the shortest (a
 * plain BFS-assigned depth, which is what a node gets the first time some parent's traversal
 * reaches it). A dual-relationship node (FR-011) with two parents at very different depths must
 * be positioned BELOW its deepest parent, not merely below whichever parent happened to discover
 * it first: a shortest-path assignment can leave such a node level-with or ABOVE a farther
 * parent, and `layout.ts` maps depth directly to a fixed row — landing the node above its own
 * parent's row makes that edge fail the simple "child below parent" bus-group test and fall back
 * to an uncollision-checked off-axis bridge, which can then cross arbitrary other edges (reported:
 * a class positioned above one of its own generalization parents because a SEPARATE, shallower
 * composition parent discovered it first during extraction).
 *
 * Originally written for `nodeExclusion.ts`'s post-exclusion renumbering (exclusion can reshape
 * which parents survive); reused as-is by `partOfGraph.ts`'s initial extraction, since the same
 * shortest-vs-longest mismatch can occur there too, independent of any exclusion ever happening.
 *
 * `inProgress` guards against infinite recursion on a part-of cycle — a back-edge simply
 * contributes nothing to the max.
 */
export function renumberDepthsLongestPath(nodes: DiagramNode[], edges: DiagramEdge[]): DiagramNode[] {
  const root = nodes.find(n => n.isRoot);
  if (!root) { return nodes; }

  const parentsByChild = new Map<string, string[]>();
  for (const e of edges) {
    let list = parentsByChild.get(e.childIri);
    if (!list) { list = []; parentsByChild.set(e.childIri, list); }
    list.push(e.parentIri);
  }

  const newDepth = new Map<string, number>([[root.iri, 0]]);

  // Ancestors (root is the CHILD in these edges) keep depth -1, exactly like partOfGraph.ts's
  // one-hop ancestor pass — they are never expanded further, so they're seeded directly rather
  // than resolved via the parent-max recursion below.
  for (const e of edges) {
    if (e.childIri === root.iri && !newDepth.has(e.parentIri)) {
      newDepth.set(e.parentIri, -1);
    }
  }

  function resolve(iri: string, inProgress: Set<string>): number {
    const cached = newDepth.get(iri);
    if (cached !== undefined) { return cached; }
    if (inProgress.has(iri)) { return -1; } // cycle guard: a back-edge contributes nothing

    inProgress.add(iri);
    let maxParentDepth = -1;
    for (const parentIri of parentsByChild.get(iri) ?? []) {
      maxParentDepth = Math.max(maxParentDepth, resolve(parentIri, inProgress));
    }
    inProgress.delete(iri);

    const d = maxParentDepth + 1;
    newDepth.set(iri, d);
    return d;
  }

  for (const n of nodes) { resolve(n.iri, new Set()); }

  return nodes.map(n => (newDepth.has(n.iri) ? { ...n, depth: newDepth.get(n.iri)! } : n));
}
