import type { DiagramNode, DiagramEdge, ExcludedRelation, LayoutDirection } from './diagramModel';
import { pickConnectionFractions, computeEdgeRoutes, boxRect } from './diagramGeometry';
import type { Position, ConnectionFractions, EdgeRoute } from './diagramGeometry';
import { computeBranchColors } from './branchColors';
import type { NodeColor } from './branchColors';
import { computeFarEdgeRoutes } from './layout';

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;

/**
 * Escapes `&`, `<`, `>`, `"` in that order (escape `&` first, or a later-escaped `&amp;`
 * would itself get re-escaped into `&amp;amp;`) — the exact gotcha called out in
 * `uml-diagram-generation-spec.md` §8.1.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type { Position };
export type ConnectionPoints = ConnectionFractions;

/**
 * Picks the mxGraph connection-point pair for an edge between two positioned nodes. Delegates to
 * `diagramGeometry.ts`'s `pickConnectionFractions` so the drawio renderer and the HTML/SVG
 * renderer agree on edge direction for the same data — both need this because an ancestor edge
 * can legitimately have its "parent" positioned BELOW its "child" in the tidy layout (spec §8.1:
 * "get the direction right by checking which node is up-left or down-right of the other, not by
 * guessing").
 */
export function pickConnectionPoints(source: Position, target: Position): ConnectionPoints {
  return pickConnectionFractions(source, target);
}

const ROOT_COLOR: NodeColor = { fill: '#CFE8FA', stroke: '#1F6FA0', font: '#1F6FA0' };
const DEFAULT_COLOR: NodeColor = { fill: '#DDE6EA', stroke: '#4C6B7A', font: '#4C6B7A' };

function nodeStyle(n: DiagramNode, branchColors: Map<string, NodeColor>): string {
  const { fill, stroke: baseStroke, font } = n.isRoot ? ROOT_COLOR : (branchColors.get(n.iri) ?? DEFAULT_COLOR);
  let stroke = baseStroke;
  let extra = '';

  // hasHiddenRelations overrides the branch stroke color — this semantic indicator ("more exists
  // beyond depth/cap") must show through regardless of which branch a node belongs to.
  if (n.hasHiddenRelations) {
    stroke = '#E8A800'; extra = 'dashed=1;dashPattern=6 4;';
  }

  return `rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};`
    + `strokeWidth=1.5;fontColor=${font};fontSize=12;fontStyle=1;fontFamily=Helvetica;`
    + `align=center;verticalAlign=middle;${extra}`;
}

function edgeStyle(
  kind: 'composition' | 'generalization', points: ConnectionPoints, far: boolean, strokeColor: string, isInferred?: boolean,
): string {
  // No `edgeStyle=` key here (deliberately): mxGraph's `orthogonalEdgeStyle` computes its own
  // route between the fixed exit/entry points with no notion of sibling boxes, and would
  // happily draw a line straight through an unrelated node — the reported "edges overlap the
  // class boxes" bug. Leaving edgeStyle unset makes mxGraph draw straight segments through the
  // explicit `<Array as="points">` waypoints this renderer supplies instead (see renderDrawio),
  // which are the same elbow points the HTML/SVG renderer uses to route around boxes.
  // `far` (a dual-relationship edge spanning several rows/columns, see EdgeRoute.far) gets the
  // same dash style `nodeStyle()` uses for `hasHiddenRelations`, for visual-language consistency
  // between "this box has more hidden relations" and "this edge is a distant/secondary one".
  // `isInferred` (spec 032-uml-inferred-subtypes) is a DIFFERENT concept — routing distance vs.
  // axiom provenance, which can co-occur on the same edge — so it gets its own, visually and
  // programmatically distinct dash pattern (`3 3`, tighter than `far`'s `6 4`) rather than
  // reusing it; `far` takes precedence in the (rare) case both apply, since a far edge already
  // reads as dashed and a second pattern on the exact same line would be redundant/confusing.
  const base = 'rounded=0;html=1;fontSize=10;fontColor=#4B564F;'
    + (far ? 'dashed=1;dashPattern=6 4;' : isInferred ? 'dashed=1;dashPattern=3 3;' : '');
  // `strokeColor` is the connected node's own border colour (see renderDrawio) so the line — and,
  // since draw.io tints arrowheads by strokeColor, its diamond/triangle too — matches the box it
  // leads to. startSize/endSize=10 (down from an earlier 16) matches draw.io's own, noticeably
  // smaller default arrowhead size — mirrored by htmlRenderer.ts's SVG_DEFS marker scale-down so
  // the webview/SVG export and this drawio export read as the same diagram.
  const arrows = kind === 'composition'
    ? `startArrow=diamondThin;startFill=1;startSize=10;endArrow=none;strokeColor=${strokeColor};strokeWidth=1.5;`
    : `endArrow=block;endFill=0;endSize=10;startArrow=none;strokeColor=${strokeColor};strokeWidth=1.5;`;
  const conn = `exitX=${points.exitX};exitY=${points.exitY};exitDx=0;exitDy=0;`
    + `entryX=${points.entryX};entryY=${points.entryY};entryDx=0;entryDy=0;`;
  return base + arrows + conn;
}

