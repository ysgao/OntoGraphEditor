import type { DiagramNode, DiagramEdge, LayoutDirection } from './diagramModel';
import { insertDummyNodes } from './dummyNodes';
import { assignTidyTreeCoordinates } from './layerCoordinates';
import { reduceCrossings } from './layerOrdering';
import { assignBusLanes, laneCountOf } from './busLanes';

export interface LayoutPosition {
  x: number;
  y: number;
  depth: number;
}

/** Plain `{x,y}` shape mirroring `diagramGeometry.ts`'s `Position` — redeclared locally rather
 *  than imported to avoid a cross-module dependency in the "core layout" direction
 *  (`diagramGeometry.ts` already depends on this module's output; the reverse would be a cycle). */
export interface Position { x: number; y: number; }

// Base spacing along the DEPTH axis (rows in TB, columns in LR) for a transition that needs only
// ONE bus lane — must clear the node's own extent along that axis (NODE_HEIGHT 56 in TB /
// NODE_WIDTH 160 in LR) plus twice `diagramGeometry.ts`'s BUS_GAP (42), so that a single-lane
// transition places its bus at exactly `parentBottom + BUS_GAP` with an equal `BUS_GAP`-sized
// final stem down to the child — i.e. it looks identical to the pre-variable-spacing layout for
// the common shallow case. TB: 56 + 2*42 = 140; LR: 160 + 2*42 = 244, rounded up to 260 for a
// little slack. Denser transitions grow beyond this base by `LANE_STEP` per extra lane (see
// `flowByLayer` below) — this is what lets `diagramGeometry.ts` give every bus in a layer its own
// distinct height, rather than the whole layer sharing a single fixed gap sized for the worst
// case (which made shallow transitions needlessly tall and dense ones too cramped to separate).
const BASE_ROW_HEIGHT = 140;
const BASE_COLUMN_WIDTH = 260;

// Extra depth-axis spacing added per bus lane beyond the first. MUST be >= `diagramGeometry.ts`'s
// `BUS_LANE_SPREAD` (12) — that module stacks each successive same-transition bus at
// `naturalBusY + laneIndex * BUS_LANE_SPREAD`, so the transition gap has to grow by at least that
// much per lane or the deepest lanes would be clamped back onto the child row. Kept a touch
// larger (14 vs 12) so the deepest lane always keeps a visible final stem with a couple of px to
// spare, rather than landing exactly on the clamp boundary.
const LANE_STEP = 14;

// Spacing along the CROSS axis (columns of siblings in TB, rows of siblings in LR) — sized
// against the node's extent on THAT axis instead: TB's cross axis is screen-horizontal (against
// NODE_WIDTH), LR's is screen-vertical (against NODE_HEIGHT). Every real node reserves exactly
// one of these slots regardless of position in the tree (root, internal, or leaf) — this is what
// makes node-node overlap structurally impossible rather than merely checked-and-clamped.
const SLOT_WIDTH = 170;
const SLOT_HEIGHT = 90;

// A dummy node stands in for the "pass-through" segment of a multi-layer edge at one
// intermediate layer — it never needs a full node-sized reservation, just enough room for a
// routed line plus clearance, so it reserves a visibly thinner slot than a real node.
const DUMMY_SLOT_WIDTH = 40;
const DUMMY_SLOT_HEIGHT = 24;

const LEFT_MARGIN = 40;

interface InternalLayoutResult {
  realPositions: Map<string, LayoutPosition>;
  /** Per far-spanning edge (`DiagramEdge.id`), the ordered list of its intermediate dummy-node
   *  positions (one per layer it passes through), in final `direction`-aware coordinates. Empty
   *  or absent for an edge that spans at most one layer. Internal — never returned by
   *  `computeLayout()` itself; only `computeFarEdgeRoutes()` exposes it (see
   *  `contracts/layout-module-contract.md`). */
  dummyPositionsByEdge: Map<string, Position[]>;
}

