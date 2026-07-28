import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { promises as fsp } from 'fs';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';
import { extractUmlDiagram, extractInferredUmlDiagram } from '../uml/partOfGraph';
import { computeLayout } from '../uml/layout';
import { renderDrawio } from '../uml/drawioRenderer';
import { renderDiagramFragment, renderStandaloneSvg } from '../uml/htmlRenderer';
import { pickPngScale, exportPngViaDrawioCli } from '../uml/drawioCli';
import { applyNodeExclusions } from '../uml/nodeExclusion';
import type { ExclusionMode } from '../uml/nodeExclusion';
import type { DiagramNode, DiagramEdge, ExcludedRelation, LayoutDirection } from '../uml/diagramModel';
import type {
  UpdateDiagramMessage, WebviewToExt, ViewMode,
  RequestDiagramMessage, RequestDepthChangeMessage, RequestDirectionChangeMessage, RequestExportMessage,
  RequestRegenerateMessage, ResetExclusionsMessage, RequestToggleLateralizedMessage, RequestSetViewModeMessage,
} from '../views/UmlDiagramMessages';

// Singleton panel — reuse rather than open multiple, same convention as openVisualization.ts.
let panel: vscode.WebviewPanel | undefined;

// Mutable "what's currently shown" state, updated on every generateUmlDiagram() call. The
// message handler below reads from these (not from its own closure parameters) so that reusing
// the panel for a different focus entity doesn't leave the depth slider / 'ready' handshake
// acting on the PREVIOUS entity's stale focusIri/model/compositionProperties.
let currentModel: OntologyModel | undefined;
let currentFocusIri: string | undefined;
let currentDefaultDepth = 1;
let currentDefaultDirection: LayoutDirection = 'LR';
let currentCompositionProperties: string[] = [];

// User-marked-for-removal node IRIs, accumulated ACROSS repeated "Regenerate" clicks (never
// replaced by a later one — excluding more nodes must not un-exclude earlier ones) for the
// CURRENT focus entity. Applied on every subsequent depth change too, so pruning survives
// adjusting the depth slider. Reset only by an explicit "Reset exclusions" click, by a
// DIFFERENT entity becoming the focus (`isNewFocus` below), or by closing the panel
// (`onDidDispose` below) — never by Regenerate itself. Deliberately session-only, not persisted
// anywhere.
let currentExcludeIris: Set<string> = new Set();
let currentExclusionMode: ExclusionMode = 'subtree';

// Whether lateralized classes (own a "Laterality some Left/Right" restriction, see
// `partOfGraph.ts`'s `lateralizedIris`) are included in the diagram — false (hidden) by default
// for a fresh focus session, toggled on via the webview's "Show full subhierarchy" button
// (`requestToggleLateralized`). Independent of `currentExcludeIris`: resetting the user's manual
// exclusions (`resetExclusions`) does NOT touch this. Unlike a one-time seed into
// `currentExcludeIris`, this is consulted fresh on EVERY `extractAndLayout()` call — so the filter
// applies at whatever depth is currently shown, including a lateralized node that only becomes
// reachable after the user increases the depth slider, not just the ones visible at generation
// time.
let currentIncludeLateralized = false;

// Which of the two, mutually EXCLUSIVE views is shown (spec 032-uml-inferred-subtypes, second
// refinement: Stated and Inferred are never mixed into one diagram). 'stated' (asserted axioms
// only, via `extractUmlDiagram` — completely unchanged from before this feature existed) is the
// default for a fresh focus session. 'inferred' switches to a SEPARATE diagram built entirely from
// the reasoner's classified hierarchy (`extractInferredUmlDiagram`) — generalization-only, no
// composition/part-of, rooted at the focus entity directly (no "All or part of" anchor-hop).
// Switched via the webview's "Stated / Inferred" control (`requestSetViewMode`).
let currentViewMode: ViewMode = 'stated';

