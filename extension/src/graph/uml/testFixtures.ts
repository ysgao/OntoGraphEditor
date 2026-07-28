import type { DiagramNode, DiagramEdge } from './diagramModel';

function node(iri: string, depth: number, isRoot = false): DiagramNode {
  return { iri, label: iri, depth, isRoot, hasHiddenRelations: false };
}

function edge(parentIri: string, childIri: string, kind: DiagramEdge['kind'] = 'generalization'): DiagramEdge {
  return { id: `${parentIri}|${childIri}|${kind}|`, parentIri, childIri, kind };
}

/**
 * A synthetic 5-layer (depth 0-4) fixture where `X` is reachable from three parents at three
 * different depths (`A2` at depth 2, `C` at depth 3, and `root` itself at depth 0) — deliberately
 * exercising both a short multi-layer gap (`A2` -> `X`, depth 2 -> 4) and a long one (`root` ->
 * `X`, depth 0 -> 4), per spec Edge Case "an entity reachable from the root by paths of different
 * lengths" and User Story 1's "at least one entity reachable via two different parents at 4+
 * levels of depth." Reused by `layout.test.ts`, `diagramGeometry.test.ts`, and
 * `layoutMetrics.test.ts` so all three suites exercise the identical multi-parent/multi-layer
 * shape (spec FR-005).
 */
export const deepMultiParentFixture: { nodes: DiagramNode[]; edges: DiagramEdge[] } = {
  nodes: [
    node('root', 0, true),
    node('A', 1),
    node('B', 1),
    node('A1', 2),
    node('A2', 2),
    node('B1', 2),
    node('C', 3),
    node('X', 4),
  ],
  edges: [
    edge('root', 'A'),
    edge('root', 'B'),
    edge('A', 'A1'),
    edge('A', 'A2'),
    edge('B', 'B1'),
    edge('B1', 'C'),
    edge('A2', 'X'), // depth 2 -> 4: one intermediate dummy layer (3)
    edge('C', 'X'), // depth 3 -> 4: adjacent, no dummy
    edge('root', 'X'), // depth 0 -> 4: three intermediate dummy layers (1, 2, 3)
  ],
};

/**
 * A minimal fixture with exactly one avoidable edge crossing that single-parent-local sibling
 * clustering (the old `reorderBySharedChildren` heuristic) cannot see: `P1` and `P3` share child
 * `S`, but `P2` — sitting between them in declaration order, with its own exclusive child `D2` —
 * has no child in common with either, so a heuristic that only clusters siblings sharing a CHILD
 * never reorders `P1`/`P2`/`P3` relative to each other. A global crossing-minimization sweep
 * (spec FR-004) reorders `P1` and `P3` adjacent to each other, removing the crossing. Used by
 * `layoutMetrics.test.ts` to demonstrate a measurable crossing-count improvement (spec SC-002).
 */
export const crossingFixture: { nodes: DiagramNode[]; edges: DiagramEdge[] } = {
  nodes: [
    node('root', 0, true),
    node('P1', 1),
    node('P2', 1),
    node('P3', 1),
    node('S', 2),
    node('D2', 2),
  ],
  edges: [
    edge('root', 'P1'),
    edge('root', 'P2'),
    edge('root', 'P3'),
    edge('P1', 'S'),
    edge('P2', 'D2'),
    edge('P3', 'S'),
  ],
};