/**
 * Layered graph layout, following `LayeredGraphAlgorithm.md`'s ordering/coordinate-assignment
 * approach: layer (depth) assignment is untouched — `src/uml/depthNormalization.ts`'s
 * longest-path rule already gives every node a layer relative to root — but CROSS-axis placement
 * now works layer-by-layer rather than node-by-node:
 *
 * 1. Multi-layer edges (parent and child more than one layer apart) are expanded into a chain of
 *    dummy nodes, one per intermediate layer (`insertDummyNodes`) — this is what lets those edges
 *    reserve real cross-axis space at every layer they pass through, instead of being routed
 *    reactively around whatever real nodes happen to already be there.
 * 2. Each layer's occupants (real nodes AND dummies) are given an initial deterministic order,
 *    built by propagating from the topmost layer downward: each occupant's next-layer "hops" (its
 *    real children, kind-clustered, or a dummy's own single chain continuation) are appended in
 *    turn. Any node never reached this way (unreachable from root, spec FR-007) is appended at
 *    its own layer as a deterministic fallback.
 * 3. That initial order is then improved by `reduceCrossings` (`layerOrdering.ts`), an alternating
 *    median/barycenter sweep that reorders each layer using its neighbors' positions and keeps
 *    whichever full-diagram ordering has the fewest counted edge crossings (spec FR-004) —
 *    superseding the old local "shared child" clustering, which could only see a crossing caused
 *    by two siblings under the SAME parent, not one caused by non-adjacent parents' shared
 *    descendants further down the tree.
 * 4. Cross-axis coordinates are assigned per layer, in that final order, via a running cumulative
 *    sum (`assignLayerCoordinates`) — a position is a sum, not a value that gets checked and
 *    clamped afterward, so two occupants in the same layer can never overlap by construction.
 *
 * Direct ancestors of the root (`partOfGraph.ts`'s one-hop ancestor pre-pass, negative depth) are
 * a special case handled the same way as before: centered symmetrically on the root's own cross
 * position as a final override, since they're never reached via the propagation above (the edge
 * runs ancestor -> root, not the other way).
 */