interface ExtractOptions {
  maxNodes?: number;
  preferredLang?: string;
  excludeIris?: ReadonlySet<string>;
  exclusionMode?: ExclusionMode;
  /** Layout flow direction (`src/uml/layout.ts`) — defaults to 'LR', the product-level default
   *  (`ontograph.umlDiagram.defaultDirection`), so a call site that omits it matches what a
   *  freshly opened UML diagram shows. */
  direction?: LayoutDirection;
  /** When false (the default), lateralized classes (and, in Inferred mode, "Entire X" classes —
   *  see `extractAndLayout`) are added to the effective exclusion set for THIS extraction, on top
   *  of whatever `excludeIris` the caller supplied — see `currentIncludeLateralized`. */
  includeLateralized?: boolean;
  /** Which view to extract — see `currentViewMode`. Defaults to `'stated'`. */
  viewMode?: ViewMode;
}

interface LaidOutDiagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  excludedRelations: ExcludedRelation[];
  nodeCapReached: boolean;
}

/** Extraction + layout only, shared by both the webview message builder and the file exporters
 *  so neither path can drift from the other. */
function extractAndLayout(
  model: OntologyModel,
  focusIri: string,
  depth: number,
  compositionProperties: string[],
  options: ExtractOptions = {},
): LaidOutDiagram {
  const extracted = options.viewMode === 'inferred'
    ? extractInferredUmlDiagram(model, focusIri, depth, { maxNodes: options.maxNodes, preferredLang: options.preferredLang })
    : extractUmlDiagram(model, focusIri, depth, { compositionProperties, maxNodes: options.maxNodes, preferredLang: options.preferredLang });

  const excludeIris = new Set(options.excludeIris ?? []);
  if (!options.includeLateralized) {
    for (const iri of extracted.lateralizedIris) { excludeIris.add(iri); }
    // "Entire X" classes are an Inferred-view-only default exclusion (Stated has no equivalent
    // concept — it anchors on/substitutes them instead, see `extractUmlDiagram`'s own handling).
    for (const iri of extracted.entireIris ?? []) { excludeIris.add(iri); }
  }

  const { nodes, edges } = excludeIris.size > 0
    ? applyNodeExclusions(extracted.nodes, extracted.edges, excludeIris, options.exclusionMode ?? 'subtree')
    : extracted;

  const layout = computeLayout(nodes, edges, options.direction ?? 'LR');
  const laidOutNodes = nodes.map(n => {
    const pos = layout.get(n.iri);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });

  return { nodes: laidOutNodes, edges, excludedRelations: extracted.excludedRelations, nodeCapReached: extracted.nodeCapReached };
}

/**
 * Pure: extraction + layout + HTML/SVG fragment rendering, producing the exact wire message the
 * webview consumes. Kept separate from any vscode.WebviewPanel side effects so it's directly
 * unit-testable (contracts/uml-diagram-messages.md's "Contract test expectations"). The webview
 * has no rendering logic of its own — `nodesHtml`/`svg` are injected directly via `innerHTML`,
 * computed here by `src/uml/htmlRenderer.ts` (mirrors the original hand-built prototypes'
 * static-HTML-fragment approach rather than a runtime graph-library API).
 */
export function buildDiagramMessage(
  model: OntologyModel,
  focusIri: string,
  depth: number,
  compositionProperties: string[],
  options: ExtractOptions = {},
): UpdateDiagramMessage {
  const direction = options.direction ?? 'LR';
  const { nodes, edges, excludedRelations, nodeCapReached } = extractAndLayout(model, focusIri, depth, compositionProperties, options);
  const { svg, nodesHtml, canvasWidth, canvasHeight } = renderDiagramFragment(nodes, edges, excludedRelations, direction);

  return {
    type: 'updateDiagram',
    nodes,
    edges,
    excludedRelations,
    focusIri,
    depth,
    direction,
    nodeCapReached,
    svg,
    nodesHtml,
    canvasWidth,
    canvasHeight,
    includeLateralized: options.includeLateralized ?? false,
    viewMode: options.viewMode ?? 'stated',
  };
}

