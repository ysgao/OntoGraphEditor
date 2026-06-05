import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel.js';
import { getLabel } from '../model/OntologyModel.js';
import { OntologyIndex } from '../model/OntologyIndex.js';
import { ManchesterParser } from '../parser/ManchesterParser.js';
import { stripAndContinuations } from '../utils/ManchesterFormatting';
import { normalizeExpression } from '../model/AxiomDisplay.js';
import { serializeToFunctional } from '../serializer/FunctionalSerializer.js';
import { manchesterToFunctional } from '../utils/ExpressionUtils.js';
import type { ReasonerBridge } from '../reasoner/ReasonerBridge.js';
import type {
  DLQueryExtToWebview,
  DLQueryWebviewToExt,
  EntityRef,
  ResultGroup,
} from './DLQueryMessages.js';
import { DL_QUERY_TYPE_LABELS } from './DLQueryMessages.js';
import type { DLQueryResult } from '../model/OntologyModel.js';
import { temporaryClassIris } from './DLQueryState.js';

export { temporaryClassIris };

const TEMP_CLASS_IRI = 'urn:ontograph:dlquery#TempQuery';

let panel: vscode.WebviewPanel | undefined;
let currentModel: OntologyModel | undefined;
let currentIndex: OntologyIndex | undefined;
let currentRevealFn: ((iri: string, entityType: 'class' | 'individual') => void) | undefined;

let executing = false;

export function openDLQueryPanel(
  context: vscode.ExtensionContext,
  bridge: ReasonerBridge,
  model: OntologyModel | undefined,
  index: OntologyIndex | undefined,
  revealFn: (iri: string, entityType: 'class' | 'individual') => void,
): void {
  currentModel = model;
  currentIndex = index;
  currentRevealFn = revealFn;

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'ontograph.dlQuery',
    'DL Query',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    },
  );

  panel.webview.html = buildHtml(panel.webview, context.extensionUri);

  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    (msg: DLQueryWebviewToExt) => {
      if (!panel) { return; }
      handleMessage(msg, panel, bridge);
    },
    undefined,
    context.subscriptions,
  );
}

export function updateDLQueryModel(model: OntologyModel | undefined, index: OntologyIndex | undefined): void {
  currentModel = model;
  currentIndex = index;
  if (!panel) { return; }
  void panel.webview.postMessage({
    type: 'ontologyStatus',
    hasOntology: model !== undefined,
  } satisfies DLQueryExtToWebview);
}

function handleMessage(
  msg: DLQueryWebviewToExt,
  p: vscode.WebviewPanel,
  bridge: ReasonerBridge,
): void {
  switch (msg.type) {
    case 'ready':
      void p.webview.postMessage({
        type: 'ontologyStatus',
        hasOntology: currentModel !== undefined,
      } satisfies DLQueryExtToWebview);
      break;

    case 'execute':
      if (executing) { break; }
      void p.webview.postMessage({ type: 'dlQueryLoading' } satisfies DLQueryExtToWebview);
      void runQuery(msg.classExpression, msg.queryTypes, bridge, p);
      break;

    case 'navigate':
      currentRevealFn?.(msg.iri, msg.entityType);
      break;

    case 'requestCompletion': {
      const idx = currentIndex ?? (currentModel ? new OntologyIndex(currentModel) : null);
      if (!idx) {
        void p.webview.postMessage({
          type: 'completionResult',
          requestId: msg.requestId,
          items: [],
        } satisfies DLQueryExtToWebview);
        break;
      }
      const entities = idx.searchByLabel(msg.prefix, 50);
      void p.webview.postMessage({
        type: 'completionResult',
        requestId: msg.requestId,
        items: entities.map(e => ({ label: getLabel(e), iri: e.iri, entityType: e.type })),
      } satisfies DLQueryExtToWebview);
      break;
    }

    case 'validate': {
      const errors = validateExpression(msg.text);
      void p.webview.postMessage({
        type: 'validationResult',
        requestId: msg.requestId,
        errors,
      } satisfies DLQueryExtToWebview);
      break;
    }
  }
}