/**
 * Renders a UML diagram (nodes with layout positions, edges, excluded relations) as draw.io's
 * native mxGraph XML — the same format produced by the original hand-built prototypes
 * (`uml-diagram-cli-plan/gen_drawio.py`), so the output opens as a fully editable diagram in
 * draw.io/diagrams.net and is the basis for later SVG/PNG export (spec §8.1).
 *
 * `excludedRelations` is accepted for signature parity with the HTML/SVG renderers but
 * intentionally NOT rendered here — the "Excluded relationships" notes are an interactive
 * webview affordance (`src/uml/htmlRenderer.ts`'s `renderExcludedNotes`), not part of the
 * diagram itself; an exported file (drawio/SVG/PNG) contains only the diagram.
 */
export function renderDrawio(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  excludedRelations: ExcludedRelation[],
  direction: LayoutDirection = 'TB',
): string {
  void excludedRelations;
  const cellId = new Map<string, string>();
  nodes.forEach((n, i) => cellId.set(n.iri, `n${i}`));
  const branchColors = computeBranchColors(nodes, edges);

  const cells: string[] = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />'];

  for (const n of nodes) {
    const value = escapeXml(n.label);
    const { left: x, top: y } = boxRect({ x: n.x ?? 0, y: n.y ?? 0 }, direction, NODE_WIDTH, NODE_HEIGHT);
    cells.push(
      `<mxCell id="${cellId.get(n.iri)}" value="${value}" style="${nodeStyle(n, branchColors)}" vertex="1" parent="1">`
      + `<mxGeometry x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" as="geometry" /></mxCell>`,
    );
  }

  const positions = new Map(nodes.map(n => [n.iri, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const farEdgeRoutes = computeFarEdgeRoutes(nodes, edges, direction);
  const routes = computeEdgeRoutes(positions, edges, NODE_WIDTH, NODE_HEIGHT, direction, farEdgeRoutes);
  let eid = 1000;
  for (const e of edges) {
    const route = routes.get(e.id);
    if (!route) { continue; } // defensive: never emit a dangling edge
    const sourceId = cellId.get(route.sourceIri);
    const targetId = cellId.get(route.targetIri);
    if (!sourceId || !targetId) { continue; }

    // Colour the edge by its `colorIri` node's border shade (target when a single target, source
    // when it fans out) so a viewer can trace where it goes — see `computeEdgeSegments`/
    // `htmlRenderer.ts`. Falls back to the per-kind default when the node has no branch colour.
    const colorNode = nodes.find(n => n.iri === route.colorIri);
    const kindDefault = e.kind === 'composition' ? '#7C8A80' : '#3A3F3B';
    const strokeColor = colorNode
      ? (colorNode.isRoot ? ROOT_COLOR.stroke : (branchColors.get(colorNode.iri) ?? DEFAULT_COLOR).stroke)
      : kindDefault;

    const waypoints = route.points.map(p => `<mxPoint x="${p.x}" y="${p.y}" />`).join('');
    cells.push(
      `<mxCell id="e${eid}" style="${edgeStyle(e.kind, route, route.far, strokeColor, e.isInferred)}" edge="1" parent="1" `
      + `source="${sourceId}" target="${targetId}"><mxGeometry relative="1" as="geometry">`
      + `<Array as="points">${waypoints}</Array></mxGeometry></mxCell>`,
    );
    eid++;
  }

  const rootXml = cells.join('\n        ');

  return `<mxfile host="app.diagrams.net" agent="ontograph-lite" version="24.0.0">
  <diagram name="UML Diagram" id="uml-diagram">
    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        ${rootXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}