function sendDiagram(
  p: vscode.WebviewPanel,
  model: OntologyModel,
  focusIri: string,
  depth: number,
  direction: LayoutDirection,
  compositionProperties: string[],
): void {
  const msg = buildDiagramMessage(model, focusIri, depth, compositionProperties, {
    excludeIris: currentExcludeIris,
    exclusionMode: currentExclusionMode,
    direction,
    includeLateralized: currentIncludeLateralized,
    viewMode: currentViewMode,
  });
  void p.webview.postMessage(msg);
}

/** Entry point for the `ontograph.generateUmlDiagram` command. */
export function generateUmlDiagram(
  context: vscode.ExtensionContext,
  model: OntologyModel | undefined,
  focusIri: string | undefined,
): void {
  if (!model) {
    void vscode.window.showWarningMessage('OntoGraph: No ontology loaded. Open an .ofn, .omn, or .owl file first.');
    return;
  }
  if (!focusIri || !model.classes.has(focusIri)) {
    void vscode.window.showWarningMessage('OntoGraph: Right-click a class to generate its UML diagram.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('ontograph');
  const isNewFocus = focusIri !== currentFocusIri;
  currentModel = model;
  currentFocusIri = focusIri;
  currentDefaultDepth = cfg.get<number>('umlDiagram.defaultDepth') ?? 1;
  currentDefaultDirection = cfg.get<LayoutDirection>('umlDiagram.defaultDirection') ?? 'LR';
  currentCompositionProperties = cfg.get<string[]>('umlDiagram.compositionProperties') ?? [];
  if (isNewFocus) {
    // Node exclusions are session-only for a given focus entity — switching to a different
    // entity starts with the full diagram again (lateralized classes still hidden by default,
    // per `currentIncludeLateralized`'s own reset below), not the previous entity's pruned view.
    currentExcludeIris = new Set();
    currentExclusionMode = 'subtree';
    currentIncludeLateralized = false;
    currentViewMode = 'stated';
  }

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    sendDiagram(panel, currentModel, currentFocusIri, currentDefaultDepth, currentDefaultDirection, currentCompositionProperties);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'ontograph.umlDiagramView',
    'OntoGraph UML Diagram',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = buildHtml(panel.webview, context.extensionUri);

  panel.onDidDispose(() => {
    panel = undefined;
    // Closing the diagram ends the exclusion "session" — reopening it later (even for the same
    // entity) starts from the full diagram again, per the same reasoning as the isNewFocus reset
    // above. Only an explicit "Reset exclusions" click or closing the panel brings excluded nodes
    // back; a plain Regenerate must NOT (see the accumulation in the requestRegenerate branch
    // below — excluded IRIs are additive across repeated Regenerate clicks within one session).
    currentExcludeIris = new Set();
    currentExclusionMode = 'subtree';
    currentIncludeLateralized = false;
    currentViewMode = 'stated';
  }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    (msg: WebviewToExt) => {
      if (!currentModel || !currentFocusIri) { return; }
      if (msg.type === 'ready' || msg.type === 'requestDiagram') {
        const depth = msg.type === 'requestDiagram' ? (msg as RequestDiagramMessage).depth : currentDefaultDepth;
        const direction = msg.type === 'requestDiagram' ? (msg as RequestDiagramMessage).direction : currentDefaultDirection;
        sendDiagram(panel!, currentModel, currentFocusIri, depth, direction, currentCompositionProperties);
      } else if (msg.type === 'requestDepthChange') {
        const r = msg as RequestDepthChangeMessage;
        sendDiagram(panel!, currentModel, r.iri, r.depth, r.direction, currentCompositionProperties);
      } else if (msg.type === 'requestDirectionChange') {
        const r = msg as RequestDirectionChangeMessage;
        sendDiagram(panel!, currentModel, r.iri, r.depth, r.direction, currentCompositionProperties);
      } else if (msg.type === 'requestExport') {
        const r = msg as RequestExportMessage;
        void exportUmlDiagram(currentModel, r.iri, r.format, r.depth, r.direction);
      } else if (msg.type === 'requestRegenerate') {
        const r = msg as RequestRegenerateMessage;
        // Additive, not a replace: a node excluded by an earlier Regenerate click must stay
        // excluded when the user marks and regenerates MORE nodes afterward. Only an explicit
        // "Reset exclusions" or closing the panel brings previously-excluded nodes back.
        for (const iri of r.excludeIris) { currentExcludeIris.add(iri); }
        currentExclusionMode = r.mode;
        sendDiagram(panel!, currentModel, r.iri, r.depth, r.direction, currentCompositionProperties);
      } else if (msg.type === 'resetExclusions') {
        const r = msg as ResetExclusionsMessage;
        currentExcludeIris = new Set();
        sendDiagram(panel!, currentModel, r.iri, r.depth, r.direction, currentCompositionProperties);
      } else if (msg.type === 'requestToggleLateralized') {
        const r = msg as RequestToggleLateralizedMessage;
        currentIncludeLateralized = r.include;
        sendDiagram(panel!, currentModel, r.iri, r.depth, r.direction, currentCompositionProperties);
      } else if (msg.type === 'requestSetViewMode') {
        const r = msg as RequestSetViewModeMessage;
        currentViewMode = r.mode;
        sendDiagram(panel!, currentModel, r.iri, r.depth, r.direction, currentCompositionProperties);
      } else if (msg.type === 'nodeClicked') {
        // intentional no-op — reserved for future navigation, not required for v1
      }
    },
    undefined,
    context.subscriptions,
  );
}

export type ExportFormat = 'drawio' | 'svg' | 'png';

const EXPORT_FORMATS: Record<ExportFormat, { ext: string; filterLabel: string; title: string }> = {
  drawio: { ext: 'drawio', filterLabel: 'draw.io Diagram', title: 'Export UML Diagram to draw.io' },
  svg: { ext: 'svg', filterLabel: 'SVG Image', title: 'Export UML Diagram to SVG' },
  png: { ext: 'png', filterLabel: 'PNG Image', title: 'Export UML Diagram to PNG' },
};

function fileBaseFor(model: OntologyModel, focusIri: string, preferredLang: string): string {
  const focusLabel = getLabel(model.classes.get(focusIri)!, preferredLang);
  return focusLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uml-diagram';
}

async function promptSaveLocation(model: OntologyModel, focusIri: string, format: ExportFormat, preferredLang: string): Promise<vscode.Uri | undefined> {
  const fileBase = fileBaseFor(model, focusIri, preferredLang);
  const srcUri = vscode.Uri.parse(model.sourceUri);
  const srcDir = path.dirname(srcUri.fsPath);
  const { ext, filterLabel, title } = EXPORT_FORMATS[format];
  const defaultUri = vscode.Uri.file(path.join(srcDir, `${fileBase}-uml.${ext}`));

  return vscode.window.showSaveDialog({ defaultUri, filters: { [filterLabel]: [ext] }, title });
}

async function offerSaveComplete(fsPath: string): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    `OntoGraph: Exported UML diagram to ${path.basename(fsPath)}`,
    'Open File',
  );
  if (action === 'Open File') {
    void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fsPath));
  }
}