function computeInternal(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: LayoutDirection,
): InternalLayoutResult {
  const baseFlow = direction === 'LR' ? BASE_COLUMN_WIDTH : BASE_ROW_HEIGHT;
  const crossSpacing = direction === 'LR' ? SLOT_HEIGHT : SLOT_WIDTH;
  const dummyCrossSpacing = direction === 'LR' ? DUMMY_SLOT_HEIGHT : DUMMY_SLOT_WIDTH;

  const depthByIri = new Map(nodes.map(n => [n.iri, n.depth]));

  // Bus-lane count per parent layer — the number of distinct (parent, kind) bus groups whose
  // parent sits at that layer. Each such group is one horizontal bus that `diagramGeometry.ts`
  // gives its own lane/height in the transition band just below the parent's layer, so this count
  // sizes that transition's flow-gap (see `flowByLayer`). Computed from edge structure alone (no
  // positions), and deliberately an UPPER bound on the lanes actually drawn: fan-in
  // (`diagramGeometry.ts`) may later merge several single-child groups converging on one shared
  // child into a single bus, which only ever REDUCES the count — so a gap sized to this always has
  // room to spare, never too little.
  const laneKeysByParentLayer = new Map<number, Set<string>>();
  for (const e of edges) {
    const parentLayer = depthByIri.get(e.parentIri);
    if (parentLayer === undefined) { continue; }
    let set = laneKeysByParentLayer.get(parentLayer);
    if (!set) { set = new Set(); laneKeysByParentLayer.set(parentLayer, set); }
    set.add(`${e.parentIri}|${e.kind}`);
  }

  // Far-edge crossings per band — a multi-layer (dashed) edge is routed through the transition
  // bands between its parent and child, and `diagramGeometry.ts` now gives its horizontal jog in
  // each band its OWN lane BELOW that band's bus lanes (rather than cutting across the middle of
  // them, which read as cramped). So each band's flow-gap must also make room for the far-edge
  // jogs passing through it, on the same uniform lane pitch as the buses. A far edge from layer
  // `p` to layer `c` (c > p+1) crosses the bands whose top layer is p, p+1, …, c-1.
  const farCrossByBandLayer = new Map<number, number>();
  for (const e of edges) {
    const p = depthByIri.get(e.parentIri);
    const c = depthByIri.get(e.childIri);
    if (p === undefined || c === undefined || c <= p + 1) { continue; }
    for (let band = p; band < c; band++) {
      farCrossByBandLayer.set(band, (farCrossByBandLayer.get(band) ?? 0) + 1);
    }
  }
  // A parent frequently has BOTH composition and generalization children at once (e.g. an
  // anatomical whole with a part-of breakdown AND laterality-qualified subtypes) — clustering
  // same-kind children together (rather than the raw edge-declaration order, which can
  // interleave the two kinds) keeps each kind's cross-axis span from overlapping the other's when
  // `diagramGeometry.ts` draws their two separate bus groups.
  const kindOrder: Record<DiagramEdge['kind'], number> = { composition: 0, generalization: 1 };
  const edgesByParent = new Map<string, DiagramEdge[]>();
  for (const e of edges) {
    let list = edgesByParent.get(e.parentIri);
    if (!list) { list = []; edgesByParent.set(e.parentIri, list); }
    list.push(e);
  }

  const rawChildrenByParentByKind = new Map<string, Map<DiagramEdge['kind'], string[]>>();
  for (const [parentIri, parentEdges] of edgesByParent) {
    const byKind = new Map<DiagramEdge['kind'], string[]>();
    for (const kind of Object.keys(kindOrder) as DiagramEdge['kind'][]) {
      const children: string[] = [];
      for (const e of parentEdges) {
        if (e.kind !== kind) { continue; }
        // A shared child (multiple qualifying parents, FR-005) must not get more than one
        // ordering-slot allocation from THIS parent — de-dup per parent's own child list only.
        if (!children.includes(e.childIri)) { children.push(e.childIri); }
      }
      byKind.set(kind, children);
    }
    rawChildrenByParentByKind.set(parentIri, byKind);
  }

  // --- Dummy-node insertion (LayeredGraphAlgorithm.md §2) ---
  const { dummies, chainsByEdgeId } = insertDummyNodes(nodes, edges);
  const dummyById = new Map(dummies.map(d => [d.id, d]));

  // For each real parent, its ordered list of NEXT-LAYER hops: a real child (kind-clustered —
  // composition before generalization, so `diagramGeometry.ts`'s two separate bus groups never
  // interleave) when the edge is adjacent, or the FIRST dummy in that edge's chain when the edge
  // spans more than one layer (the child itself only appears as the LAST dummy's own next hop, or
  // directly if the edge needed no dummies at all). Relative order AMONG a parent's own children
  // beyond kind-clustering is left as declaration order here — the crossing-minimization sweep
  // below reorders every layer globally, which subsumes and supersedes the old local
  // same-parent-only "shared child" clustering (spec FR-004).
  const nextHopByOccupant = new Map<string, string[]>();
  for (const [parentIri, byKind] of rawChildrenByParentByKind) {
    const nextHops: string[] = [];
    for (const kind of Object.keys(kindOrder) as DiagramEdge['kind'][]) {
      for (const childIri of byKind.get(kind) ?? []) {
        const e = (edgesByParent.get(parentIri) ?? []).find(x => x.kind === kind && x.childIri === childIri);
        if (!e) { continue; }
        const chain = chainsByEdgeId.get(e.id);
        const firstHop = chain ? chain[1] : childIri;
        if (!nextHops.includes(firstHop)) { nextHops.push(firstHop); }
      }
    }
    nextHopByOccupant.set(parentIri, nextHops);
  }
  // A dummy's own next hop is exactly the next id in its owning edge's chain (one-to-one).
  for (const chain of chainsByEdgeId.values()) {
    for (let i = 1; i < chain.length - 1; i++) {
      nextHopByOccupant.set(chain[i], [chain[i + 1]]);
    }
  }

  // --- Per-layer ordering, propagated top-down (LayeredGraphAlgorithm.md §3's "initial order") ---
  const allLayers = new Set<number>();
  for (const n of nodes) { allLayers.add(n.depth); }
  for (const d of dummies) { allLayers.add(d.layer); }
  const sortedLayers = [...allLayers].sort((a, b) => a - b);

  const layerOrder = new Map<number, string[]>();
  const placed = new Set<string>();

  if (sortedLayers.length > 0) {
    const topLayer = sortedLayers[0];
    const topOccupants = nodes.filter(n => n.depth === topLayer).map(n => n.iri);
    layerOrder.set(topLayer, topOccupants);
    for (const id of topOccupants) { placed.add(id); }
  }

  for (let li = 1; li < sortedLayers.length; li++) {
    const layer = sortedLayers[li];
    const prevOrder = layerOrder.get(sortedLayers[li - 1]) ?? [];
    const order: string[] = [];
    for (const occupant of prevOrder) {
      for (const hop of nextHopByOccupant.get(occupant) ?? []) {
        const hopLayer = dummyById.has(hop) ? dummyById.get(hop)!.layer : depthByIri.get(hop);
        if (hopLayer !== layer || placed.has(hop)) { continue; }
        order.push(hop);
        placed.add(hop);
      }
    }
    // Unreachable-node fallback (spec FR-007, Edge Case): a real node at this layer never reached
    // via any parent->child hop above still gets a deterministic slot rather than being dropped.
    for (const n of nodes) {
      if (n.depth === layer && !placed.has(n.iri)) {
        order.push(n.iri);
        placed.add(n.iri);
      }
    }
    layerOrder.set(layer, order);
  }

  // --- Crossing-minimization sweep (LayeredGraphAlgorithm.md §3, spec FR-004) ---
  const optimizedOrder = reduceCrossings({ sortedLayers, initialOrder: layerOrder, nextHopByOccupant });

  // --- Cumulative-sum coordinate assignment (LayeredGraphAlgorithm.md §4) ---
  const widthById = new Map<string, number>();
  for (const n of nodes) { widthById.set(n.iri, crossSpacing); }
  for (const d of dummies) { widthById.set(d.id, dummyCrossSpacing); }

  // Combined layer index for every occupant (real node depth or dummy layer) — lets the balanced
  // coordinate pass leave negative-depth ancestors alone (centered as a group on root, below).
  const layerOfId = new Map<string, number>();
  for (const n of nodes) { layerOfId.set(n.iri, n.depth); }
  for (const d of dummies) { layerOfId.set(d.id, d.layer); }

  const cross = assignTidyTreeCoordinates(
    optimizedOrder, widthById, nextHopByOccupant, layerOfId, LEFT_MARGIN,
  );

  // Direct ancestors of the root (`partOfGraph.ts`'s one-hop ancestor pre-pass, depth < 0) are
  // never reached by the propagation above (the edge runs ancestor -> root, not the other way) —
  // center them as a group on root's own cross position instead, symmetric about it, spaced the
  // same as ordinary siblings, exactly as before this rewrite.
  const root = nodes.find(n => n.depth === 0);
  if (root) {
    const rootCross = cross.get(root.iri);
    if (rootCross !== undefined) {
      const ancestors = nodes.filter(n => n.depth < 0);
      ancestors.forEach((n, i) => {
        cross.set(n.iri, rootCross + (i - (ancestors.length - 1) / 2) * crossSpacing);
      });
    }
  }

  // Centering ancestors on root can push their cross value below the left margin — shift every
  // node's (and dummy's) cross value forward just enough to clear the margin. Adding a constant
  // to every value preserves all pairwise separations, so this can never introduce an overlap.
  const crossValues = [...cross.values()];
  if (crossValues.length > 0) {
    const minCross = Math.min(...crossValues);
    if (minCross < LEFT_MARGIN) {
      const shift = LEFT_MARGIN - minCross;
      for (const [id, v] of cross) { cross.set(id, v + shift); }
    }
  }

  // --- Per-transition flow coordinate (variable, lane-count-driven) ---
  // Each transition's gap is sized to how many bus lanes that band actually needs: `baseFlow`
  // (room for one lane) plus `LANE_STEP` per extra lane. The lane count is NOT the raw number of
  // (parent, kind) buses at the band — it's how many of them MUTUALLY OVERLAP in x, computed by the
  // same `assignBusLanes` colouring `diagramGeometry.ts` uses to place them. Now that tidy-tree
  // placement separates sibling parents horizontally, most sibling buses have disjoint spans and
  // share a single lane, so a band that once cost N lanes of height now usually costs one — this is
  // what compacts the height between levels. Bus spans are taken from the FINAL cross coordinates
  // (a constant margin shift preserves overlaps, so it's safe to read them post-shift). A far
  // (multi-layer) edge still claims its own lane below the buses in every band it crosses, so those
  // are added on top. Cumulative from the shallowest layer (a possibly-negative ancestor) at flow 0.
  const busLaneCountByLayer = new Map<number, number>();
  for (const [parentLayer, keys] of laneKeysByParentLayer) {
    const spans = [...keys].map((key) => {
      const [parentIri, kind] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
      const childIris = edges.filter(e => e.parentIri === parentIri && e.kind === kind).map(e => e.childIri);
      const xs = [cross.get(parentIri) ?? LEFT_MARGIN, ...childIris.map(c => cross.get(c) ?? LEFT_MARGIN)];
      const laneKind = kind === 'composition' ? 'composition' as const : 'generalization' as const;
      return { key, kind: laneKind, minX: Math.min(...xs), maxX: Math.max(...xs), childIris: new Set(childIris) };
    });
    busLaneCountByLayer.set(parentLayer, laneCountOf(assignBusLanes(spans)));
  }
  const lanesForBand = (bandTopLayer: number): number =>
    (busLaneCountByLayer.get(bandTopLayer) ?? 0) + (farCrossByBandLayer.get(bandTopLayer) ?? 0);

  const flowByLayer = new Map<number, number>();
  if (sortedLayers.length > 0) {
    flowByLayer.set(sortedLayers[0], 0);
    for (let i = 1; i < sortedLayers.length; i++) {
      const upperLayer = sortedLayers[i - 1];
      const gap = baseFlow + Math.max(0, lanesForBand(upperLayer) - 1) * LANE_STEP;
      flowByLayer.set(sortedLayers[i], flowByLayer.get(upperLayer)! + gap);
    }
  }

  // A direct ancestor of the root is given a negative depth so it never shares a row/column with
  // the root's own descendants; `flowByLayer` starts the shallowest (most negative) layer at flow 0,
  // so every resulting flow coordinate is non-negative without a separate offset pass.
  const realPositions = new Map<string, LayoutPosition>();
  for (const n of nodes) {
    const flow = flowByLayer.get(n.depth) ?? 0;
    const crossVal = cross.get(n.iri) ?? LEFT_MARGIN;
    const pos = direction === 'LR' ? { x: flow, y: crossVal } : { x: crossVal, y: flow };
    realPositions.set(n.iri, { ...pos, depth: n.depth });
  }

  const dummyPositionsByEdge = new Map<string, Position[]>();
  for (const [edgeId, chain] of chainsByEdgeId) {
    const dummyIds = chain.slice(1, -1);
    const points = dummyIds.map((id) => {
      const layer = dummyById.get(id)!.layer;
      const flow = flowByLayer.get(layer) ?? 0;
      const crossVal = cross.get(id) ?? LEFT_MARGIN;
      return direction === 'LR' ? { x: flow, y: crossVal } : { x: crossVal, y: flow };
    });
    dummyPositionsByEdge.set(edgeId, points);
  }

  return { realPositions, dummyPositionsByEdge };
}

