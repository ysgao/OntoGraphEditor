import type { DiagramNode, DiagramEdge } from './diagramModel';

export interface NodeColor { fill: string; stroke: string; font: string; }

type ColorScheme = 'cool' | 'warm';

/** A fixed, categorical palette — reminiscent of the reference diagrams' hand-picked category
 *  colors (membrane/cavity/bone/muscle/mucosa/...), but assigned MECHANICALLY by branch position
 *  rather than by domain judgment (this tool makes no semantic classification of what a concept
 *  "is" — spec FR-004/FR-008 — so there is no principled way to know a node is "bone" vs
 *  "muscle"; assigning color by which top-level branch a node descends from is a structural,
 *  judgment-free proxy that still gives a UML diagram visually distinct, organized regions).
 *  Each entry is tagged 'cool' or 'warm' (curated once, by eye, against this specific fixed
 *  8-color set) so two branches that share a descendant (see `computeBranchColors`'s
 *  share-graph pass) can be pulled to opposite temperature schemes — a stronger, more
 *  perceptible contrast than just "two different hues" for the specific case a viewer most
 *  needs to notice: these two branches are NOT independent, they converge somewhere below. */
const PALETTE: Array<NodeColor & { scheme: ColorScheme }> = [
  { fill: '#DCEAE6', stroke: '#2F6F63', font: '#2F6F63', scheme: 'cool' }, // teal
  { fill: '#DDE6EA', stroke: '#4C6B7A', font: '#4C6B7A', scheme: 'cool' }, // blue-gray
  { fill: '#F1E3CB', stroke: '#96662B', font: '#96662B', scheme: 'warm' }, // ochre/tan
  { fill: '#F1DFD9', stroke: '#9E4A36', font: '#9E4A36', scheme: 'warm' }, // terracotta
  { fill: '#E7E1EB', stroke: '#6B5678', font: '#6B5678', scheme: 'cool' }, // purple
  { fill: '#F1DAC9', stroke: '#B15A2E', font: '#B15A2E', scheme: 'warm' }, // orange
  { fill: '#E1E8DC', stroke: '#5C7A52', font: '#5C7A52', scheme: 'cool' }, // olive-green
  { fill: '#EDE6C8', stroke: '#8A7B23', font: '#8A7B23', scheme: 'warm' }, // mustard
];

const COOL_PALETTE = PALETTE.filter(c => c.scheme === 'cool');
const WARM_PALETTE = PALETTE.filter(c => c.scheme === 'warm');

const ANCESTOR_COLOR: NodeColor = { fill: '#EFEFEF', stroke: '#8A8A8A', font: '#5A5A5A' };

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function averageChannel(colorList: NodeColor[], key: keyof NodeColor): string {
  const rgbs = colorList.map(c => hexToRgb(c[key]));
  const sum = rgbs.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
  return rgbToHex(sum[0] / rgbs.length, sum[1] / rgbs.length, sum[2] / rgbs.length);
}

/** Blends 2+ distinct parent colors into an in-between color found in neither parent's own
 *  palette entry, so a node shared between branches (FR-011 dual-relationship node) reads as
 *  visually distinct from a plain single-branch node sitting next to it. */
function blendColors(colorList: NodeColor[]): NodeColor {
  return {
    fill: averageChannel(colorList, 'fill'),
    stroke: averageChannel(colorList, 'stroke'),
    font: averageChannel(colorList, 'font'),
  };
}

/**
 * Assigns each node a color based on which of the root's direct DESCENDANT branches it falls
 * under (cycling through `PALETTE` for however many direct branches the root has). A node's own
 * color is derived from its DIRECT parents' already-resolved colors: exactly one distinct parent
 * color simply propagates down (so an entire branch reads as one consistent color), while a node
 * with two or more DIRECT parents carrying different colors (a subtype/part shared by more than
 * one branch) gets a blended, in-between color instead of silently inheriting just one of them —
 * this is what makes a shared node visually distinguishable from an ordinary, non-shared sibling
 * placed next to it (`layout.ts`'s shared-children sibling reordering already groups such nodes
 * adjacent to their sharing parents; color is the second, complementary signal for the same
 * relationship). Nodes reached only via the root's ANCESTOR direction (the one-hop, non-expanded
 * "context" nodes from `partOfGraph.ts`'s direct-ancestor pass) get a distinct neutral treatment
 * instead, since they aren't part of the root's own breakdown. The root itself is excluded
 * (rendered via the dedicated `isRoot` style in both renderers).
 *
 * Resolution runs as a fixed-point relaxation (not a single topological pass) because a part-of
 * cycle can put a node's "parent" at an arbitrary distance from the root — a strict distance- or
 * depth-based processing order isn't safe (a dual-relationship node's second, deeper-branch
 * parent might not yet be resolved when the shallower-branch parent's turn comes up). Each pass
 * recomputes every node's color from whichever of its direct parents are CURRENTLY resolved;
 * since a node's resolved set of parent colors only grows monotonically pass over pass, this
 * converges in at most as many passes as the longest parent-chain in the diagram. Nodes that
 * never gain a resolvable parent (an island cut off from every branch, only possible via a cycle
 * with no branch entry point) are left uncolored — both renderers already fall back to a default
 * neutral style for any node missing from this map.
 */
