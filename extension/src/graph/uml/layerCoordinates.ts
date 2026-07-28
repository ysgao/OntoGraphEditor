/**
 * Assigns each layer's occupants (real nodes and/or dummy nodes, mixed) a cross-axis coordinate
 * via a running cumulative sum of widths — never by computing a position and then checking/
 * clamping it against a neighbor after the fact. Two adjacent occupants in the SAME layer can
 * therefore never overlap, regardless of their order or width: the position IS the sum, not an
 * independently-derived value a clamp has to fix up (`LayeredGraphAlgorithm.md` §4).
 *
 * Each layer starts fresh from `leftMargin` — layers are independent of one another; only the
 * FLOW axis (row/column index, assigned elsewhere) separates them.
 */
export function assignLayerCoordinates(
  layerOrder: Map<number, string[]>,
  widthById: Map<string, number>,
  gap: number,
  leftMargin: number,
): Map<string, number> {
  const cross = new Map<string, number>();
  for (const order of layerOrder.values()) {
    let cumulative = leftMargin;
    for (const id of order) {
      const width = widthById.get(id) ?? 0;
      cross.set(id, cumulative + width / 2);
      cumulative += width + gap;
    }
  }
  return cross;
}

/**
 * Tidy, parent-over-children coordinate assignment (a Reingold–Tilford-style layered tree walk):
 * every parent is placed EXACTLY at the midpoint of the span of its children, and sibling subtrees
 * are pushed apart by whole-subtree shifts only as far as needed to stay clear of each other. So a
 * parent sits in the middle of its subtypes/compositions and the gap between sibling parents is
 * deliberately UNEVEN — determined by how wide each one's own subtree is, not a fixed pitch.
 *
 * Each occupant is laid out under a single parent (the first, in `layerOrder`, to reach it), so a
 * shared child (or the real child at the end of a far edge's dummy chain, already claimed by a
 * nearer parent) attaches to just one — the graph is reduced to a spanning tree for placement.
 * A childless occupant takes the next free slot; an internal one is centred over its children after
 * each later child subtree has been shifted right past the accumulated span of its earlier siblings.
 *
 * Separation uses a per-layer contour: when merging two subtrees the required shift is the MAX over
 * every shared layer of `(halfWidthLeftExtreme + halfWidthRightExtreme)` minus their current gap —
 * so a wide upper layer forces enough spread even where a narrow dummy layer alone would not,
 * keeping every layer overlap-free. Children are visited in their `layerOrder` position, preserving
 * the crossing-minimised ordering. Negative-depth ancestors are skipped for the caller to place.
 */
export function assignTidyTreeCoordinates(
  layerOrder: Map<number, string[]>,
  widthById: Map<string, number>,
  childrenByOccupant: Map<string, string[]>,
  layerOfId: Map<string, number>,
  leftMargin: number,
): Map<string, number> {
  const xById = new Map<string, number>();
  const claimed = new Set<string>();
  const widthOf = (id: string): number => widthById.get(id) ?? 0;

  const orderIndex = new Map<string, number>();
  for (const order of layerOrder.values()) { order.forEach((id, i) => orderIndex.set(id, i)); }

  // A subtree's contour: its extreme (min/max) coordinate at every layer it occupies, plus the
  // width of the extreme occupant there (needed to compute a correct separation on merge).
  interface Extreme { x: number; w: number; }
  interface Sub { ids: string[]; min: Map<number, Extreme>; max: Map<number, Extreme>; }

  const addToContour = (s: Sub, layer: number, x: number, w: number): void => {
    const lo = s.min.get(layer); if (!lo || x < lo.x) { s.min.set(layer, { x, w }); }
    const hi = s.max.get(layer); if (!hi || x > hi.x) { s.max.set(layer, { x, w }); }
  };
  const shiftSub = (s: Sub, d: number): void => {
    for (const id of s.ids) { xById.set(id, xById.get(id)! + d); }
    for (const m of [s.min, s.max]) { for (const [l, e] of m) { m.set(l, { x: e.x + d, w: e.w }); } }
  };
  // Right-shift `s` so it clears `acc` at every shared layer, then fold `s` into `acc`.
  const placeRightOf = (acc: Sub, s: Sub): void => {
    let shift = 0;
    for (const [layer, hi] of acc.max) {
      const lo = s.min.get(layer);
      if (!lo) { continue; }
      shift = Math.max(shift, hi.x + (hi.w + lo.w) / 2 - lo.x);
    }
    if (shift > 0) { shiftSub(s, shift); }
    acc.ids.push(...s.ids);
    for (const [l, e] of s.min) { const lo = acc.min.get(l); if (!lo || e.x < lo.x) { acc.min.set(l, e); } }
    for (const [l, e] of s.max) { const hi = acc.max.get(l); if (!hi || e.x > hi.x) { acc.max.set(l, e); } }
  };

  const layout = (id: string): Sub => {
    claimed.add(id);
    const layer = layerOfId.get(id)!;
    const kids = (childrenByOccupant.get(id) ?? [])
      .filter(k => !claimed.has(k) && layerOfId.get(k) === layer + 1)
      .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

    if (kids.length === 0) {
      xById.set(id, 0);
      const s: Sub = { ids: [id], min: new Map(), max: new Map() };
      addToContour(s, layer, 0, widthOf(id));
      return s;
    }

    let acc: Sub | null = null;
    for (const k of kids) {
      const sub = layout(k);
      if (!acc) { acc = sub; } else { placeRightOf(acc, sub); }
    }
    const kxs = kids.map(k => xById.get(k)!);
    const px = (Math.min(...kxs) + Math.max(...kxs)) / 2;
    xById.set(id, px);
    acc!.ids.push(id);
    addToContour(acc!, layer, px, widthOf(id));
    return acc!;
  };

  // Grow a forest left-to-right: root first (claims its whole subtree), then any still-unclaimed
  // occupant (an unreachable node, or a second root) as its own subtree placed past the rest.
  let forest: Sub | null = null;
  for (const layer of [...layerOrder.keys()].sort((a, b) => a - b)) {
    if (layer < 0) { continue; }
    for (const id of layerOrder.get(layer) ?? []) {
      if (claimed.has(id)) { continue; }
      const sub = layout(id);
      if (!forest) { forest = sub; } else { placeRightOf(forest, sub); }
    }
  }

  // Normalise so the left-most box edge sits exactly at the margin (a constant shift preserves every
  // pairwise separation, so it can never introduce an overlap).
  if (xById.size > 0) {
    let minEdge = Infinity;
    for (const [id, x] of xById) { minEdge = Math.min(minEdge, x - widthOf(id) / 2); }
    const d = leftMargin - minEdge;
    if (d !== 0) { for (const [id, x] of xById) { xById.set(id, x + d); } }
  }
  return xById;
}
