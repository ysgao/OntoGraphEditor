import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';
import type {
  GraphNode, GraphEdge,
  UpdateGraphMessage, WebviewToExt,
  RequestNeighborhoodMessage,
} from '../views/GraphViewMessages';

const OWL_THING = 'http://www.w3.org/2002/07/owl#Thing';
const MAX_NODES = 200;

// Singleton panel — reuse rather than open multiple
let panel: vscode.WebviewPanel | undefined;

// ── Entry point ───────────────────────────────────────────────────────────────

export function openGraphView(
  context: vscode.ExtensionContext,
  model: OntologyModel | undefined,
  focusIri?: string,
): void {
  if (!model) {
    void vscode.window.showWarningMessage('OntoGraph: No ontology loaded. Open an .ofn, .omn, or .owl file first.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('ontograph');
  const preferredLang = cfg.get<string>('display.preferredLabelLanguage') ?? 'en';
  const defaultDepth  = cfg.get<number>('graph.defaultDepth') ?? 1;

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    sendGraph(panel, model, focusIri, defaultDepth, { showInferred: true, showDisjoint: false }, preferredLang);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'ontograph.graphView',
    'OntoGraph Graph',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = buildHtml(panel.webview, context.extensionUri);

  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    (msg: WebviewToExt) => {
      if (msg.type === 'ready') {
        sendGraph(panel!, model, focusIri, defaultDepth, { showInferred: true, showDisjoint: false }, preferredLang);
      } else if (msg.type === 'nodeClicked') {
        const sctid = /\/id\/(\d+)$/.exec(msg.iri)?.[1];
        const id = sctid ?? msg.iri;
        vscode.commands.executeCommand(
          'ontographEditor.ipcRoute',
          { command: 'GRAPH_NODE_SELECT', payload: { id } }
        ).then(undefined, () => {});
      } else if (msg.type === 'requestNeighborhood') {
        const r = msg as RequestNeighborhoodMessage;
        sendGraph(panel!, model, r.iri, r.depth, { showInferred: r.showInferred, showDisjoint: r.showDisjoint }, preferredLang);
      }
    },
    undefined,
    context.subscriptions,
  );
}

/** Update the graph panel when the model changes (called from extension.ts) */
export function updateGraphPanel(
  model: OntologyModel,
  focusIri?: string,
  preferredLang = 'en',
): void {
  if (!panel) { return; }
  sendGraph(panel, model, focusIri, 2, { showInferred: true, showDisjoint: false }, preferredLang);
}

// ── Graph data extraction ─────────────────────────────────────────────────────

interface GraphOpts {
  showInferred: boolean;
  showDisjoint: boolean;
}

function sendGraph(
  p: vscode.WebviewPanel,
  model: OntologyModel,
  focusIri: string | undefined,
  depth: number,
  opts: GraphOpts,
  preferredLang: string,
): void {
  const { nodes, edges } = buildGraphData(model, focusIri, depth, opts, preferredLang);
  const msg: UpdateGraphMessage = { type: 'updateGraph', nodes, edges, focusIri };
  void p.webview.postMessage(msg);
}

function buildGraphData(
  model: OntologyModel,
  focusIri: string | undefined,
  depth: number,
  opts: GraphOpts,
  preferredLang: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {

  // Build reverse index: superIri → Set<subIri> (asserted)
  const assertedChildren = new Map<string, Set<string>>();
  for (const cls of model.classes.values()) {
    for (const sup of cls.superClassIris) {
      if (!assertedChildren.has(sup)) { assertedChildren.set(sup, new Set()); }
      assertedChildren.get(sup)!.add(cls.iri);
    }
  }

  // Determine the root set
  let startIris: Set<string>;
  if (focusIri && (model.classes.has(focusIri) || model.objectProperties.has(focusIri) || model.individuals.has(focusIri))) {
    startIris = new Set([focusIri]);
  } else {
    // No focus: show top-level classes (direct children of owl:Thing or all if small)
    if (model.classes.size <= MAX_NODES) {
      startIris = new Set(model.classes.keys());
    } else {
      // Large ontology: use asserted children of owl:Thing as starting set
      const topClasses = assertedChildren.get(OWL_THING) ?? new Set<string>();
      startIris = topClasses.size > 0 ? topClasses : new Set([...model.classes.keys()].slice(0, 20));
    }
  }

  // BFS neighborhood collection
  const nodeIris = new Set<string>(startIris);
  const edgeMap = new Map<string, GraphEdge>();

  let frontier = new Set<string>(startIris);

  const addEdge = (e: GraphEdge): void => {
    if (!edgeMap.has(e.id)) { edgeMap.set(e.id, e); }
  };

  for (let hop = 0; hop < depth && nodeIris.size < MAX_NODES; hop++) {
    const next = new Set<string>();

    for (const iri of frontier) {
      // ── Class edges ──────────────────────────────────────────────────────
      const cls = model.classes.get(iri);
      if (cls) {
        // SubClassOf (going up to superclass)
        for (const sup of cls.superClassIris) {
          if (sup === OWL_THING) { continue; }
          addEdge({ id: `${iri}|sub|${sup}`, source: iri, target: sup, type: 'subClassOf' });
          if (!nodeIris.has(sup) && nodeIris.size < MAX_NODES) { nodeIris.add(sup); next.add(sup); }
        }

        // Subclasses (going down)
        for (const sub of assertedChildren.get(iri) ?? []) {
          addEdge({ id: `${sub}|sub|${iri}`, source: sub, target: iri, type: 'subClassOf' });
          if (!nodeIris.has(sub) && nodeIris.size < MAX_NODES) { nodeIris.add(sub); next.add(sub); }
        }

        // EquivalentTo
        for (const eq of cls.equivalentClassIris) {
          const id = [iri, eq].sort().join('|eq|');
          addEdge({ id, source: iri, target: eq, type: 'equivalentTo' });
          if (!nodeIris.has(eq) && nodeIris.size < MAX_NODES) { nodeIris.add(eq); next.add(eq); }
        }

        // DisjointWith (optional)
        if (opts.showDisjoint) {
          for (const dis of cls.disjointClassIris) {
            const id = [iri, dis].sort().join('|dis|');
            if (!edgeMap.has(id)) {
              addEdge({ id, source: iri, target: dis, type: 'disjointWith' });
              if (!nodeIris.has(dis) && nodeIris.size < MAX_NODES) { nodeIris.add(dis); next.add(dis); }
            }
          }
        }

        // Inferred sub-classes of this node
        if (opts.showInferred && model.isClassified) {
          for (const infSub of model.inferredSubClasses.get(iri) ?? []) {
            // only add inferred edge if the asserted edge doesn't already exist
            if (!edgeMap.has(`${infSub}|sub|${iri}`)) {
              addEdge({ id: `${infSub}|inf|${iri}`, source: infSub, target: iri, type: 'inferred', isInferred: true });
            }
            if (!nodeIris.has(infSub) && nodeIris.size < MAX_NODES) { nodeIris.add(infSub); next.add(infSub); }
          }
        }
      }

      // ── Object-property edges ────────────────────────────────────────────
      const prop = model.objectProperties.get(iri);
      if (prop) {
        for (const dom of prop.domainIris) {
          addEdge({ id: `${iri}|dom|${dom}`, source: iri, target: dom, type: 'domain', label: 'domain' });
          if (!nodeIris.has(dom) && nodeIris.size < MAX_NODES) { nodeIris.add(dom); next.add(dom); }
        }
        for (const rng of prop.rangeIris) {
          addEdge({ id: `${iri}|rng|${rng}`, source: iri, target: rng, type: 'range', label: 'range' });
          if (!nodeIris.has(rng) && nodeIris.size < MAX_NODES) { nodeIris.add(rng); next.add(rng); }
        }
        for (const sup of prop.superPropertyIris) {
          addEdge({ id: `${iri}|sprop|${sup}`, source: iri, target: sup, type: 'subPropertyOf' });
          if (!nodeIris.has(sup) && nodeIris.size < MAX_NODES) { nodeIris.add(sup); next.add(sup); }
        }
      }

      // ── Individual type edges ────────────────────────────────────────────
      const ind = model.individuals.get(iri);
      if (ind) {
        for (const clsIri of ind.classIris) {
          addEdge({ id: `${iri}|type|${clsIri}`, source: iri, target: clsIri, type: 'type' });
          if (!nodeIris.has(clsIri) && nodeIris.size < MAX_NODES) { nodeIris.add(clsIri); next.add(clsIri); }
        }
      }
    }

    frontier = next;
    if (frontier.size === 0) { break; }
  }

  // Also collect edges between already-collected nodes that weren't traversed
  if (nodeIris.size < MAX_NODES) {
    for (const iri of nodeIris) {
      const cls = model.classes.get(iri);
      if (cls) {
        for (const sup of cls.superClassIris) {
          if (nodeIris.has(sup) && sup !== OWL_THING) {
            addEdge({ id: `${iri}|sub|${sup}`, source: iri, target: sup, type: 'subClassOf' });
          }
        }
        for (const eq of cls.equivalentClassIris) {
          if (nodeIris.has(eq)) {
            const id = [iri, eq].sort().join('|eq|');
            addEdge({ id, source: iri, target: eq, type: 'equivalentTo' });
          }
        }
        if (opts.showDisjoint) {
          for (const dis of cls.disjointClassIris) {
            if (nodeIris.has(dis)) {
              const id = [iri, dis].sort().join('|dis|');
              addEdge({ id, source: iri, target: dis, type: 'disjointWith' });
            }
          }
        }
      }
    }
  }

  // Build node list
  const nodes: GraphNode[] = [];
  for (const iri of nodeIris) {
    const cls = model.classes.get(iri);
    if (cls) {
      nodes.push({
        id: iri, label: getLabel(cls, preferredLang),
        type: 'class', isRoot: iri === focusIri,
      });
      continue;
    }
    const op = model.objectProperties.get(iri);
    if (op) {
      nodes.push({ id: iri, label: getLabel(op, preferredLang), type: 'objectProperty' });
      continue;
    }
    const dp = model.dataProperties.get(iri);
    if (dp) {
      nodes.push({ id: iri, label: getLabel(dp, preferredLang), type: 'dataProperty' });
      continue;
    }
    const ap = model.annotationProperties.get(iri);
    if (ap) {
      nodes.push({ id: iri, label: getLabel(ap, preferredLang), type: 'annotationProperty' });
      continue;
    }
    const ind = model.individuals.get(iri);
    if (ind) {
      nodes.push({ id: iri, label: getLabel(ind, preferredLang), type: 'individual', isRoot: iri === focusIri });
      continue;
    }
    // Unknown IRI (referenced but not declared) — show as a class stub
    const localName = iri.split(/[#/]/).pop() ?? iri;
    nodes.push({ id: iri, label: localName, type: 'class' });
  }

  // Remove edges whose source or target isn't in the node set (safety guard)
  const nodeSet = new Set(nodes.map(n => n.id));
  const edges = [...edgeMap.values()].filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));

  return { nodes, edges };
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'graph-webview.js'),
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
  <title>OntoGraph Graph</title>
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
