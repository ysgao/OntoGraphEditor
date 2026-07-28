/**
 * Counts crossings scoped correctly to each adjacent layer pair: two hop-pairs `(a1,b1)` and
 * `(a2,b2)` (upper-layer order-index `a1`/`a2`, lower-layer order-index `b1`/`b2`) cross if
 * `(a1-a2)*(b1-b2) < 0`. `nextHopByOccupant` supplies each layer's hop-pairs directly (it already
 * includes dummy-node hops, so a multi-layer edge's intermediate segments are counted at every
 * layer they pass through, not just at its real endpoints). Two hops sharing an upper or lower
 * endpoint are excluded — converging on (or fanning out from) the same occupant is a meeting, not
 * a crossing.
 */
function countTotalCrossings(
  sortedLayers: number[],
  layerOrder: Map<number, string[]>,
  nextHopByOccupant: Map<string, string[]>,
): number {
  let total = 0;
  for (let i = 0; i < sortedLayers.length - 1; i++) {
    const upperOrder = layerOrder.get(sortedLayers[i]) ?? [];
    const lowerOrder = layerOrder.get(sortedLayers[i + 1]) ?? [];
    const lowerIndex = new Map(lowerOrder.map((id, idx) => [id, idx]));

    const hopPairs: Array<[number, number]> = [];
    upperOrder.forEach((upperId, upperIdx) => {
      for (const hop of nextHopByOccupant.get(upperId) ?? []) {
        const lowerIdx = lowerIndex.get(hop);
        if (lowerIdx !== undefined) { hopPairs.push([upperIdx, lowerIdx]); }
      }
    });

    for (let a = 0; a < hopPairs.length; a++) {
      for (let b = a + 1; b < hopPairs.length; b++) {
        const [a1, b1] = hopPairs[a];
        const [a2, b2] = hopPairs[b];
        if (a1 === a2 || b1 === b2) { continue; }
        if ((a1 - a2) * (b1 - b2) < 0) { total++; }
      }
    }
  }
  return total;
}

export interface CrossingReductionInput {
  sortedLayers: number[];
  initialOrder: Map<number, string[]>;
  /** Every occupant's (real node or dummy) next-layer neighbors — the SAME map `layout.ts` uses
   *  to propagate its initial ordering, reused here so the sweep and the initial pass agree on
   *  what "adjacent" means. */
  nextHopByOccupant: Map<string, string[]>;
}

/**
 * Alternating median/barycenter crossing-minimization sweep (`LayeredGraphAlgorithm.md` §3):
 * repeatedly re-sorts each layer by the average order-index of its neighbors in the layer just
 * processed (a down-sweep uses parents' positions to reorder children; an up-sweep uses
 * children's positions to reorder parents), keeping whichever full-diagram ordering snapshot has
 * the fewest total counted crossings across every adjacent layer pair. An occupant with no
 * placed neighbors this pass keeps its current relative position (stable sort) rather than being
 * pulled to an arbitrary edge.
 */
export function reduceCrossings(input: CrossingReductionInput, passes = 8): Map<number, string[]> {
  const { sortedLayers, nextHopByOccupant } = input;

  const parentsByOccupant = new Map<string, string[]>();
  for (const [parentId, hops] of nextHopByOccupant) {
    for (const hop of hops) {
      let list = parentsByOccupant.get(hop);
      if (!list) { list = []; parentsByOccupant.set(hop, list); }
      list.push(parentId);
    }
  }

  let current = new Map<number, string[]>();
  for (const [layer, order] of input.initialOrder) { current.set(layer, [...order]); }

  let best = new Map<number, string[]>();
  for (const [layer, order] of current) { best.set(layer, [...order]); }
  let bestScore = countTotalCrossings(sortedLayers, current, nextHopByOccupant);

  if (sortedLayers.length < 2) { return best; } // no adjacent layer pair — nothing to reorder

  for (let pass = 0; pass < passes; pass++) {
    const downSweep = pass % 2 === 0;
    const layerIndices = downSweep
      ? Array.from({ length: sortedLayers.length - 1 }, (_, i) => i + 1)
      : Array.from({ length: sortedLayers.length - 1 }, (_, i) => sortedLayers.length - 2 - i);

    for (const li of layerIndices) {
      const layer = sortedLayers[li];
      const neighborLayer = sortedLayers[downSweep ? li - 1 : li + 1];
      const neighborOrder = current.get(neighborLayer) ?? [];
      const neighborIndex = new Map(neighborOrder.map((id, idx) => [id, idx]));
      const neighborsOf = downSweep ? parentsByOccupant : nextHopByOccupant;

      const order = current.get(layer) ?? [];
      const keyed = order.map((id, originalIndex) => {
        const neighborIndices = (neighborsOf.get(id) ?? [])
          .map(n => neighborIndex.get(n))
          .filter((v): v is number => v !== undefined);
        const key = neighborIndices.length > 0
          ? neighborIndices.reduce((a, b) => a + b, 0) / neighborIndices.length
          : originalIndex; // no placed neighbor this pass — keep current relative position
        return { id, key, originalIndex };
      });
      keyed.sort((a, b) => a.key - b.key || a.originalIndex - b.originalIndex);
      current.set(layer, keyed.map(k => k.id));
    }

    const score = countTotalCrossings(sortedLayers, current, nextHopByOccupant);
    if (score < bestScore) {
      bestScore = score;
      best = new Map<number, string[]>();
      for (const [layer, order] of current) { best.set(layer, [...order]); }
    }
  }

  return best;
}