function validateExpression(
  text: string,
): { from: number; to: number; severity: 'error' | 'warning'; message: string }[] {
  const logical = stripAndContinuations(text);
  if (!logical || logical.startsWith('#')) { return []; }
  const wrapped = `Prefix: : <http://example.org/>\nClass: :_TmpClass\n  SubClassOf: ${logical}\n`;
  try {
    new ManchesterParser(wrapped, '').parse();
    return [];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [{ from: 0, to: text.length, severity: 'error', message }];
  }
}

async function runQuery(
  classExpression: string,
  queryTypes: string[],
  bridge: ReasonerBridge,
  p: vscode.WebviewPanel,
): Promise<void> {
  const model = currentModel;
  const index = currentIndex ?? (model ? new OntologyIndex(model) : null);
  // Mirror classifyOntology's content/format resolution exactly:
  //   1. live TextDocument (file open in VS Code — picks up unsaved edits)
  //   2. rawContent (loaded via loadOntologyFile or reloadOntology)
  //   3. serialize from in-memory model (last resort)
  // This ensures DL Query classifies the same ontology state as Classify.
  const sourceDoc = model
    ? vscode.workspace.textDocuments?.find(d => d.uri.toString() === model.sourceUri)
    : undefined;
  const { content, format } = sourceDoc
    ? { content: sourceDoc.getText(), format: model!.sourceFormat }
    : model?.rawContent
      ? { content: model.rawContent, format: model.sourceFormat }
      : model
        ? { content: serializeToFunctional(model), format: 'functional' }
        : { content: '', format: 'functional' };

  // Strip multi-line continuation formatting, resolve labels to IRIs, then convert
  // to OWL Functional Syntax — the same pipeline the entity editor uses for
  // EquivalentClasses axioms. Java's dlQuery dispatches on the leading token to
  // parse functional-syntax expressions via OWLAPI's functional parser.
  // Fall back to the Manchester expression when normalization produced no IRIs
  // (manchesterToFunctional only handles IRI tokens; bare names yield empty output).
  const strippedExpression = stripAndContinuations(classExpression);
  const normalized = (model && index)
    ? normalizeExpression(strippedExpression, model, index)
    : strippedExpression;
  const resolvedExpression = /https?:\/\//.test(normalized)
    ? manchesterToFunctional(normalized)
    : strippedExpression;

  executing = true;
  temporaryClassIris.add(TEMP_CLASS_IRI);
  try {
    const result = await bridge.dlQuery(format, content, null, resolvedExpression, queryTypes, 'auto');
    const groups = buildResultGroups(result, queryTypes, model);
    void p.webview.postMessage({
      type: 'dlQueryResult',
      groups,
    } satisfies DLQueryExtToWebview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    void p.webview.postMessage({
      type: 'dlQueryError',
      message,
    } satisfies DLQueryExtToWebview);
  } finally {
    temporaryClassIris.delete(TEMP_CLASS_IRI);
    executing = false;
  }
}

function buildResultGroups(
  result: DLQueryResult,
  queryTypes: string[],
  model: OntologyModel | undefined,
): ResultGroup[] {
  const groups: ResultGroup[] = [];

  for (const qt of queryTypes as (keyof typeof DL_QUERY_TYPE_LABELS)[]) {
    const iris: string[] = result[qt] ?? [];
    const isInstances = qt === 'instances';
    const entities: EntityRef[] = iris.map(iri => ({
      iri,
      label: resolveLabel(iri, isInstances ? 'individual' : 'class', model),
      entityType: isInstances ? 'individual' : 'class',
    }));
    groups.push({ queryType: qt, label: DL_QUERY_TYPE_LABELS[qt], entities });
  }

  return groups;
}

function resolveLabel(
  iri: string,
  entityType: 'class' | 'individual',
  model: OntologyModel | undefined,
): string {
  if (!model) { return localName(iri); }
  const entity = entityType === 'individual'
    ? model.individuals.get(iri)
    : model.classes.get(iri);
  if (entity) { return getLabel(entity); }
  return localName(iri);
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) { return iri.slice(hash + 1); }
  const slash = iri.lastIndexOf('/');
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}


