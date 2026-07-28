import type { Position } from './diagramGeometry';

export interface NodeBox { left: number; top: number; right: number; bottom: number; }

/** Strict interior overlap — two boxes that merely touch along a shared edge (a common,
 *  intentional case, e.g. two adjacent same-row boxes placed exactly `crossSpacing` apart) are
 *  NOT considered overlapping, matching the "touching at a single boundary doesn't count as a
 *  crossing" convention already used elsewhere in this module (`diagramGeometry.ts`'s
 *  `computeBusGroupPlacements`). */
export function boxesOverlap(a: NodeBox, b: NodeBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Every pair of node boxes (keyed by IRI) whose interiors overlap — spec FR-001/SC-001. */
export function detectNodeOverlaps(boxByIri: Map<string, NodeBox>): Array<[string, string]> {
  const iris = [...boxByIri.keys()];
  const overlaps: Array<[string, string]> = [];
  for (let i = 0; i < iris.length; i++) {
    for (let j = i + 1; j < iris.length; j++) {
      if (boxesOverlap(boxByIri.get(iris[i])!, boxByIri.get(iris[j])!)) {
        overlaps.push([iris[i], iris[j]]);
      }
    }
  }
  return overlaps;
}

/** Axis-aligned segment/box overlap — every path this module renders uses only horizontal or
 *  vertical `M`/`L` segments (never a diagonal or curve), so treating the segment as a degenerate
 *  rectangle and reusing the same strict bounding-box test is exact, not an approximation. */
function segmentIntersectsBox(p1: Position, p2: Position, box: NodeBox): boolean {
  const left = Math.min(p1.x, p2.x);
  const right = Math.max(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const bottom = Math.max(p1.y, p2.y);
  return boxesOverlap({ left, right, top, bottom }, box);
}

/**
 * Every (edge, node) pair where the edge's rendered path passes through a node box other than
 * the two it connects — spec FR-002/SC-001. `excludedIrisByEdge` supplies, per edge id, the
 * IRIs that edge is allowed to touch (its own source and target) so a path's own endpoints are
 * never flagged against the boxes they legitimately terminate at.
 */
export function detectEdgeNodeOverlaps(
  edgePaths: Map<string, Position[]>,
  boxByIri: Map<string, NodeBox>,
  excludedIrisByEdge: (edgeId: string) => Set<string>,
): Array<{ edgeId: string; nodeIri: string }> {
  const results: Array<{ edgeId: string; nodeIri: string }> = [];
  for (const [edgeId, points] of edgePaths) {
    const excluded = excludedIrisByEdge(edgeId);
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      for (const [iri, box] of boxByIri) {
        if (excluded.has(iri)) { continue; }
        if (segmentIntersectsBox(p1, p2, box)) {
          results.push({ edgeId, nodeIri: iri });
        }
      }
    }
  }
  return results;
}

/** Strict-interior perpendicular intersection between two axis-aligned segments — every path
 *  this module renders uses only horizontal or vertical `M`/`L` segments. Two parallel segments
 *  (both horizontal or both vertical) are never counted here, even if collinear and overlapping;
 *  the visual defect this feature targets is edges crossing at an angle, not a rarer collinear
 *  overlap. Touching exactly at an endpoint (e.g. two edges converging on the same shared node)
 *  is a meeting, not a crossing, and the strict `>`/`<` comparisons exclude it. */
function segmentsCrossPerpendicular(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const aVertical = a1.x === a2.x;
  const bVertical = b1.x === b2.x;
  if (aVertical === bVertical) { return false; }
  const vert = aVertical ? a1 : b1;
  const vertOther = aVertical ? a2 : b2;
  const horiz = aVertical ? b1 : a1;
  const horizOther = aVertical ? b2 : a2;
  const vTop = Math.min(vert.y, vertOther.y);
  const vBottom = Math.max(vert.y, vertOther.y);
  const hLeft = Math.min(horiz.x, horizOther.x);
  const hRight = Math.max(horiz.x, horizOther.x);
  return vert.x > hLeft && vert.x < hRight && horiz.y > vTop && horiz.y < vBottom;
}

/**
 * Counts how many pairs of segments — across every distinct pair of rendered edge paths — cross
 * each other perpendicularly (spec FR-004/SC-002). Operates on the actual rendered polylines
 * (`diagramGeometry.ts`'s resolved points) rather than an abstract per-layer order index, so it
 * directly measures the same thing a viewer sees: two edges' lines visibly crossing, anywhere
 * along their length — not just between two specific adjacent layers.
 */
export function countPathCrossings(edgePaths: Map<string, Position[]>): number {
  const entries = [...edgePaths.entries()];
  let crossings = 0;
  for (let i = 0; i < entries.length; i++) {
    const [, pathA] = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      const [, pathB] = entries[j];
      for (let a = 1; a < pathA.length; a++) {
        for (let b = 1; b < pathB.length; b++) {
          if (segmentsCrossPerpendicular(pathA[a - 1], pathA[a], pathB[b - 1], pathB[b])) {
            crossings++;
          }
        }
      }
    }
  }
  return crossings;
}
