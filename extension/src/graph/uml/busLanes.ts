/**
 * Bus-lane assignment shared by `layout.ts` (which sizes each transition's flow-gap to the number
 * of lanes a band needs) and `diagramGeometry.ts` (which places each bus at its lane's height).
 * Both call the SAME function on the SAME positions so the gap a layer reserves always matches the
 * lanes actually drawn — neither can drift from the other.
 *
 * A "bus" is one (parent, kind) group's horizontal line; its x-span runs from the parent's exit to
 * the far edge of its children. Historically every bus in a band got its own distinct height, so a
 * band with N buses always cost N lanes of vertical room — wasteful now that tidy-tree placement
 * (`assignTidyTreeCoordinates`) separates sibling parents horizontally, so most sibling buses no
 * longer overlap in x at all. Two buses that DON'T overlap can safely share one height: their
 * horizontal lines occupy disjoint x-ranges and never merge or cross. So lanes are assigned by
 * (interval-)graph colouring — a band costs only as many lanes as its MAXIMUM set of mutually
 * overlapping buses, which for a well-separated tree is usually just one. That is what lets the
 * caller compact the height between levels.
 */
export interface LaneSpan {
  key: string;
  /** composition vs generalization — the two kinds are never placed on the same height (see
   *  `collides`), so a subtype bus and a part-of bus always read as visually distinct levels. */
  kind: 'composition' | 'generalization';
  /** Left/right edge of this bus's horizontal span (parent exit x and children xs, min/max). */
  minX: number;
  maxX: number;
  /** Children this bus serves — two buses that share a child are a legitimate shared bus (fan-in),
   *  not a collision, so they may sit at the same height even when their spans overlap. */
  childIris: Set<string>;
}

/** Two buses collide (must take different lanes/heights) when EITHER they are of different kinds —
 *  a composition bus and a generalization bus are never allowed to share a height, so the two
 *  relationship types always read as separate levels — OR their horizontal spans overlap on a
 *  POSITIVE-length sub-interval (the only way two same-kind lines could actually merge into one).
 *  A mere endpoint touch, or a degenerate point-span (a parent directly above its single child has
 *  no horizontal bus, just a vertical stem that can cross but never merge), does not count. Buses
 *  that share a child are a legitimate shared bus (fan-in) and never collide. */
function collides(a: LaneSpan, b: LaneSpan): boolean {
  if (a.kind !== b.kind) { return true; }
  for (const c of a.childIris) { if (b.childIris.has(c)) { return false; } }
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0;
}

/**
 * Greedy lane colouring: process buses left-to-right by span start (ties broken by key for a stable,
 * position-independent result — spec FR-009) and give each the lowest lane not already taken by an
 * earlier bus it collides with. For interval spans this greedy order yields the optimum (lane count
 * = maximum overlap); the shared-child exception can only ever REMOVE a conflict, never add one, so
 * it never inflates the count. Returns each bus's 0-based lane.
 */
export function assignBusLanes(spans: LaneSpan[]): Map<string, number> {
  const ordered = [...spans].sort((a, b) => a.minX - b.minX || (a.key < b.key ? -1 : 1));
  const laneOf = new Map<string, number>();
  const placed: Array<{ span: LaneSpan; lane: number }> = [];
  for (const s of ordered) {
    const taken = new Set<number>();
    for (const p of placed) { if (collides(s, p.span)) { taken.add(p.lane); } }
    let lane = 0;
    while (taken.has(lane)) { lane++; }
    laneOf.set(s.key, lane);
    placed.push({ span: s, lane });
  }
  return laneOf;
}

/** Number of distinct lanes an assignment uses (0 for an empty band). */
export function laneCountOf(laneOf: Map<string, number>): number {
  let max = -1;
  for (const v of laneOf.values()) { max = Math.max(max, v); }
  return max + 1;
}