export function computeBranchColors(nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, NodeColor> {
  const colors = new Map<string, NodeColor>();
  const root = nodes.find(n => n.isRoot);
  if (!root) { return colors; }

  const childrenByParent = new Map<string, string[]>();
  const parentsByChild = new Map<string, string[]>();
  for (const e of edges) {
    let clist = childrenByParent.get(e.parentIri);
    if (!clist) { clist = []; childrenByParent.set(e.parentIri, clist); }
    if (!clist.includes(e.childIri)) { clist.push(e.childIri); }

    let plist = parentsByChild.get(e.childIri);
    if (!plist) { plist = []; parentsByChild.set(e.childIri, plist); }
    if (!plist.includes(e.parentIri)) { plist.push(e.parentIri); }
  }

  // Ancestors of the root (root is the CHILD in these edges) get a distinct neutral color and
  // are excluded entirely from branch propagation/merging.
  const ancestorIris = new Set<string>();
  for (const e of edges) {
    if (e.childIri === root.iri && e.parentIri !== root.iri) {
      colors.set(e.parentIri, ANCESTOR_COLOR);
      ancestorIris.add(e.parentIri);
    }
  }

  const directBranchRoots = (childrenByParent.get(root.iri) ?? []).filter(iri => !ancestorIris.has(iri));

  // Two branch roots "share subnodes" when their descendant subtrees overlap (some node is
  // reachable from both) — exactly the condition that later produces a blended shared node
  // below. Detected here, up front, via each branch root's own reachable-descendant set (BFS,
  // cycle-safe via a per-branch visited set) so root colors can be chosen with that knowledge,
  // rather than picked independently of it.
  function reachableDescendants(startIri: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startIri];
    while (queue.length > 0) {
      const iri = queue.shift()!;
      if (visited.has(iri)) { continue; }
      visited.add(iri);
      for (const child of childrenByParent.get(iri) ?? []) {
        if (!visited.has(child)) { queue.push(child); }
      }
    }
    return visited;
  }

  const reachSets = directBranchRoots.map(reachableDescendants);
  const sharesWith: number[][] = directBranchRoots.map(() => []);
  for (let i = 0; i < directBranchRoots.length; i++) {
    for (let j = i + 1; j < directBranchRoots.length; j++) {
      let overlaps = false;
      for (const iri of reachSets[i]) {
        if (reachSets[j].has(iri)) { overlaps = true; break; }
      }
      if (overlaps) { sharesWith[i].push(j); sharesWith[j].push(i); }
    }
  }

  // Pick a scheme per branch root: opposite of an already-decided sharing neighbor's scheme
  // where that's unambiguous; alternate for baseline variety otherwise (no sharing neighbor
  // yet, or neighbors already disagree — a 3-way mutual share can't be properly 2-colored, so
  // this is a best-effort, not a hard guarantee, in that rarer case).
  const schemes: ColorScheme[] = [];
  directBranchRoots.forEach((_iri, idx) => {
    const neighborSchemes = sharesWith[idx].filter(j => schemes[j] !== undefined).map(j => schemes[j]);
    const hasCool = neighborSchemes.includes('cool');
    const hasWarm = neighborSchemes.includes('warm');
    if (hasCool && !hasWarm) {
      schemes[idx] = 'warm';
    } else if (hasWarm && !hasCool) {
      schemes[idx] = 'cool';
    } else {
      schemes[idx] = idx % 2 === 0 ? 'cool' : 'warm';
    }
  });

  let coolCount = 0;
  let warmCount = 0;
  directBranchRoots.forEach((iri, idx) => {
    if (schemes[idx] === 'cool') {
      colors.set(iri, COOL_PALETTE[coolCount % COOL_PALETTE.length]);
      coolCount++;
    } else {
      colors.set(iri, WARM_PALETTE[warmCount % WARM_PALETTE.length]);
      warmCount++;
    }
  });

  const resolvableParentsOf = (iri: string): string[] =>
    (parentsByChild.get(iri) ?? []).filter(p => p !== root.iri && !ancestorIris.has(p));

  const directBranchRootSet = new Set(directBranchRoots);
  const maxPasses = nodes.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const n of nodes) {
      if (n.iri === root.iri || ancestorIris.has(n.iri) || directBranchRootSet.has(n.iri)) { continue; }
      const parentColors: NodeColor[] = [];
      for (const p of resolvableParentsOf(n.iri)) {
        const c = colors.get(p);
        if (c && !parentColors.includes(c)) { parentColors.push(c); }
      }
      if (parentColors.length === 0) { continue; }
      const resolved = parentColors.length === 1 ? parentColors[0] : blendColors(parentColors);
      if (colors.get(n.iri) !== resolved) {
        colors.set(n.iri, resolved);
        changed = true;
      }
    }
    if (!changed) { break; }
  }

  return colors;
}
