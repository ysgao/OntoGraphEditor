import type { DiagramNode, DiagramEdge, ExcludedRelation, LayoutDirection } from './diagramModel';
import { computeEdgeSegments, boxRect } from './diagramGeometry';
import { computeBranchColors } from './branchColors';
import type { NodeColor } from './branchColors';
import { computeFarEdgeRoutes } from './layout';

const ROOT_COLOR: NodeColor = { fill: '#CFE8FA', stroke: '#1F6FA0', font: '#1F6FA0' };
const DEFAULT_COLOR: NodeColor = { fill: '#DDE6EA', stroke: '#4C6B7A', font: '#4C6B7A' };

function colorFor(n: DiagramNode, branchColors: Map<string, NodeColor>): NodeColor {
  if (n.isRoot) { return ROOT_COLOR; }
  return branchColors.get(n.iri) ?? DEFAULT_COLOR;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const MARGIN = 60;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders excluded relationships as a text-only notes section BELOW the diagram content — never
 * attached to the owning class's box. Positioned in the same absolute coordinate space as the
 * diagram nodes (this webview has no separate document-flow area outside the canvas), starting
 * `diagramBottom + MARGIN` below the lowest node. Returns `height: 0` and empty markup when there
 * is nothing to report, so callers can skip the extra canvas space entirely.
 */
function renderExcludedNotes(excludedRelations: ExcludedRelation[], diagramBottom: number): { html: string; height: number } {
  if (excludedRelations.length === 0) { return { html: '', height: 0 }; }

  const startY = diagramBottom + MARGIN;
  const lineHeight = 18;
  const headerHeight = 22;

  const header = `<div class="dnote-header" style="position:absolute;left:${MARGIN}px;top:${startY}px;">`
    + 'Excluded relationships (not shown above — property not configured as composition)</div>';
  const lines = excludedRelations.map((r, i) => {
    const y = startY + headerHeight + i * lineHeight;
    const text = `${escapeHtml(r.fromLabel)} — ${escapeHtml(r.propertyLabel)} → ${escapeHtml(r.targetLabel)}`;
    return `<div class="dnote-line" style="position:absolute;left:${MARGIN}px;top:${y}px;">${text}</div>`;
  }).join('');

  const height = headerHeight + excludedRelations.length * lineHeight + MARGIN;
  return { html: header + lines, height };
}

// markerWidth/markerHeight are scaled down from the viewBox (~0.6x) to match draw.io's own,
// noticeably smaller default arrowhead size (`drawioRenderer.ts`'s startSize/endSize=10 below) —
// the viewBox/path/refX/refY stay in their original coordinate system; only the box the browser
// scales that artwork into shrinks, so the diamond/triangle shape itself is unchanged, just smaller.
// The marker paths use `context-stroke` (the stroke colour of the edge that references the marker)
// so the diamond/triangle at the hub end matches the colour of its own line — which is now the
// connected node's colour (see `renderDiagramFragment`). `context-stroke`/`context-fill` are
// supported in the Chromium webview and in browsers where an exported .svg opens; the PNG export
// path renders from draw.io (which tints its own arrowheads by strokeColor), not from this SVG, so
// nothing in the production pipeline depends on a renderer that lacks `context-stroke`. The diamond
// stays filled (composition) and the triangle stays hollow (generalization).
const SVG_DEFS = `
  <defs>
    <marker id="diamond" viewBox="0 0 20 12" markerWidth="12" markerHeight="7.2" refX="19" refY="6" orient="auto-start-reverse">
      <path d="M1,6 L10,1 L19,6 L10,11 Z" fill="context-stroke" stroke="context-stroke" stroke-width="0.75" />
    </marker>
    <marker id="triangle" viewBox="0 0 18 16" markerWidth="10.8" markerHeight="9.6" refX="17" refY="8" orient="auto">
      <path d="M1,1 L17,8 L1,15 Z" fill="var(--uml-generalization-fill, #F7F9F7)" stroke="context-stroke" stroke-width="1.2" />
    </marker>
  </defs>`;

export interface DiagramFragment {
  /** The `<svg>` edge-overlay markup, matching `uml-diagram-cli-plan/gen_html_diagram.py`'s
   *  shared-bus edge conventions (`src/uml/diagramGeometry.ts`). */
  svg: string;
  /** Absolutely-positioned node `<div>` markup, one per node, each tagged `data-iri` for the
   *  webview to wire up click delegation without needing per-node listeners. */
  nodesHtml: string;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Renders a UML diagram as a self-contained HTML fragment — absolutely-positioned node `<div>`s
 * plus one `<svg>` edge overlay — matching the original hand-built prototype's exact conventions
 * (`uml-diagram-cli-plan/gen_html_diagram.py`, `gen_html_diagram_liver.py`): composition renders
 * as a filled diamond marker, generalization as a hollow triangle, both placed via
 * `diagramGeometry.ts`'s shared-bus routing so N siblings share one elbow rather than drawing N
 * independent lines. Computed entirely on the extension host (`src/commands/generateUmlDiagram.ts`)
 * and sent to the webview as a ready-to-inject string — the webview has no rendering logic of its
 * own beyond `innerHTML` assignment and event delegation, avoiding any src/webview-src import
 * boundary question.
 */
export function renderDiagramFragment(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  excludedRelations: ExcludedRelation[],
  direction: LayoutDirection = 'TB',
): DiagramFragment {
  const positions = new Map(nodes.map(n => [n.iri, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const farEdgeRoutes = computeFarEdgeRoutes(nodes, edges, direction);
  const segments = computeEdgeSegments(positions, edges, NODE_WIDTH, NODE_HEIGHT, direction, farEdgeRoutes);
  const branchColors = computeBranchColors(nodes, edges);
  const nodeByIri = new Map(nodes.map(n => [n.iri, n]));

  const paths = segments.map(seg => {
    // Draw each edge in its `colorIri` node's colour — the target when a bus goes to one node, the
    // source (parent) when it fans out to several — so a viewer can follow a line to the box it
    // connects to. Use the node's border/stroke shade (same hue as its background but legible as a
    // thin line, unlike the very light fill), falling back to the per-kind default colour when the
    // node has no assigned branch colour.
    const kindDefault = seg.kind === 'composition' ? 'var(--uml-composition-color, #8A9990)' : 'var(--uml-generalization-color, #3A3F3B)';
    const node = seg.colorIri ? nodeByIri.get(seg.colorIri) : undefined;
    const stroke = node ? colorFor(node, branchColors).stroke : kindDefault;
    const marker = seg.marker === 'start' ? 'marker-start="url(#diamond)"'
      : seg.marker === 'end' ? 'marker-end="url(#triangle)"'
        : '';
    // A "far" (dual-relationship) edge spans several rows/columns by construction — dashing it
    // signals that length is an intentional secondary relationship, not a layout glitch.
    // `isInferred` (spec 032-uml-inferred-subtypes) is a different concept — axiom provenance, not
    // routing distance — so it gets its own, distinct pattern rather than reusing `far`'s; `far`
    // wins if both apply (a far edge already reads as dashed; two patterns on one line would just
    // be visual noise).
    const dash = seg.far ? 'stroke-dasharray="6 4" ' : seg.isInferred ? 'stroke-dasharray="3 3" ' : '';
    return `<path d="${seg.d}" fill="none" stroke="${stroke}" stroke-width="1.6" ${dash}${marker} />`;
  }).join('');

  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    const rect = boxRect({ x: n.x ?? 0, y: n.y ?? 0 }, direction, NODE_WIDTH, NODE_HEIGHT);
    maxX = Math.max(maxX, rect.left + NODE_WIDTH);
    maxY = Math.max(maxY, rect.top + NODE_HEIGHT);
  }
  const diagramWidth = Math.ceil(maxX + MARGIN);
  const diagramBottom = Math.ceil(maxY + MARGIN);
  const notes = renderExcludedNotes(excludedRelations, diagramBottom);
  const canvasWidth = diagramWidth;
  const canvasHeight = diagramBottom + notes.height;

  const svg = `<svg class="edge-layer" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">${SVG_DEFS}${paths}</svg>`;

  const nodesHtml = nodes.map(n => {
    const classes = ['dnode'];
    if (n.isRoot) { classes.push('dnode-root'); }
    if (n.hasHiddenRelations) { classes.push('dnode-hidden'); }

    const label = `<div class="dlabel">${escapeHtml(n.label)}</div>`;

    const { fill, stroke, font } = colorFor(n, branchColors);
    const { left: x, top: y } = boxRect({ x: n.x ?? 0, y: n.y ?? 0 }, direction, NODE_WIDTH, NODE_HEIGHT);
    // background/border/text color come from the branch palette inline; hasHiddenRelations's
    // border STYLE + COLOR override is `!important` in the webview's stylesheet so that semantic
    // indicator always shows through regardless of branch color.
    return `<div class="${classes.join(' ')}" data-iri="${escapeHtml(n.iri)}" `
      + `style="left:${x}px;top:${y}px;width:${NODE_WIDTH}px;height:${NODE_HEIGHT}px;`
      + `background-color:${fill};border-color:${stroke};color:${font};">${label}</div>`;
  }).join('\n');

  return { svg, nodesHtml: nodesHtml + notes.html, canvasWidth, canvasHeight };
}

/**
 * Renders a UML diagram as a single, standalone, well-formed `<svg>` document — nodes as
 * `<rect>`/`<text>` (not HTML `<div>`s, which can't appear in a `.svg` file) — for the
 * "Export UML Diagram to SVG" command. Reuses the exact same `diagramGeometry.ts` edge routing
 * as `renderDiagramFragment` so the exported file matches what the webview showed.
 *
 * `excludedRelations` is accepted for signature parity with `renderDiagramFragment` but
 * intentionally NOT rendered here — the "Excluded relationships" notes are an interactive
 * webview affordance, not part of the diagram itself; an exported SVG file contains only the
 * diagram, same as the drawio/PNG exports.
 */
export function renderStandaloneSvg(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  excludedRelations: ExcludedRelation[],
  direction: LayoutDirection = 'TB',
): string {
  void excludedRelations;
  const positions = new Map(nodes.map(n => [n.iri, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const farEdgeRoutes = computeFarEdgeRoutes(nodes, edges, direction);
  const segments = computeEdgeSegments(positions, edges, NODE_WIDTH, NODE_HEIGHT, direction, farEdgeRoutes);
  const branchColors = computeBranchColors(nodes, edges);
  const nodeByIri = new Map(nodes.map(n => [n.iri, n]));

  const paths = segments.map(seg => {
    // Colour each edge by its `colorIri` node's border shade — see `renderDiagramFragment`.
    const kindDefault = seg.kind === 'composition' ? '#8A9990' : '#3A3F3B';
    const node = seg.colorIri ? nodeByIri.get(seg.colorIri) : undefined;
    const stroke = node ? colorFor(node, branchColors).stroke : kindDefault;
    const marker = seg.marker === 'start' ? 'marker-start="url(#diamond)"'
      : seg.marker === 'end' ? 'marker-end="url(#triangle)"'
        : '';
    const dash = seg.far ? 'stroke-dasharray="6 4" ' : seg.isInferred ? 'stroke-dasharray="3 3" ' : '';
    return `<path d="${seg.d}" fill="none" stroke="${stroke}" stroke-width="1.6" ${dash}${marker} />`;
  }).join('');

  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    const rect = boxRect({ x: n.x ?? 0, y: n.y ?? 0 }, direction, NODE_WIDTH, NODE_HEIGHT);
    maxX = Math.max(maxX, rect.left + NODE_WIDTH);
    maxY = Math.max(maxY, rect.top + NODE_HEIGHT);
  }
  const width = Math.ceil(maxX + MARGIN);
  const height = Math.ceil(maxY + MARGIN);

  const rects = nodes.map(n => {
    const { fill, stroke, font } = colorFor(n, branchColors);
    const rect = boxRect({ x: n.x ?? 0, y: n.y ?? 0 }, direction, NODE_WIDTH, NODE_HEIGHT);
    const dash = n.hasHiddenRelations ? ' stroke-dasharray="6 4"' : '';
    return `<rect x="${rect.left}" y="${rect.top}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" `
      + `fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash} />`
      + `<text x="${rect.centerX}" y="${rect.centerY + 4}" text-anchor="middle" font-size="12" font-weight="bold" `
      + `font-family="Helvetica" fill="${font}">${escapeHtml(n.label)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + SVG_DEFS + paths + rects + '</svg>';
}