function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'dl-query-webview.js'),
  );
  const nonce = getNonce();

  const queryTypes = [
    { id: 'directSuperClasses', label: 'Direct superclasses', checked: true  },
    { id: 'superClasses',       label: 'Superclasses',        checked: false },
    { id: 'equivalentClasses',  label: 'Equivalent classes',  checked: false },
    { id: 'directSubClasses',   label: 'Direct subclasses',   checked: true  },
    { id: 'subClasses',         label: 'Subclasses',          checked: true  },
    { id: 'instances',          label: 'Instances',           checked: false },
  ];

  const checkboxRows = queryTypes.map(qt =>
    `<label class="checkbox-row">
       <input type="checkbox" id="qt-${qt.id}"${qt.checked ? ' checked' : ''}>
       ${qt.label}
     </label>`,
  ).join('\n');

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
  <title>OntoGraph: DL Query</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      display: flex; flex-direction: column;
    }
    #top-section {
      padding: 8px;
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      flex-shrink: 0;
    }
    #top-section > label {
      display: block; font-weight: 600; margin-bottom: 4px;
      font-size: 0.85em; color: var(--vscode-descriptionForeground, #aaa);
    }
    #expression-editor {
      min-height: 48px;
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 2px;
      background: var(--vscode-input-background);
    }
    #execute {
      margin-top: 6px; padding: 4px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 2px; cursor: pointer; font-size: 0.9em;
    }
    #execute:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    #execute:disabled { opacity: 0.5; cursor: default; }
    #bottom-section { display: flex; flex: 1; overflow: hidden; }
    #results-pane {
      flex: 1; display: flex; flex-direction: column; overflow: hidden;
      border-right: 1px solid var(--vscode-panel-border, #444);
    }
    #results-header {
      padding: 6px 8px; font-weight: 600; font-size: 0.85em;
      color: var(--vscode-descriptionForeground, #aaa);
      border-bottom: 1px solid var(--vscode-panel-border, #444); flex-shrink: 0;
    }
    #results-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .result-group { margin-bottom: 4px; }
    .result-group-label {
      padding: 4px 8px 2px; font-weight: 600; font-size: 0.8em;
      color: var(--vscode-descriptionForeground, #aaa);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .result-group ul { list-style: none; margin: 0; padding: 0; }
    .entity-item {
      padding: 2px 12px; cursor: pointer; font-size: 0.9em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .entity-item:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-list-hoverForeground);
    }
    .loading, .empty-state { padding: 12px; font-size: 0.85em;
      color: var(--vscode-descriptionForeground, #aaa); }
    .error-state { padding: 12px; font-size: 0.85em;
      color: var(--vscode-errorForeground, #f44); }
    #options-pane {
      width: 200px; flex-shrink: 0; overflow-y: auto;
      padding: 8px; font-size: 0.85em;
    }
    .options-section-title {
      font-weight: 700; margin: 8px 0 4px; color: var(--vscode-foreground);
    }
    .options-section-title:first-child { margin-top: 0; }
    .checkbox-row {
      display: flex; align-items: flex-start; gap: 5px; margin: 3px 0; cursor: pointer;
    }
    .checkbox-row input { cursor: pointer; margin-top: 2px; flex-shrink: 0; }
    .checkbox-sublabel {
      display: block; color: var(--vscode-descriptionForeground, #aaa);
      font-size: 0.85em; margin-left: 18px; margin-top: -2px;
    }
    #name-filter-label { margin-bottom: 3px; }
    #name-filter {
      width: 100%; padding: 3px 5px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 2px; font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div id="top-section">
    <label for="expression-editor">Query (class expression)</label>
    <div id="expression-editor"></div>
    <button id="execute" disabled>Execute</button>
  </div>

  <div id="bottom-section">
    <div id="results-pane">
      <div id="results-header">Query results</div>
      <div id="results-list"></div>
    </div>

    <div id="options-pane">
      <div class="options-section-title">Query for</div>
      ${checkboxRows}

      <div class="options-section-title" style="margin-top:12px">Result filters</div>
      <div id="name-filter-label">Name contains</div>
      <input type="text" id="name-filter" placeholder="">

      <label class="checkbox-row" style="margin-top:8px">
        <input type="checkbox" id="show-owl-thing" checked>
        <span>Display owl:Thing
          <span class="checkbox-sublabel">(in superclass results)</span>
        </span>
      </label>

      <label class="checkbox-row" style="margin-top:4px">
        <input type="checkbox" id="show-owl-nothing" checked>
        <span>Display owl:Nothing
          <span class="checkbox-sublabel">(in subclass results)</span>
        </span>
      </label>
    </div>
  </div>

  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
