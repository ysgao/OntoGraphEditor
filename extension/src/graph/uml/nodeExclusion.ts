import type { DiagramNode, DiagramEdge } from './diagramModel';
import { renumberDepthsLongestPath } from './depthNormalization';

export type ExclusionMode = 'subtree' | 'splice';

export interface ExclusionResult {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/**
 * Removes user-marked nodes from an already-extracted diagram (post-processing, not part of
 * `partOfGraph.ts`'s extraction BFS — the flat node/edge lists are exactly the shape this needs,
 * and keeping it separate lets exclusion be re-applied on depth change without re-running
 * extraction). The root is never excluded even if requested, since the diagram has nothing to be
 * "about" without it.
 *
 * - `'subtree'`: the excluded node and everything reachable only through it are removed —
 *   recomputed as graph reachability from the root (plus its one-hop ancestors) with excluded
 *   nodes treated as removed vertices, so a dual-relationship node (FR-011) reachable via a
 *   second, non-excluded parent survives.
 * - `'splice'`: the excluded node disappears but its children reconnect directly to its nearest
 *   surviving ancestor, preserving the CHILD's own edge kind/property (not the ancestor's) —
 *   walks up through any chain of consecutively-excluded ancestors, cycle-safe.
 */
export function applyNodeExclusions(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  excludeIris: ReadonlySet<string>,
  mode: ExclusionMode,
): ExclusionResult {
  const root = nodes.find(n => n.isRoot);
  const excluded = new Set(excludeIris);
  if (root) { excluded.delete(root.iri); }
  if (excluded.size === 0) { return { nodes, edges }; }

  const result = mode === 'splice'
    ? spliceExcluded(nodes, edges, excluded)
    : pruneSubtrees(nodes, edges, excluded, root);

  return { nodes: renumberDepthsLongestPath(result.nodes, result.edges), edges: result.edges };
}

function pruneSubtrees(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  excluded: Set<string>,
  root: DiagramNode | undefined,
): ExclusionResult {
  if (!root) {
    return {
      nodes: nodes.filter(n => !excluded.has(n.iri)),
      edges: edges.filter(e => !excluded.has(e.parentIri) && !excluded.has(e.childIri)),
    };
  }

  const childrenByParent = new Map<string, string[]>();
  for (const e of edges) {
    if (excluded.has(e.parentIri) || excluded.has(e.childIri)) { continue; }
    let list = childrenByParent.get(e.parentIri);
    if (!list) { list = []; childrenByParent.set(e.parentIri, list); }
    list.push(e.childIri);
  }

  // The root's direct ancestors (edges where the root is the CHILD) are always shown unless
  // individually excluded — seed them into the reachable set alongside the root itself.
  const reachable = new Set<string>([root.iri]);
  const queue = [root.iri];
  for (const e of edges) {
    if (e.childIri === root.iri && !excluded.has(e.parentIri) && !reachable.has(e.parentIri)) {
      reachable.add(e.parentIri);
      queue.push(e.parentIri);
    }
  }

  while (queue.length > 0) {
    const iri = queue.shift()!;
    for (const child of childrenByParent.get(iri) ?? []) {
      if (!reachable.has(child)) {
        reachable.add(child);
        queue.push(child);
      }
    }
  }

  return {
    nodes: nodes.filter(n => reachable.has(n.iri)),
    edges: edges.filter(e => reachable.has(e.parentIri) && reachable.has(e.childIri)),
  };
}

function spliceExcluded(nodes: DiagramNode[], edges: DiagramEdge[], excluded: Set<string>): ExclusionResult {
  const parentsOf = new Map<string, DiagramEdge[]>();
  for (const e of edges) {
    let list = parentsOf.get(e.childIri);
    if (!list) { list = []; parentsOf.set(e.childIri, list); }
    list.push(e);
  }

  const resolveCache = new Map<string, string[]>();

  // The nearest surviving (non-excluded) ancestor IRIs for an excluded node `iri`, walking up
  // through any further excluded ancestors above it. `visiting` guards against infinite
  // recursion on a part-of cycle among excluded nodes.
  function resolveAncestorIris(iri: string, visiting: Set<string>): string[] {
    const cached = resolveCache.get(iri);
    if (cached) { return cached; }
    if (visiting.has(iri)) { return []; }
    visiting.add(iri);

    const result: string[] = [];
    for (const e of parentsOf.get(iri) ?? []) {
      if (excluded.has(e.parentIri)) {
        result.push(...resolveAncestorIris(e.parentIri, visiting));
      } else {
        result.push(e.parentIri);
      }
    }

    visiting.delete(iri);
    resolveCache.set(iri, result);
    return result;
  }

  const newEdges: DiagramEdge[] = [];
  let spliceId = 0;
  for (const e of edges) {
    if (excluded.has(e.childIri)) { continue; } // dropped along with the excluded node itself
    if (excluded.has(e.parentIri)) {
      for (const ancestorIri of resolveAncestorIris(e.parentIri, new Set())) {
        newEdges.push({ id: `splice-${spliceId++}`, parentIri: ancestorIri, childIri: e.childIri, kind: e.kind, propertyIri: e.propertyIri });
      }
    } else {
      newEdges.push(e);
    }
  }

  // A node with multiple excluded ancestors that all resolve to the same surviving ancestor
  // would otherwise produce duplicate edges.
  const seen = new Set<string>();
  const dedupedEdges = newEdges.filter(e => {
    const key = `${e.parentIri}|${e.childIri}|${e.kind}|${e.propertyIri ?? ''}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });

  return {
    nodes: nodes.filter(n => !excluded.has(n.iri)),
    edges: dedupedEdges,
  };
}
