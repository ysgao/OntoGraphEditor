import * as vscode from 'vscode';
import { ClassHierarchyProvider } from './views/ClassHierarchyProvider';
import { InferredHierarchyProvider } from './views/InferredHierarchyProvider';
import { ObjectPropertyProvider } from './views/ObjectPropertyProvider';
import { DataPropertyProvider } from './views/DataPropertyProvider';
import { AnnotationPropertyProvider } from './views/AnnotationPropertyProvider';
import { IndividualBrowserProvider } from './views/IndividualBrowserProvider';
import { getLabel } from './model/OntologyModel';
import { ReasonerBridge } from './reasoner/ReasonerBridge';
import { classifyOntology } from './commands/classifyOntology';
import { checkConsistency } from './commands/checkConsistency';
import { exportOntology } from './commands/exportOntology';
import { addEntity } from './commands/addEntity';
import { openGraphView, updateGraphPanel } from './commands/openVisualization';
import { showEntityInfo, refreshEntityEditorIfOpen, setReasonerBridge } from './views/EntityEditorPanel';
import { openSparqlEditor } from './commands/openSparqlEditor';
import { openDLQuery } from './commands/openDLQuery';
import { updateDLQueryModel } from './views/DLQueryPanel';
import { reloadOntology } from './commands/reloadOntology';
import { loadOntologyFile } from './commands/loadOntologyFile';

import { isReloadSuppressed, isOwnRecentWrite, registerWatcherSuspendHandler } from './sync/reloadGuard';
import { computeLineDiff, canApplyIncremental } from './sync/lineDiff';
import { applyIncrementalReload } from './sync/incrementalReload';
import { buildModelSegmentIndexAsync } from './model/SegmentIndex';
import type { OntologyModel, EntityType } from './model/OntologyModel';
import { OntologyIndex } from './model/OntologyIndex';
import { buildModelSegmentIndex } from './model/SegmentIndex';

export let outputChannel: vscode.OutputChannel;