/**
 * Extracts + lays out the same diagram data the webview would show, renders it in the requested
 * file format, and prompts the user to save it. Shared by the `ontograph.exportUmlDiagramDrawio`/
 * `...Svg`/`...Png` commands and the webview's toolbar export buttons (`requestExport` message)
 * so every path produces byte-identical output for the same focus entity/depth.
 *
 * PNG export shells out to the local draw.io desktop CLI with `--embed-diagram`
 * (`src/uml/drawioCli.ts`) — a `.drawio` file is not itself sufficient, so this is NOT a pure
 * "render then write" path like drawio/SVG: it writes a temporary `.drawio` file, invokes the
 * CLI, and cleans up, falling back to a clear error (with an offer to export `.drawio` instead)
 * if the CLI isn't found rather than failing silently (spec §8.1).
 */
export async function exportUmlDiagram(
  model: OntologyModel | undefined,
  focusIri: string | undefined,
  format: ExportFormat,
  depthOverride?: number,
  directionOverride?: LayoutDirection,
): Promise<void> {
  if (!model) {
    void vscode.window.showWarningMessage('OntoGraph: No ontology loaded. Open an .ofn, .omn, or .owl file first.');
    return;
  }
  if (!focusIri || !model.classes.has(focusIri)) {
    void vscode.window.showWarningMessage('OntoGraph: Right-click a class to export its UML diagram.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('ontograph');
  const depth = depthOverride ?? cfg.get<number>('umlDiagram.defaultDepth') ?? 1;
  const direction = directionOverride ?? cfg.get<LayoutDirection>('umlDiagram.defaultDirection') ?? 'LR';
  const compositionProperties = cfg.get<string[]>('umlDiagram.compositionProperties') ?? [];
  const preferredLang = cfg.get<string>('display.preferredLabelLanguage') ?? 'en';

  // Only inherit the current exclusion set when exporting the SAME entity currently tracked/open
  // in the webview — exporting a different entity via the command palette (without ever opening
  // its diagram) must not silently apply another entity's leftover exclusions.
  const isCurrentFocus = focusIri === currentFocusIri;
  const { nodes, edges, excludedRelations } = extractAndLayout(model, focusIri, depth, compositionProperties, {
    excludeIris: isCurrentFocus ? currentExcludeIris : undefined,
    exclusionMode: isCurrentFocus ? currentExclusionMode : undefined,
    direction,
    includeLateralized: isCurrentFocus ? currentIncludeLateralized : false,
    viewMode: isCurrentFocus ? currentViewMode : 'stated',
  });

  if (format === 'png') {
    const saveUri = await promptSaveLocation(model, focusIri, format, preferredLang);
    if (!saveUri) { return; }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'OntoGraph: Exporting UML diagram to PNG…', cancellable: false },
      async () => {
        const xml = renderDrawio(nodes, edges, excludedRelations, direction);
        const { canvasWidth } = renderDiagramFragment(nodes, edges, excludedRelations, direction);
        const tempPath = path.join(os.tmpdir(), `ontograph-uml-${Math.random().toString(36).slice(2)}.drawio`);
        await fsp.writeFile(tempPath, xml, 'utf-8');

        try {
          const result = await exportPngViaDrawioCli(tempPath, saveUri.fsPath, pickPngScale(canvasWidth));
          if (!result.success) {
            const action = await vscode.window.showErrorMessage(
              'OntoGraph: PNG export failed — is draw.io desktop installed? '
              + '(https://www.diagrams.net/, macOS default path /Applications/draw.io.app)',
              'Export as draw.io instead',
            );
            if (action) { await exportUmlDiagram(model, focusIri, 'drawio', depth, direction); }
            return;
          }
          await offerSaveComplete(saveUri.fsPath);
        } finally {
          await fsp.unlink(tempPath).catch(() => { /* best-effort cleanup */ });
        }
      },
    );
    return;
  }

  const content = format === 'drawio'
    ? renderDrawio(nodes, edges, excludedRelations, direction)
    : renderStandaloneSvg(nodes, edges, excludedRelations, direction);

  const saveUri = await promptSaveLocation(model, focusIri, format, preferredLang);
  if (!saveUri) { return; }

  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));
  await offerSaveComplete(saveUri.fsPath);
}

/** Entry point for the `ontograph.exportUmlDiagramDrawio` command. */
export async function exportUmlDiagramDrawio(
  model: OntologyModel | undefined,
  focusIri: string | undefined,
): Promise<void> {
  await exportUmlDiagram(model, focusIri, 'drawio');
}

/** Entry point for the `ontograph.exportUmlDiagramSvg` command. */
export async function exportUmlDiagramSvg(
  model: OntologyModel | undefined,
  focusIri: string | undefined,
): Promise<void> {
  await exportUmlDiagram(model, focusIri, 'svg');
}

/** Entry point for the `ontograph.exportUmlDiagramPng` command. */
export async function exportUmlDiagramPng(
  model: OntologyModel | undefined,
  focusIri: string | undefined,
): Promise<void> {
  await exportUmlDiagram(model, focusIri, 'png');
}

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'uml-diagram-webview.js'),
  );
  const nonce = getNonce();

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             style-src ${webview.cspSource} 'unsafe-inline';
             img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OntoGraph UML Diagram</title>
  <style>html,body{height:100%;margin:0;overflow:hidden;}</style>
</head>
<body>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