/**
 * Computes each real node's diagram-space position. Signature and return type are unchanged from
 * before this feature (`contracts/layout-module-contract.md`) — dummy nodes and per-edge routing
 * are entirely internal; use `computeFarEdgeRoutes` for the latter.
 *
 * `direction` picks which screen axis is "flow" (depth) and which is "cross" (siblings): 'TB'
 * (default) maps flow to `y` and cross to `x`; 'LR' maps flow to `x` and cross to `y`.
 */
export function computeLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: LayoutDirection = 'TB',
): Map<string, LayoutPosition> {
  return computeInternal(nodes, edges, direction).realPositions;
}

/**
 * Per far-spanning edge (parent and child more than one layer apart), the ordered list of
 * intermediate dummy-node positions that edge's rendered path must pass through to stay clear of
 * every other node's own reserved slot (spec FR-002). Empty for an edge spanning at most one
 * layer — `diagramGeometry.ts` keeps its existing direct bus/elbow routing for those unchanged.
 * Shares `computeLayout()`'s exact internal layering/ordering/coordinate state, so a far edge's
 * dummy positions are always consistent with the real node positions `computeLayout()` returned
 * for the same input.
 */
export function computeFarEdgeRoutes(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: LayoutDirection = 'TB',
): Map<string, Position[]> {
  return computeInternal(nodes, edges, direction).dummyPositionsByEdge;
}