let activeModel: OntologyModel | undefined;
let activeIndex: OntologyIndex | undefined;
let activeFileWatcher: vscode.FileSystemWatcher | undefined;
let reloadDebounceTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('OntoGraph');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('OntoGraph activating…');

  // --- Tree data providers ---
  const classProvider = new ClassHierarchyProvider();
  const inferredProvider = new InferredHierarchyProvider();
  const objectPropProvider = new ObjectPropertyProvider();
  const dataPropProvider = new DataPropertyProvider();
  const annotationPropProvider = new AnnotationPropertyProvider();
  const individualProvider = new IndividualBrowserProvider();

  let suppressNextSelection = false;

  function extractSctid(iri: string): string | undefined {
    return /\/id\/(\d+)$/.exec(iri)?.[1];
  }

  function onEntitySelected(item: unknown): void {
    const iri = (item as { iri?: string } | undefined)?.iri;
    if (!iri || !activeModel) { return; }
    if (suppressNextSelection) {
      suppressNextSelection = false;
      return;
    }
    showEntityInfo(context, activeModel, iri);
    if (activeModel.classes.has(iri)) {
      classProvider.setFocus(iri);
      inferredProvider.setFocus(iri);
    }
    const id = extractSctid(iri) ?? iri;
    vscode.commands.executeCommand(
      'ontographEditor.ipcRoute',
      { command: 'GRAPH_NODE_SELECT', payload: { id } }
    ).then(undefined, () => {});
  }

  function entityTypeForIri(iri: string): EntityType | undefined {
    if (!activeModel) { return undefined; }
    if (activeModel.classes.has(iri)) { return 'class'; }
    if (activeModel.objectProperties.has(iri)) { return 'objectProperty'; }
    if (activeModel.dataProperties.has(iri)) { return 'dataProperty'; }
    if (activeModel.annotationProperties.has(iri)) { return 'annotationProperty'; }
    if (activeModel.individuals.has(iri)) { return 'individual'; }
    return undefined;
  }

  const classView = vscode.window.createTreeView('ontograph.classes', { treeDataProvider: classProvider });
  const inferredView = vscode.window.createTreeView('ontograph.inferredClasses', { treeDataProvider: inferredProvider });
  const objectPropView = vscode.window.createTreeView('ontograph.objectProperties', { treeDataProvider: objectPropProvider });
  const dataPropView = vscode.window.createTreeView('ontograph.dataProperties', { treeDataProvider: dataPropProvider });
  const annotationPropView = vscode.window.createTreeView('ontograph.annotationProperties', { treeDataProvider: annotationPropProvider });
  const individualView = vscode.window.createTreeView('ontograph.individuals', { treeDataProvider: individualProvider });

  function updateClassificationViewState(model: OntologyModel | undefined): void {
    const needsUpdate = !!model?.classificationNeedsUpdate;
    inferredView.title = 'Inferred Hierarchy';
    inferredView.description = undefined;
    inferredView.badge = undefined;
    inferredView.message = undefined;
    void vscode.commands.executeCommand('setContext', 'ontograph.classificationNeedsUpdate', needsUpdate);
  }
  updateClassificationViewState(undefined);

  context.subscriptions.push(
    classView,
    inferredView,
    objectPropView,
    dataPropView,
    annotationPropView,
    individualView,
    classView.onDidChangeSelection(e => onEntitySelected(e.selection[0])),
    inferredView.onDidChangeSelection(e => onEntitySelected(e.selection[0])),
    objectPropView.onDidChangeSelection(e => onEntitySelected(e.selection[0])),
    dataPropView.onDidChangeSelection(e => onEntitySelected(e.selection[0])),
    annotationPropView.onDidChangeSelection(e => onEntitySelected(e.selection[0])),
    individualView.onDidChangeSelection(e => onEntitySelected(e.selection[0])),
  );

  // --- Reasoner bridge ---
  const reasonerBridge = new ReasonerBridge(context.extensionPath);
  context.subscriptions.push(reasonerBridge);
  setReasonerBridge(reasonerBridge);

  // --- Persistent stats status bar item ---
  const statsBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statsBar.command = 'ontograph.diagnose';
  statsBar.tooltip = 'OntoGraph ontology statistics — click for details';
  context.subscriptions.push(statsBar);

  // --- Commands ---
  const config = vscode.workspace.getConfiguration('ontograph');
  const preferredLang: string = config.get('display.preferredLabelLanguage') ?? 'en';

  function refreshAllViews(model: OntologyModel): void {
    const tRefresh = Date.now();
    activeIndex = new OntologyIndex(model);
    console.log(`[perf:refresh] OntologyIndex: ${Date.now() - tRefresh}ms`);
    if (model.sourceFormat === 'functional' && !model.entitySegments) {
      const tSeg = Date.now();
      buildModelSegmentIndex(model);
      console.log(`[perf:refresh] buildSegmentIndex (small file): ${Date.now() - tSeg}ms`);
    }
    const tProviders = Date.now();
    classProvider.setModel(model, preferredLang);
    inferredProvider.setModel(model, preferredLang);
    objectPropProvider.setModel(model, preferredLang);
    dataPropProvider.setModel(model, preferredLang);
    annotationPropProvider.setModel(model, preferredLang);
    individualProvider.setModel(model, preferredLang);
    updateClassificationViewState(model);
    console.log(`[perf:refresh] tree providers: ${Date.now() - tProviders}ms`);
    console.log(`[perf:refresh] total: ${Date.now() - tRefresh}ms`);
  }

  async function executeReload(): Promise<void> {
    if (!activeModel) { return; }
    const uri = vscode.Uri.parse(activeModel.sourceUri);
    const filename = uri.fsPath.split(/[\\/]/).pop() ?? 'ontology';

    if (activeModel.sourceMtimeMs !== undefined && activeModel.sourceSize !== undefined) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.mtime === activeModel.sourceMtimeMs && stat.size === activeModel.sourceSize) {
          outputChannel.appendLine(`[reload] file unchanged; rebuilding segment index to clear any drift`);
          const t0 = Date.now();
          await buildModelSegmentIndexAsync(activeModel);
          outputChannel.appendLine(`[reload] segment rebuild took ${Date.now() - t0}ms`);
          refreshAllViews(activeModel);
          vscode.window.setStatusBarMessage('$(check) OntoGraph: views refreshed', 4000);
          return;
        }
      } catch { }
    }

    await vscode.commands.executeCommand('setContext', 'ontograph.reloading', true);
    try {
      const tryIncremental = activeModel
        && activeModel.sourceFormat === 'functional'
        && activeModel.rawContent
        && activeModel.entitySegments;

      if (tryIncremental) {
        const incrementalOk = await tryIncrementalReload(uri, filename);
        if (incrementalOk) {
          vscode.window.setStatusBarMessage('$(check) Ontology reloaded (incremental)', 8000);
          return;
        }
        outputChannel.appendLine('[reload] incremental skipped — falling back to full re-parse');
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `OntoGraph: reloading ${filename}…`,
          cancellable: false,
        },
        async () => {
          if (activeModel) {
            activeModel.rawContent = '';
            activeModel.entitySegments = undefined;
            activeModel.gciSegments = undefined;
          }
          await reloadOntology(activeModel!, async (model) => {
            await onLoadedCallback(model);
          });
        },
      );
      vscode.window.setStatusBarMessage('$(check) Ontology reloaded from disk', 8000);
    } finally {
      await vscode.commands.executeCommand('setContext', 'ontograph.reloading', false);
    }
  }

  async function tryIncrementalReload(uri: vscode.Uri, filename: string): Promise<boolean> {
    if (!activeModel || !activeModel.rawContent) return false;
    let newText: string;
    let stat: vscode.FileStat;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      newText = new TextDecoder().decode(bytes);
      stat = await vscode.workspace.fs.stat(uri);
    } catch (err) {
      outputChannel.appendLine(`[reload incremental] read failed: ${String(err)}`);
      return false;
    }
    const oldText = activeModel.rawContent;
    const oldTextLength = oldText.length;
    const diff = computeLineDiff(oldText, newText);
    if (!canApplyIncremental(oldText, newText, diff)) {
      outputChannel.appendLine(`[reload incremental] diff classification rejected for ${filename}`);
      return false;
    }
    let ok: boolean;
    try {
      ok = applyIncrementalReload(activeModel, oldTextLength, newText, diff, { mtime: stat.mtime, size: stat.size });
    } catch (err) {
      outputChannel.appendLine(`[reload incremental] applyIncrementalReload threw: ${String(err)}`);
      return false;
    }
    if (!ok) {
      outputChannel.appendLine(`[reload incremental] applyIncrementalReload returned false for ${filename}`);
      return false;
    }
    outputChannel.appendLine(`[reload incremental] OK — diff lines ${diff.oldStartLine}-${diff.oldEndLine} → ${diff.newStartLine}-${diff.newEndLine}`);
    refreshAllViews(activeModel);
    await refreshEntityEditorIfOpen(activeModel, context);
    updateDLQueryModel(activeModel, activeIndex);
    return true;
  }

  function hasInferredHierarchy(model: OntologyModel | undefined): model is OntologyModel {
    if (!model?.isClassified) { return false; }
    for (const children of model.inferredSubClasses.values()) {
      if (children.size > 0) { return true; }
    }
    return false;
  }

  function revealInTreeView(iri: string, entityType: EntityType, fromIpc = false): void {
    const opts = { select: true, focus: false, expand: false };
    try {
      switch (entityType) {
        case 'class': {
          classProvider.setFocus(iri);
          inferredProvider.setFocus(iri);
          if (hasInferredHierarchy(activeModel)) {
            const inferredItem = inferredProvider.makeItem(iri);
            if (inferredItem) {
              if (!fromIpc) { void vscode.commands.executeCommand('ontograph.inferredClasses.focus'); }
              if (!fromIpc || inferredView.visible) { void inferredView.reveal(inferredItem, opts); }
              break;
            }
          }
          const item = classProvider.makeItem(iri);
          if (item && (!fromIpc || classView.visible)) { void classView.reveal(item, opts); }
          break;
        }
        case 'objectProperty': {
          const item = objectPropProvider.makeItem(iri);
          if (item && (!fromIpc || objectPropView.visible)) { void objectPropView.reveal(item, opts); }
          break;
        }
        case 'dataProperty': {
          const item = dataPropProvider.makeItem(iri);
          if (item && (!fromIpc || dataPropView.visible)) { void dataPropView.reveal(item, opts); }
          break;
        }
        case 'annotationProperty': {
          const item = annotationPropProvider.makeItem(iri);
          if (item && (!fromIpc || annotationPropView.visible)) { void annotationPropView.reveal(item, opts); }
          break;
        }
        case 'individual': {
          const item = individualProvider.makeItem(iri);
          if (item && (!fromIpc || individualView.visible)) { void individualView.reveal(item, opts); }
          break;
        }
      }
    } catch { }
  }

  interface SearchQuickPickItem extends vscode.QuickPickItem {
    iri: string;
    entityType: EntityType;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('ontograph.searchEntity', () => {
      if (!activeModel || !activeIndex) {
        void vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
        return;
      }
      const qp = vscode.window.createQuickPick<SearchQuickPickItem>();
      qp.placeholder = 'Search by name or label…';
      qp.matchOnDescription = true;
      qp.onDidChangeValue(value => {
        if (!value.trim()) { qp.items = []; return; }
        const entities = activeIndex!.searchByLabel(value.trim(), 100);
        qp.items = entities.map(e => ({
          label: getLabel(e, preferredLang),
          description: e.type,
          iri: e.iri,
          entityType: e.type,
          alwaysShow: true,
        }));
      });
      qp.onDidAccept(() => {
        const sel = qp.selectedItems[0];
        if (sel && activeModel) {
          showEntityInfo(context, activeModel, sel.iri);
          revealInTreeView(sel.iri, sel.entityType);
        }
        qp.hide();
        qp.dispose();
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),

    vscode.commands.registerCommand('ontograph.refresh', () => {
      if (activeModel) { void executeReload(); }
    }),

    vscode.commands.registerCommand('ontograph.focusEntity', (item?: { iri?: string; fromIpc?: boolean }) => {
      const iri = item?.iri;
      if (!iri || !activeModel) { return; }
      const entityType = entityTypeForIri(iri);
      if (!entityType) {
        void vscode.window.showWarningMessage(`OntoGraph: Entity not found: ${iri}`);
        return;
      }
      const fromIpc = item?.fromIpc ?? false;
      if (fromIpc) { suppressNextSelection = true; }
      showEntityInfo(context, activeModel, iri, fromIpc);
      revealInTreeView(iri, entityType, fromIpc);
      updateGraphPanel(activeModel, iri, preferredLang);
    }),

    vscode.commands.registerCommand('ontograph.loadOntologyFile', (prefillUri?: vscode.Uri) => {
      void loadOntologyFile(onLoadedCallback, prefillUri);
    }),

    vscode.commands.registerCommand('ontograph.classifyOntology', async () => {
      await classifyOntology(activeModel, reasonerBridge, inferredProvider);
      updateClassificationViewState(activeModel);
      if (activeModel) { await refreshEntityEditorIfOpen(activeModel, context); }
    }),

    vscode.commands.registerCommand('ontograph.classifyOntologyStale', async () => {
      await classifyOntology(activeModel, reasonerBridge, inferredProvider);
      updateClassificationViewState(activeModel);
      if (activeModel) { await refreshEntityEditorIfOpen(activeModel, context); }
    }),

    vscode.commands.registerCommand('ontograph.checkConsistency', () =>
      checkConsistency(activeModel, reasonerBridge, context)),

    vscode.commands.registerCommand('ontograph.exportOntology', () =>
      exportOntology(activeModel, reasonerBridge)),

    vscode.commands.registerCommand('ontograph.addEntity', () =>
      addEntity(activeModel)),

    vscode.commands.registerCommand('ontograph.openGraph', (item?: { iri?: string }) =>
      openGraphView(context, activeModel, item?.iri)),

    vscode.commands.registerCommand('ontograph.openSparqlEditor', () =>
      openSparqlEditor(context, activeModel)),

    vscode.commands.registerCommand('ontograph.openDLQuery', () =>
      openDLQuery(context, reasonerBridge, activeModel, activeIndex, revealInTreeView)),

    vscode.commands.registerCommand('ontograph.entityEditor', (item?: { iri?: string }) => {
      const iri = item?.iri;
      if (!iri) { void vscode.window.showWarningMessage('OntoGraph: Right-click an entity to open the editor.'); return; }
      if (!activeModel) { void vscode.window.showWarningMessage('OntoGraph: No ontology loaded.'); return; }
      showEntityInfo(context, activeModel, iri);
    }),

    vscode.commands.registerCommand('ontograph.copyIri', (item?: { iri?: string }) => {
      const iri = item?.iri;
      if (iri) {
        vscode.env.clipboard.writeText(iri);
        vscode.window.setStatusBarMessage(`Copied: ${iri}`, 3000);
      }
    }),

    vscode.commands.registerCommand('ontograph.showEntityInfo', (item?: { iri?: string }) => {
      const iri = item?.iri;
      if (!iri) {
        void vscode.window.showWarningMessage('OntoGraph: Right-click a class, property, or individual to view its info.');
        return;
      }
      if (!activeModel) {
        void vscode.window.showWarningMessage('OntoGraph: No ontology loaded.');
        return;
      }
      showEntityInfo(context, activeModel, iri);
    }),

    vscode.commands.registerCommand('ontograph.diagnose', () => {
      outputChannel.show(true);
      if (!activeModel) {
        outputChannel.appendLine('[diagnose] No model loaded. Open a .ofn/.omn/.owl file.');
        void vscode.window.showWarningMessage('OntoGraph: No ontology loaded yet.');
        return;
      }
      const msg = `[diagnose] Model loaded: ${activeModel.classes.size} classes, ${activeModel.objectProperties.size} obj props, ${activeModel.dataProperties.size} data props, ${activeModel.individuals.size} individuals — source: ${activeModel.sourceUri}`;
      outputChannel.appendLine(msg);
      void vscode.window.showInformationMessage(msg.replace('[diagnose] ', ''));
    }),
  );

  function setupFileWatcher(model: OntologyModel): void {
    activeFileWatcher?.dispose();
    const watchedUri = vscode.Uri.parse(model.sourceUri);
    const filename = watchedUri.path.slice(watchedUri.path.lastIndexOf('/') + 1);
    activeFileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(watchedUri, '..'), filename),
    );
    const watchedKey = watchedUri.toString();
    activeFileWatcher.onDidChange(async () => {
      if (isReloadSuppressed(watchedKey)) { return; }
      try {
        const stat = await vscode.workspace.fs.stat(watchedUri);
        if (isOwnRecentWrite(watchedKey, stat.mtime, stat.size)) { return; }
      } catch { }
      clearTimeout(reloadDebounceTimer);
      reloadDebounceTimer = setTimeout(async () => {
        if (isReloadSuppressed(watchedKey)) { return; }
        try {
          const stat = await vscode.workspace.fs.stat(watchedUri);
          if (isOwnRecentWrite(watchedKey, stat.mtime, stat.size)) { return; }
        } catch { }
        void executeReload();
      }, 500);
    });
  }

  registerWatcherSuspendHandler((uri, suspend) => {
    if (!activeModel || activeModel.sourceUri !== uri) { return; }
    if (suspend) {
      activeFileWatcher?.dispose();
      activeFileWatcher = undefined;
      clearTimeout(reloadDebounceTimer);
    } else {
      setupFileWatcher(activeModel);
    }
  });

  const onLoadedCallback = async (model: OntologyModel): Promise<void> => {
    activeModel = model;
    refreshAllViews(model);
    await refreshEntityEditorIfOpen(model, context);
    updateDLQueryModel(model, activeIndex);
    setupFileWatcher(model);

    const { classes, objectProperties, dataProperties, individuals } = model;
    const stats = `${classes.size} classes, ${objectProperties.size} obj props, ${individuals.size} individuals`;
    outputChannel.appendLine(`[loaded] ${stats}`);
    vscode.window.setStatusBarMessage(`$(check) OntoGraph: ${stats}`, 8000);

    statsBar.text = `$(type-hierarchy) ${classes.size} cls · ${objectProperties.size} prop · ${individuals.size} ind`;
    statsBar.tooltip = `OntoGraph: ${classes.size} classes · ${objectProperties.size} object properties · ${dataProperties.size} data properties · ${individuals.size} individuals\nClick for details`;
    statsBar.show();
  };

  void import('./lsp/client').then(({ startLanguageClient }) => {
    startLanguageClient(context);
    outputChannel.appendLine('Language server started.');
  });

  context.subscriptions.push(
    { dispose: () => { activeFileWatcher?.dispose(); clearTimeout(reloadDebounceTimer); } },
  );

  outputChannel.appendLine('OntoGraph ready. Open an .ofn, .omn, or .owl file to begin.');
}

export function deactivate(): void {
}