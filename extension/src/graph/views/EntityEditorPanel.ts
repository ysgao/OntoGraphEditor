import * as vscode from 'vscode';
import type {
  OntologyModel,
  OWLEntity,
  OWLClass,
  OWLObjectProperty,
  OWLDataProperty,
  OWLAnnotationProperty,
  OWLIndividual,
} from '../model/OntologyModel';
import { createEmptyModel, getLabel } from '../model/OntologyModel';
import { OntologyIndex } from '../model/OntologyIndex';
import { collectLogicalLines, sortManchesterConjuncts } from '../utils/ManchesterFormatting';
import type { ReasonerBridge } from '../reasoner/ReasonerBridge';
import { normalizeExpression, renderExpressionWithEntityRefs, type AxiomDisplayStyle } from '../model/AxiomDisplay';
import { syncAnnotationsToDocument } from '../sync/AnnotationSync';
import { syncAxiomsToDocument } from '../sync/AxiomSync';
import { queueSyncWrite } from '../sync/reloadGuard';
import { writeTextStreamed } from '../sync/streamWrite';
import { renameIri } from '../sync/IriRenameSync';
import { isValidAbsoluteIri } from '../utils/namespaceUtils';
import type { EntitySegment } from '../model/OntologyModel';
import {
  buildModelSegmentIndexAsync,
  applyIncrementalSegmentUpdate,
  type EditSummary,
} from '../model/SegmentIndex';
import { highlightSyncedRanges, clearSyncHighlight } from './syncHighlight';
import { EntityEditHistory } from './EntityEditHistory';
import type {
  EntityEditorExtToWebview,
  EntityEditorWebviewToExt,
  LoadEntityMessage,
  EntitySnapshot,
  PositionHints,
  UndoRedoStateMessage,
  CompletionResultMessage,
  ValidationResultMessage,
  SaveDraftErrorMessage,
  IriRenameResultMessage,
  DirtyStateMessage,
} from './EntityEditorMessages';

// ── Singleton panel ───────────────────────────────────────────────────────────

let reasonerBridge: ReasonerBridge | undefined;

export function setReasonerBridge(bridge: ReasonerBridge | undefined): void {
  reasonerBridge = bridge;
}

let _refreshAllViews: ((model: OntologyModel) => void) | undefined;

export function setRefreshAllViews(fn: (model: OntologyModel) => void): void {
  _refreshAllViews = fn;
}

let panel: vscode.WebviewPanel | undefined;
let lastIri = '';

// ── Dirty-guard state ─────────────────────────────────────────────────────────

/** IRI the user wants to navigate to, held while the dirty-guard dialog is open. */
let pendingNavigationIri: string | null = null;
/** Resolver for the in-flight queryDirty round-trip. Cleared once resolved. */
let dirtyQueryResolve: ((isDirty: boolean) => void) | null = null;

/** Returns the IRI currently shown in the Entity Editor (empty string if none). */
export function getLastIri(): string { return lastIri; }

/**
 * Queries the open Entity Editor webview for its dirty state.
 * Returns false immediately if no panel is open.
 */
export function queryEntityEditorDirty(): Promise<boolean> {
  if (!panel) { return Promise.resolve(false); }
  return queryDirty(panel);
}

// ── Always tracks the most recent model provided by showEntityInfo or
// refreshEntityEditorIfOpen. handleMessage uses this instead of the closure-
// captured model so that save mutations always target the current activeModel,
// even after handleDocument has re-parsed and replaced the original model object.
let currentPanelModel: OntologyModel | undefined;
const refreshCallbacks: Array<() => void> = [];

// Per-entity override cache: ensures edits made through the panel are always
// displayed when navigating back, even if activeModel was re-parsed from the
// old file before the applyEdit completed (race condition).
const savedEntityState = new Map<string, {
  labels: OWLEntity['labels'];
  annotations: OWLEntity['annotations'];
}>();

interface DraftExpression {
  text: string;
  sectionKey: 'superClassExpressions' | 'equivalentClassExpressions' | 'gciExpressions';
}

// Transient draft axiom expressions that failed syntax validation at save time.
// Never written to the OWL document. Keyed by entity IRI.
// Cleared when the user chooses "Discard and proceed" before a model reload.
const draftAxioms = new Map<string, DraftExpression[]>();

// Per-entity save-checkpoint history. Session-scoped; cleared on panel dispose.
const entityHistoryMap = new Map<string, EntityEditHistory>();

// True while syncAnnotationsToDocument's applyEdit is still in flight.
// Used by refreshEntityEditorIfOpen to decide whether to trust savedEntityState.
let _annotationSyncActive = false;
// True when save is triggered automatically after an undo/redo. Tells the save
// handler to skip recordSave so the checkpoint history is not disturbed.
let _autoSaveInProgress = false;
// Position hints captured at deletion-save time; consumed by the next undo auto-save
// so items are re-inserted at their original file positions.
let _pendingRestoreHints: PositionHints | undefined;

// Counter: number of incremental segment updates applied since the last full
// rebuild. Every Nth save we run a full `buildModelSegmentIndexAsync` as a
// safety anchor against any drift accumulated by the incremental updater.
let _incrementalSavesSinceRebuild = 0;
const FULL_REBUILD_EVERY_N_SAVES = 10;

let _cachedIndexModel: OntologyModel | undefined;
let _cachedIndex: OntologyIndex | undefined;

function getIndex(model: OntologyModel): OntologyIndex {
  if (model !== _cachedIndexModel || !_cachedIndex) {
    _cachedIndexModel = model;
    _cachedIndex = new OntologyIndex(model);
  }
  return _cachedIndex;
}

function cloneSegment(segment: EntitySegment | undefined): EntitySegment | undefined {
  if (segment === undefined) { return undefined; }
  return {
    startLine: segment.startLine,
    endLine: segment.endLine,
    startChar: segment.startChar,
    endChar: segment.endChar,
    lineIndices: segment.lineIndices ? new Int32Array(segment.lineIndices) : undefined,
    lineCharStarts: segment.lineCharStarts ? new Int32Array(segment.lineCharStarts) : undefined,
  };
}

function updateFunctionalSyncHints(
  entityIri: string,
  updatedText: string,
  segment: EntitySegment | undefined,
  gciSegment: EntitySegment | undefined,
  closingParenLine: number | undefined,
  gciInsertLine: number | undefined,
  editSummaries: EditSummary[],
): {
  segment: EntitySegment | undefined;
  gciSegment: EntitySegment | undefined;
  closingParenLine: number | undefined;
  gciInsertLine: number | undefined;
} {
  if (editSummaries.length === 0) {
    return { segment, gciSegment, closingParenLine, gciInsertLine };
  }

  const tempModel = createEmptyModel('sync-hints.ofn');
  tempModel.rawContent = updatedText;
  tempModel.sourceFormat = 'functional';
  tempModel.closingParenLine = closingParenLine;
  tempModel.gciInsertLine = gciInsertLine;

  const clonedSegment = cloneSegment(segment);
  if (clonedSegment) {
    tempModel.entitySegments = new Map([[entityIri, clonedSegment]]);
  }

  const clonedGciSegment = cloneSegment(gciSegment);
  if (clonedGciSegment) {
    tempModel.gciSegments = new Map([[entityIri, clonedGciSegment]]);
  }

  applyIncrementalSegmentUpdate(tempModel, entityIri, editSummaries);

  return {
    segment: tempModel.entitySegments?.get(entityIri),
    gciSegment: tempModel.gciSegments?.get(entityIri),
    closingParenLine: tempModel.closingParenLine,
    gciInsertLine: tempModel.gciInsertLine,
  };
}

export function registerEntityEditorRefreshCallback(cb: () => void): void {
  refreshCallbacks.push(cb);
}

function fireRefresh(): void {
  for (const cb of refreshCallbacks) { cb(); }
}

function postUndoRedoState(p: vscode.WebviewPanel, canUndo: boolean, canRedo: boolean): void {
  const msg: UndoRedoStateMessage = { type: 'undoRedoState', canUndo, canRedo };
  void p.webview.postMessage(msg as EntityEditorExtToWebview);
}

export function hasDraftAxioms(): boolean { return draftAxioms.size > 0; }

function discardAllDrafts(): void { draftAxioms.clear(); }

async function promptForDraftDiscard(
  context: vscode.ExtensionContext,
  model: OntologyModel,
): Promise<'proceed' | 'cancel'> {
  const entityIris = [...draftAxioms.keys()];
  const entityLabels = entityIris.map(iri => {
    const e = findEntity(model, iri);
    return e ? getLabel(e) : iri;
  });

  const message =
    `OntoGraph: The following entities have unsaved invalid draft axioms that will be lost: ${entityLabels.join(', ')}. ` +
    'Fix them before proceeding, or discard them.';

  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Discard and proceed',
    ...entityLabels,
  );

  if (choice === 'Discard and proceed') {
    discardAllDrafts();
    return 'proceed';
  }

  const labelIndex = entityLabels.indexOf(choice ?? '');
  if (labelIndex !== -1 && panel) {
    showEntityInfo(context, model, entityIris[labelIndex]);
  }

  return 'cancel';
}

/**
 * Called by the extension whenever a new model is available (after re-parsing).
 * Pushes fresh entity data to the open panel so direct file edits are reflected.
 * If an applyEdit from the entity editor is still in flight, savedEntityState is
 * kept so its data wins over the potentially stale intermediate model.
 *
 * If draft invalid axioms are present and context is provided, shows a blocking
 * dialog before reloading. Returns without refreshing if the user cancels.
 */
export async function refreshEntityEditorIfOpen(
  model: OntologyModel,
  context?: vscode.ExtensionContext,
): Promise<void> {
  if (!panel || !lastIri) { return; }

  if (hasDraftAxioms() && context) {
    const decision = await promptForDraftDiscard(context, model);
    if (decision === 'cancel') { return; }
  }

  const newOntology = currentPanelModel?.sourceUri !== model.sourceUri;
  currentPanelModel = model;

  if (!_annotationSyncActive) {
    savedEntityState.delete(lastIri);
  }
  sendLoadEntity(panel, model, lastIri);

  if (newOntology) {
    // Different ontology opened — wipe all per-entity checkpoint history.
    entityHistoryMap.clear();
    postUndoRedoState(panel, false, false);
  } else {
    // Same file (classify, reload, incremental update) — preserve history.
    const h = entityHistoryMap.get(lastIri);
    postUndoRedoState(panel, h?.canUndo ?? false, h?.canRedo ?? false);
  }
}

// ── Dirty guard helpers ───────────────────────────────────────────────────────

function queryDirty(p: vscode.WebviewPanel): Promise<boolean> {
  return new Promise(resolve => {
    dirtyQueryResolve = resolve;
    void p.webview.postMessage({ type: 'queryDirty' } as EntityEditorExtToWebview);
  });
}

/**
 * Guard wrapper around showEntityInfo that intercepts navigation when the
 * Entity Editor has unsaved changes and shows a Save / Discard / Cancel dialog.
 *
 * Returns 'navigated' when navigation proceeds (Save, Discard, or clean editor),
 * and 'cancelled' when the user dismissed the dialog.
 *
 * @param cancelRevealCallback  Optional: called on Cancel to restore tree selection.
 */
export async function guardedShowEntityInfo(
  context: vscode.ExtensionContext,
  model: OntologyModel,
  iri: string,
  cancelRevealCallback?: () => void,
  preserveFocus = false,
): Promise<'navigated' | 'cancelled'> {
  // Skip guard: no panel open, no previous entity, or same entity
  if (!panel || !lastIri || iri === lastIri) {
    showEntityInfo(context, model, iri, preserveFocus);
    return 'navigated';
  }

  const isDirty = await queryDirty(panel);
  if (!isDirty) {
    showEntityInfo(context, model, iri, preserveFocus);
    return 'navigated';
  }

  const entity = findEntity(model, lastIri);
  const label = entity ? getLabel(entity) : lastIri;

  const choice = await vscode.window.showWarningMessage(
    `"${label}" has unsaved changes. What would you like to do?`,
    { modal: true },
    'Save',
    'Discard',
    'Continue Editing',
  );

  if (choice === 'Save') {
    pendingNavigationIri = iri;
    void panel.webview.postMessage({ type: 'requestSave' } as EntityEditorExtToWebview);
    return 'navigated';
  } else if (choice === 'Discard') {
    showEntityInfo(context, model, iri, preserveFocus);
    return 'navigated';
  } else {
    // 'Continue Editing' or dismissed via Escape/X
    cancelRevealCallback?.();
    return 'cancelled';
  }
}

export function showEntityInfo(
  context: vscode.ExtensionContext,
  model: OntologyModel,
  iri: string,
  preserveFocus = false,
): void {
  const needsHistoryInit = !entityHistoryMap.has(iri);
  if (lastIri !== iri) { clearSyncHighlight(); }
  currentPanelModel = model;
  lastIri = iri;

  if (panel) {
    // When preserveFocus, update the webview content silently without revealing.
    if (!preserveFocus) { panel.reveal(vscode.ViewColumn.Active); }
    sendLoadEntity(panel, model, iri);
    if (needsHistoryInit) {
      const payload = buildEntityPayload(model, iri);
      if (payload) { entityHistoryMap.set(iri, new EntityEditHistory(payload)); }
      postUndoRedoState(panel, false, false);
    } else {
      const h = entityHistoryMap.get(iri);
      postUndoRedoState(panel, h?.canUndo ?? false, h?.canRedo ?? false);
    }
    return;
  }

  // When preserveFocus, don't create the panel — user hasn't opened the entity editor yet.
  if (preserveFocus) { return; }

  panel = vscode.window.createWebviewPanel(
    'ontograph.entityInfo',
    'Entity Editor',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    },
  );

  panel.webview.html = buildHtml(panel.webview, context.extensionUri);
  panel.onDidDispose(() => {
    panel = undefined;
    clearSyncHighlight();
    entityHistoryMap.clear();
  }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    (msg: EntityEditorWebviewToExt) => {
      if (!panel || !currentPanelModel) { return; }
      handleMessage(msg, panel, currentPanelModel, context);
    },
    undefined,
    context.subscriptions,
  );
}

// ── Persistence helper ───────────────────────────────────────────────────────

/**
 * Run the annotation + axiom sync phases and return ONLY the final text plus
 * combined ranges and lineDelta.
 *
 * Scoping the sync calls inside a helper lets V8 release the intermediate
 * `annot.updatedText` (~200MB for SNOMED) when the helper returns — only the
 * winning `text` survives. Caller still drops `baseContent` before the write,
 * so memory peak at write time is one final-text copy + the stream's 1MB
 * chunk buffer (not three copies + a 200MB encode buffer).
 */
export async function computeUpdatedText(
  uri: vscode.Uri,
  entity: OWLEntity,
  fmt: string,
  baseContent: string | undefined,
  seg: EntitySegment | undefined,
  gciSeg: EntitySegment | undefined,
  cpLine: number | undefined,
  giLine: number | undefined,
  restoreHints?: PositionHints,
): Promise<{
  text?: string;
  ranges: vscode.Range[];
  lineDelta: number;
  /** Edit summaries from AnnotationSync (positions in baseContent frame). */
  annotEditSummaries: EditSummary[];
  /** Edit summaries from AxiomSync. Positions are in `annot?.updatedText`
   *  frame when annot ran; in baseContent frame otherwise. Callers should
   *  apply annotEditSummaries FIRST then axiomEditSummaries to keep the
   *  coordinate frame consistent. */
  axiomEditSummaries: EditSummary[];
  deletedPositions?: PositionHints;
}> {
  const ranges: vscode.Range[] = [];
  let lineDelta = 0;

  if (fmt === 'turtle') {
    const r = await syncAxiomsToDocument(
      uri, entity, fmt, baseContent,
      undefined, undefined, undefined, undefined, true,
    );
    if (!r) { return { ranges, lineDelta, annotEditSummaries: [], axiomEditSummaries: [], deletedPositions: undefined }; }
    ranges.push(...r.changedRanges);
    lineDelta += r.lineDelta;
    return {
      text: r.updatedText, ranges, lineDelta,
      annotEditSummaries: [],
      axiomEditSummaries: r.editSummaries,
      deletedPositions: undefined,
    };
  }

  const annot = await syncAnnotationsToDocument(uri, entity, fmt, baseContent, seg, true, restoreHints?.annotations);
  if (annot) { ranges.push(...annot.changedRanges); lineDelta += annot.lineDelta; }

  const axiomHints = fmt === 'functional' && annot?.updatedText
    ? updateFunctionalSyncHints(
      entity.iri,
      annot.updatedText,
      seg,
      gciSeg,
      cpLine,
      giLine,
      annot.editSummaries,
    )
    : { segment: seg, gciSegment: gciSeg, closingParenLine: cpLine, gciInsertLine: giLine };

  const axiom = await syncAxiomsToDocument(
    uri, entity, fmt, annot?.updatedText ?? baseContent,
    axiomHints.segment,
    axiomHints.gciSegment,
    axiomHints.closingParenLine,
    axiomHints.gciInsertLine,
    true,
    restoreHints ? { gcis: restoreHints.gcis, regAxioms: restoreHints.regAxioms } : undefined,
  );
  if (axiom) { ranges.push(...axiom.changedRanges); lineDelta += axiom.lineDelta; }

  const annotDeleted = annot?.deletedAnnotPositions;
  const gciDeleted = axiom?.deletedGciPositions;
  const regDeleted = axiom?.deletedRegAxiomPositions;
  const deletedPositions: PositionHints | undefined =
    ((annotDeleted?.size ?? 0) > 0 || (gciDeleted?.size ?? 0) > 0 || (regDeleted?.size ?? 0) > 0)
    ? { annotations: annotDeleted ?? new Map(), gcis: gciDeleted ?? new Map(), regAxioms: regDeleted ?? new Map() }
    : undefined;

  return {
    text: axiom?.updatedText ?? annot?.updatedText,
    ranges, lineDelta,
    annotEditSummaries: annot?.editSummaries ?? [],
    axiomEditSummaries: axiom?.editSummaries ?? [],
    deletedPositions,
  };
}

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(
  msg: EntityEditorWebviewToExt,
  p: vscode.WebviewPanel,
  model: OntologyModel,
  context: vscode.ExtensionContext,
): void {
  switch (msg.type) {
    case 'ready':
      sendLoadEntity(p, model, lastIri);
      if (lastIri && !entityHistoryMap.has(lastIri)) {
        const payload = buildEntityPayload(model, lastIri);
        if (payload) { entityHistoryMap.set(lastIri, new EntityEditHistory(payload)); }
      }
      {
        const h = entityHistoryMap.get(lastIri);
        postUndoRedoState(p, h?.canUndo ?? false, h?.canRedo ?? false);
      }
      break;

    case 'undoRequest': {
      const undoHistory = entityHistoryMap.get(lastIri);
      if (!undoHistory?.canUndo) { break; }
      const entry = undoHistory.undo();
      if (entry) {
        _pendingRestoreHints = entry.restoreHints;
        void p.webview.postMessage({ type: 'loadEntity', ...entry.snapshot } as EntityEditorExtToWebview);
        postUndoRedoState(p, undoHistory.canUndo, undoHistory.canRedo);
        _autoSaveInProgress = true;
        void p.webview.postMessage({ type: 'autoSave' } as EntityEditorExtToWebview);
      }
      break;
    }

    case 'redoRequest': {
      const redoHistory = entityHistoryMap.get(lastIri);
      if (!redoHistory?.canRedo) { break; }
      const entry = redoHistory.redo();
      if (entry) {
        _pendingRestoreHints = entry.restoreHints;
        void p.webview.postMessage({ type: 'loadEntity', ...entry.snapshot } as EntityEditorExtToWebview);
        postUndoRedoState(p, redoHistory.canUndo, redoHistory.canRedo);
        _autoSaveInProgress = true;
        void p.webview.postMessage({ type: 'autoSave' } as EntityEditorExtToWebview);
      }
      break;
    }

    case 'renameIri': {
      const { currentIri, newIri } = msg;
      const postError = (error: string) => {
        void p.webview.postMessage({
          type: 'iriRenameResult', success: false, error,
        } as IriRenameResultMessage as EntityEditorExtToWebview);
      };

      // Validation
      if (!newIri) { postError('IRI must not be empty'); break; }
      if (!isValidAbsoluteIri(newIri)) { postError('Not a valid IRI'); break; }

      // Format guard
      if (model.sourceFormat === 'rdf-xml' || model.sourceFormat === 'owl-xml') {
        postError('IRI rename is not supported for OWL/XML format; convert to OWL Functional Syntax first.');
        break;
      }

      // Duplicate check
      const renameIndex = getIndex(model);
      if (renameIndex.getByIri(newIri) !== undefined) {
        postError('An entity with this IRI already exists');
        break;
      }

      // Apply rename asynchronously
      const renameUri = vscode.Uri.parse(model.sourceUri);
      let renameWriteOk = false;
      void queueSyncWrite(renameUri.toString(), async () => {
        const oldRawContent = model.rawContent;
        const newText = renameIri(oldRawContent, currentIri, newIri);
        model.rawContent = newText;

        // Move entity from old IRI to new IRI in the correct Map
        const mapKeys = ['classes', 'objectProperties', 'dataProperties', 'annotationProperties', 'individuals'] as const;
        let movedMapKey: typeof mapKeys[number] | undefined;
        for (const mapKey of mapKeys) {
          const map = model[mapKey] as Map<string, { iri: string }>;
          const entity = map.get(currentIri);
          if (entity) {
            entity.iri = newIri;
            map.delete(currentIri);
            map.set(newIri, entity);
            movedMapKey = mapKey;
            break;
          }
        }

        // Patch all other entities' axiom arrays that reference currentIri so that
        // saving a referencing entity later does not revert the rename in the file.
        updateIriReferencesInModel(model, currentIri, newIri);

        // Force segment index rebuild (async to avoid blocking the event loop)
        model.entitySegments = undefined;
        if (model.sourceFormat === 'functional') {
          await buildModelSegmentIndexAsync(model);
        }

        // Invalidate panel's cached index
        _cachedIndexModel = undefined;
        _cachedIndex = undefined;

        try {
          await writeTextStreamed(renameUri, newText);
          renameWriteOk = true;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[OntoGraph rename] writeFile FAILED: ${errMsg}`);
          void vscode.window.showErrorMessage(`OntoGraph: cannot write file — ${errMsg}.`);

          // Rollback in-memory mutations so the model stays consistent with the on-disk file
          model.rawContent = oldRawContent;
          if (movedMapKey) {
            const map = model[movedMapKey] as Map<string, { iri: string }>;
            const renamedEntity = map.get(newIri);
            if (renamedEntity) {
              renamedEntity.iri = currentIri;
              map.delete(newIri);
              map.set(currentIri, renamedEntity);
            }
          }
          updateIriReferencesInModel(model, newIri, currentIri);
          model.entitySegments = undefined;
          _cachedIndexModel = undefined;
          _cachedIndex = undefined;

          postError(`Write failed: ${errMsg}`);
        }
      }).then(() => {
        if (!renameWriteOk) { return; }

        // Update lastIri so the panel tracks the renamed entity
        lastIri = newIri;

        // Refresh tree providers
        _refreshAllViews?.(model);

        void p.webview.postMessage({
          type: 'iriRenameResult', success: true, newIri,
        } as IriRenameResultMessage as EntityEditorExtToWebview);
      }).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        postError(`Rename failed: ${errMsg}`);
      });
      break;
    }

    case 'dirtyState': {
      const typed = msg as DirtyStateMessage;
      if (dirtyQueryResolve) {
        const resolve = dirtyQueryResolve;
        dirtyQueryResolve = null;
        resolve(typed.isDirty);
      }
      break;
    }

    case 'navigate':
      showEntityInfo(context, model, msg.iri);
      void vscode.commands.executeCommand('ontograph.focusEntity', { iri: msg.iri });
      break;

    case 'focusEntity':
      void vscode.commands.executeCommand('ontograph.focusEntity', { iri: msg.iri });
      break;

    case 'openExternal':
      void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      break;

    case 'requestCompletion': {
      const index = getIndex(model);
      const entities = index.searchByLabel(msg.prefix, 50);
      const response: CompletionResultMessage = {
        type: 'completionResult',
        requestId: msg.requestId,
        items: entities.map(e => ({ label: getLabel(e), iri: e.iri, entityType: e.type })),
      };
      void p.webview.postMessage(response as EntityEditorExtToWebview);
      break;
    }

    case 'validate': {
      const { requestId, text } = msg;
      const vModel = currentPanelModel ?? model;
      const vIndex = getIndex(vModel);
      const errors = validateManchesterText(text, vModel, vIndex);
      const response: ValidationResultMessage = {
        type: 'validationResult',
        requestId,
        errors,
      };
      void p.webview.postMessage(response as EntityEditorExtToWebview);
      break;
    }

    case 'save': {
      const entity = findEntity(model, msg.iri);
      if (!entity) {
        void vscode.window.showWarningMessage(`OntoGraph: Entity not found: ${msg.iri}`);
        return;
      }
      const classificationAffectingChange = hasClassificationAffectingChange(entity, msg);
      const index = getIndex(model);
      const isAutoSave = _autoSaveInProgress;
      _autoSaveInProgress = false;
      const saveHistory = entityHistoryMap.get(msg.iri);

      // Collect draft expressions that failed validation (either flagged by the
      // webview linter OR rejected by server-side parse at save time).  Server-side
      // validation is the authoritative gate; the webview hint is a belt-and-suspenders
      // fallback for the timing window before the async linter completes.
      const newDrafts: DraftExpression[] = [];
      const invalidIdx = msg.invalidExpressionIndices;

      function filterSection(
        expressions: string[] | undefined,
        sectionKey: DraftExpression['sectionKey'],
      ): string[] {
        const all = expressions ?? [];
        const webviewBad = new Set(invalidIdx?.[sectionKey] ?? []);
        return all.filter((text, i) => {
          const isInvalid = webviewBad.has(i);
          if (isInvalid) { newDrafts.push({ text, sectionKey }); }
          return !isInvalid;
        });
      }

      switch (msg.entityType) {
        case 'class': {
          const cls = entity as OWLClass;
          if (isAutoSave && saveHistory?.currentSnapshot?.entityType === 'class') {
            // Auto-save: apply snapshot IRI arrays directly (full IRIs, no label round-trip).
            const snap = saveHistory.currentSnapshot;
            cls.superClassIris = snap.superClassIris ?? [];
            cls.equivalentClassIris = snap.equivalentClassIris ?? [];
            cls.disjointClassIris = snap.disjointClassIris ?? [];
            // Complex expressions: normalize from snapshot's rendered form
            cls.superClassExpressions = (snap.superClassExpressions ?? [])
              .map(e => normalizeExpression(e, model, index)).filter(e => e.length > 0);
            cls.equivalentClassExpressions = (snap.equivalentClassExpressions ?? [])
              .map(e => normalizeExpression(e, model, index)).filter(e => e.length > 0);
            cls.gciExpressions = (snap.gciExpressions ?? [])
              .map(e => normalizeExpression(e, model, index)).filter(e => e.length > 0);
          } else {
            const validSuper = filterSection(msg.superClassExpressions, 'superClassExpressions');
            const splitSuper = splitNormalizedExpressions(
              validSuper.map(e => normalizeExpression(sortManchesterConjuncts(e), model, index)));
            cls.superClassIris = splitSuper.namedClassIris;
            cls.superClassExpressions = splitSuper.complexExpressions;
            const validEquiv = filterSection(msg.equivalentClassExpressions, 'equivalentClassExpressions');
            const splitEquiv = splitNormalizedExpressions(
              validEquiv.map(e => normalizeExpression(sortManchesterConjuncts(e), model, index)));
            cls.equivalentClassIris = splitEquiv.namedClassIris;
            cls.equivalentClassExpressions = splitEquiv.complexExpressions;
            const validGci = filterSection(msg.gciExpressions, 'gciExpressions');
            cls.gciExpressions = validGci.map(e => normalizeExpression(sortManchesterConjuncts(e), model, index));
            cls.disjointClassIris = msg.disjointClassIris ?? [];
          }
          break;
        }
        case 'objectProperty': {
          const prop = entity as OWLObjectProperty;
          prop.superPropertyIris = msg.superPropertyIris ?? [];
          prop.domainIris = msg.domainIris ?? [];
          prop.rangeIris = msg.rangeIris ?? [];
          prop.inverseOfIri = msg.inverseOfIri || undefined;
          prop.isTransitive = msg.isTransitive;
          prop.isSymmetric = msg.isSymmetric;
          prop.isFunctional = msg.isFunctional;
          prop.isInverseFunctional = msg.isInverseFunctional;
          prop.isReflexive = msg.isReflexive;
          prop.isIrreflexive = msg.isIrreflexive;
          prop.isAsymmetric = msg.isAsymmetric;
          prop.equivalentPropertyIris = msg.equivalentPropertyIris ?? [];
          prop.disjointPropertyIris = msg.disjointPropertyIris ?? [];
          prop.propertyChains = msg.propertyChains ?? [];
          break;
        }
        case 'dataProperty': {
          const prop = entity as OWLDataProperty;
          prop.superPropertyIris = msg.superPropertyIris ?? [];
          prop.domainIris = msg.domainIris ?? [];
          prop.rangeIris = msg.rangeIris ?? [];
          prop.isFunctional = msg.isFunctional;
          break;
        }
        case 'annotationProperty': {
          const prop = entity as OWLAnnotationProperty;
          prop.superPropertyIris = msg.superPropertyIris ?? [];
          prop.domainIris = msg.domainIris ?? [];
          prop.rangeIris = msg.rangeIris ?? [];
          break;
        }
        case 'individual': {
          const ind = entity as OWLIndividual;
          ind.classIris = msg.classIris ?? [];
          ind.objectPropertyAssertions = msg.objectPropertyAssertions ?? [];
          ind.dataPropertyAssertions = msg.dataPropertyAssertions ?? [];
          break;
        }
      }

      if (msg.labels !== undefined)      { entity.labels = msg.labels; }
      if (msg.annotations !== undefined) { entity.annotations = msg.annotations; }

      // Update draft map: store new invalid drafts, or clear if all valid.
      if (newDrafts.length > 0) {
        draftAxioms.set(msg.iri, newDrafts);
        const errMsg: SaveDraftErrorMessage = {
          type: 'saveDraftError',
          invalidExpressions: newDrafts.map((d, originalIndex) => {
            // Reconstruct the original index within the full (pre-filter) expression array.
            const allForSection = msg[d.sectionKey] ?? [];
            const idx = (allForSection as string[]).indexOf(d.text);
            return { sectionKey: d.sectionKey, index: idx === -1 ? originalIndex : idx, text: d.text };
          }),
        };
        void p.webview.postMessage(errMsg as EntityEditorExtToWebview);
      } else {
        draftAxioms.delete(msg.iri);
      }

      // Invalidate the index so label changes are reflected in autocomplete
      _cachedIndex = undefined;
      if (classificationAffectingChange && model.isClassified && hasInferredHierarchy(model)) {
        model.classificationNeedsUpdate = true;
        // Flip the `classificationNeedsUpdate` context so the toolbar button
        // switches from "Classify" to the stale variant. Cheap setContext —
        // no tree-view refresh, no model re-scan.
        void vscode.commands.executeCommand('setContext', 'ontograph.classificationNeedsUpdate', true);
      }

      // Cache the saved state so sendLoadEntity always serves correct data
      // even if activeModel is re-parsed before applyEdit completes (race condition).
      savedEntityState.set(msg.iri, { labels: entity.labels, annotations: entity.annotations });

      // Persistence pipeline:
      //   1. queueSyncWrite serializes saves per URI so concurrent saves never
      //      race on baseContent or segment positions.
      //   2. Inside the queued task: compute updatedText (skipWrite=true on both
      //      sync funcs), update model.rawContent and segment offsets
      //      synchronously, then write to disk.
      //   3. While the queue task runs, isReloadSuppressed(uri) is true so the
      //      file watcher and handleDocument both skip re-parse — protects the
      //      in-memory model regardless of how long the write takes.
      _annotationSyncActive = true;
      const uri = vscode.Uri.parse(model.sourceUri);
      const fmt = model.sourceFormat;
      void queueSyncWrite(uri.toString(), async () => {
        try {
          // baseContent is a `let` so we can release the alias before the
          // disk write — once `model.rawContent` is overwritten with the new
          // text and this local reference is cleared, the ~200MB old string
          // is unreachable and can be reclaimed during the streamed write.
          let baseContent: string | undefined = model.rawContent || undefined;

          // Segment hints: scan only the entity's cluster (O(cluster) vs O(N)).
          const seg = model.entitySegments?.get(entity.iri);
          const gciSeg = entity.type === 'class' ? model.gciSegments?.get(entity.iri) : undefined;
          const cpLine = model.closingParenLine;
          const giLine = model.gciInsertLine;

          const {
            text: updatedText,
            ranges: changedRanges,
            annotEditSummaries,
            axiomEditSummaries,
            deletedPositions,
          } = await computeUpdatedText(uri, entity, fmt, baseContent, seg, gciSeg, cpLine, giLine, _pendingRestoreHints);
          _pendingRestoreHints = undefined;

          if (updatedText !== undefined) {
            // Update model state SYNCHRONOUSLY before the writeFile await.
            model.rawContent = updatedText;
            baseContent = undefined;

            // Incremental segment-index update. Apply annot summaries first
            // (positions in original baseContent frame), then axiom summaries
            // (positions in annot's post-edit frame). Each is O(N entities +
            // sum of lineIndices); typical save = ~50-200ms total vs ~2s for
            // a full rebuild.
            if (annotEditSummaries.length > 0) {
              applyIncrementalSegmentUpdate(model, entity.iri, annotEditSummaries);
            }
            if (axiomEditSummaries.length > 0) {
              applyIncrementalSegmentUpdate(model, entity.iri, axiomEditSummaries);
            }
            _incrementalSavesSinceRebuild++;

            let writeOk = false;
            try {
              await writeTextStreamed(uri, updatedText);
              writeOk = true;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.error(`[OntoGraph save] writeFile FAILED: ${errMsg}`);
              void vscode.window.showErrorMessage(`OntoGraph: cannot write file — ${errMsg}.`);
            }

            // Refresh fingerprint only if the write succeeded — otherwise the
            // file on disk no longer matches the in-memory model and we don't
            // want reload to skip a re-parse.
            if (writeOk) {
              try {
                const stat = await vscode.workspace.fs.stat(uri);
                model.sourceMtimeMs = stat.mtime;
                model.sourceSize = stat.size;
              } catch { /* non-fatal */ }
            }

            // Periodic safety-anchor: every N incremental saves, do a full
            // segment rebuild from rawContent. Catches any drift accumulated
            // by the incremental updater (off-by-one shifts, missed edges,
            // etc). Runs AFTER writeFile + status messages so the user-visible
            // save latency is unaffected.
            if (_incrementalSavesSinceRebuild >= FULL_REBUILD_EVERY_N_SAVES) {
              _incrementalSavesSinceRebuild = 0;
              await buildModelSegmentIndexAsync(model);
            }

            // Complete deferred navigation triggered by the dirty-guard "Save" choice.
            if (pendingNavigationIri && currentPanelModel) {
              const targetIri = pendingNavigationIri;
              pendingNavigationIri = null;
              if (writeOk) {
                showEntityInfo(context, currentPanelModel, targetIri);
              }
              // On write failure: pendingNavigationIri cleared; error already shown above.
            }
          }
          highlightSyncedRanges(uri, changedRanges);

          if (saveHistory && !isAutoSave) {
            const newSnapshot = buildEntityPayload(model, msg.iri);
            if (newSnapshot) {
              saveHistory.recordSave(newSnapshot, deletedPositions);
              postUndoRedoState(p, saveHistory.canUndo, saveHistory.canRedo);
            }
          } else if (saveHistory && isAutoSave) {
            const newSnapshot = buildEntityPayload(model, msg.iri);
            if (newSnapshot) { saveHistory.updateCurrentSnapshot(newSnapshot); }
          }

        } finally {
          _annotationSyncActive = false;
          savedEntityState.delete(msg.iri);
        }
      });

      // No tree-view refresh after save. Tree providers cache hierarchy and
      // labels; rebuilding the index on every save is O(N) per provider × 6
      // providers (~2-3s on SNOMED-scale) and would freeze the UI for a
      // single-entity edit. Tree stays as a navigation cache — when the user
      // clicks an entity, sendLoadEntity reads fresh data from the runtime
      // model. Full refresh happens only on explicit reload of the ontology.
      //
      // For regular saves: bypass history so the display shows the just-saved
      // model state. currentSnapshot still holds the pre-save state at this point
      // (recordSave inside queueSyncWrite hasn't run yet), so we must skip it or
      // the editor would show stale axioms. For autoSave (undo/redo triggered):
      // use the history snapshot, which was set to the undo target by undo()/redo().
      sendLoadEntity(p, model, msg.iri, /* bypassHistory */ !isAutoSave);

      if (saveHistory) {
        postUndoRedoState(p, saveHistory.canUndo, saveHistory.canRedo);
      }

      vscode.window.setStatusBarMessage(`$(check) OntoGraph: Saved ${getLabel(entity)}`, 4000);
      break;
    }
  }
}

// ── Load entity message builder ───────────────────────────────────────────────

/** Builds the entity snapshot payload from the current model state. Returns undefined if the IRI is unknown. */
export function buildEntityPayload(model: OntologyModel, iri: string): EntitySnapshot | undefined {
  const entity = findEntity(model, iri);
  if (!entity) { return undefined; }

  const cfg = vscode.workspace.getConfiguration('ontograph');
  const lang = cfg.get<string>('display.preferredLabelLanguage') ?? 'en';
  const style = (cfg.get<string>('display.axiomEntityStyle') ?? 'label') as AxiomDisplayStyle;

  // Collect all IRIs that need display labels
  const allIris = new Set<string>();

  if (entity.type === 'class') {
    const cls = entity as OWLClass;
    for (const i of [...cls.superClassIris, ...cls.equivalentClassIris, ...cls.disjointClassIris]) {
      allIris.add(i);
    }
  } else if (
    entity.type === 'objectProperty' ||
    entity.type === 'dataProperty' ||
    entity.type === 'annotationProperty'
  ) {
    const prop = entity as OWLObjectProperty;
    for (const i of [...(prop.superPropertyIris ?? []), ...(prop.domainIris ?? []), ...(prop.rangeIris ?? [])]) {
      allIris.add(i);
    }
    if (entity.type === 'objectProperty') {
      const op = entity as OWLObjectProperty;
      if (op.inverseOfIri) allIris.add(op.inverseOfIri);
      for (const i of (op.equivalentPropertyIris ?? [])) allIris.add(i);
      for (const i of (op.disjointPropertyIris ?? [])) allIris.add(i);
      for (const chain of (op.propertyChains ?? [])) for (const i of chain) allIris.add(i);
    }
  } else if (entity.type === 'individual') {
    const ind = entity as OWLIndividual;
    for (const i of ind.classIris) { allIris.add(i); }
    for (const a of ind.objectPropertyAssertions) {
      allIris.add(a.propertyIri);
      allIris.add(a.targetIri);
    }
    for (const a of ind.dataPropertyAssertions) { allIris.add(a.propertyIri); }
  }

  const iriLabels: Record<string, string> = {};
  for (const i of allIris) {
    const e = findEntity(model, i);
    iriLabels[i] = e ? getLabel(e, lang) : localName(i);
  }

  // Prefer the in-panel saved state over the (possibly stale) model data.
  // This handles the race where activeModel is re-parsed before applyEdit completes.
  const saved = savedEntityState.get(iri);
  const effectiveLabels = saved?.labels ?? entity.labels;
  const effectiveAnnotations = saved?.annotations ?? entity.annotations;

  const payload: EntitySnapshot = {
    entityType: entity.type,
    iri: entity.iri,
    label: getLabel({ ...entity, labels: effectiveLabels }, lang),
    labels: effectiveLabels,
    annotations: effectiveAnnotations,
    displayStyle: style,
    iriLabels,
    expressionEntityRefs: {},
  };

  if (entity.type === 'class') {
    const cls = entity as OWLClass;
    payload.superClassIris = cls.superClassIris;
    payload.superClassExpressions = renderExpressionsWithRefs(
      'superClassExpressions',
      cls.superClassExpressions ?? [],
      payload.expressionEntityRefs!,
      model,
      style,
      lang,
    );
    payload.equivalentClassIris = cls.equivalentClassIris;
    payload.equivalentClassExpressions = renderExpressionsWithRefs(
      'equivalentClassExpressions',
      cls.equivalentClassExpressions ?? [],
      payload.expressionEntityRefs!,
      model,
      style,
      lang,
    );
    payload.gciExpressions = renderExpressionsWithRefs(
      'gciExpressions',
      cls.gciExpressions ?? [],
      payload.expressionEntityRefs!,
      model,
      style,
      lang,
    );
    payload.disjointClassIris = cls.disjointClassIris;
  } else if (entity.type === 'objectProperty') {
    const prop = entity as OWLObjectProperty;
    payload.superPropertyIris = prop.superPropertyIris;
    payload.domainIris = prop.domainIris;
    payload.rangeIris = prop.rangeIris;
    payload.isTransitive = prop.isTransitive;
    payload.isSymmetric = prop.isSymmetric;
    payload.isFunctional = prop.isFunctional;
    payload.isInverseFunctional = prop.isInverseFunctional;
    payload.isReflexive = prop.isReflexive;
    payload.isIrreflexive = prop.isIrreflexive;
    payload.isAsymmetric = prop.isAsymmetric;
    payload.inverseOfIri = prop.inverseOfIri;
    payload.equivalentPropertyIris = prop.equivalentPropertyIris ?? [];
    payload.disjointPropertyIris = prop.disjointPropertyIris ?? [];
    payload.propertyChains = prop.propertyChains ?? [];
  } else if (entity.type === 'dataProperty') {
    const prop = entity as OWLDataProperty;
    payload.superPropertyIris = prop.superPropertyIris;
    payload.domainIris = prop.domainIris;
    payload.rangeIris = prop.rangeIris;
    payload.isFunctional = prop.isFunctional;
  } else if (entity.type === 'annotationProperty') {
    const prop = entity as OWLAnnotationProperty;
    payload.superPropertyIris = prop.superPropertyIris;
    payload.domainIris = prop.domainIris;
    payload.rangeIris = prop.rangeIris;
  } else if (entity.type === 'individual') {
    const ind = entity as OWLIndividual;
    payload.classIris = ind.classIris;
    payload.objectPropertyAssertions = ind.objectPropertyAssertions;
    payload.dataPropertyAssertions = ind.dataPropertyAssertions;
  }

  return payload;
}

function sendLoadEntity(p: vscode.WebviewPanel, model: OntologyModel, iri: string, bypassHistory = false): void {
  // Use the history's current snapshot when available so that undo/redo state
  // is preserved across navigations and same-file refreshes.  Fall back to a
  // fresh buildEntityPayload when no history exists yet (initial load).
  // bypassHistory=true skips the snapshot lookup and reads directly from the
  // model — used after a regular save where currentSnapshot is still pre-save.
  const historySnapshot = bypassHistory ? undefined : entityHistoryMap.get(iri)?.currentSnapshot;
  const payload = historySnapshot ?? buildEntityPayload(model, iri);
  if (!payload) { return; }
  const msg: LoadEntityMessage = { type: 'loadEntity', ...payload };
  const drafts = draftAxioms.get(iri);
  if (drafts?.length) {
    msg.draftExpressions = drafts.map(d => ({ sectionKey: d.sectionKey, text: d.text }));
  }
  void p.webview.postMessage(msg as EntityEditorExtToWebview);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SINGLE_IRI_RE = /^https?:\/\/\S+$/;

/**
 * Splits a list of normalized expressions (bare full-IRI strings or Manchester
 * keyword strings) into named-class IRIs vs complex class expressions.
 * A normalized expression is a "named class" when it is a single bare IRI
 * with no spaces (e.g. "http://example.org/Animal"). Everything else
 * (containing spaces or Manchester operators) is a complex expression.
 */
export function splitNormalizedExpressions(normalized: string[]): {
  namedClassIris: string[];
  complexExpressions: string[];
} {
  return {
    namedClassIris: normalized.filter(e => SINGLE_IRI_RE.test(e)),
    complexExpressions: normalized.filter(e => !SINGLE_IRI_RE.test(e)),
  };
}

export function renderExpressionsWithRefs(
  sectionKey: string,
  expressions: string[],
  refsBySection: NonNullable<LoadEntityMessage['expressionEntityRefs']>,
  model: OntologyModel,
  style: AxiomDisplayStyle,
  lang: string,
): string[] {
  const renderedExpressions: string[] = [];
  const perExprRefs: NonNullable<LoadEntityMessage['expressionEntityRefs']>[string] = [];

  for (const expr of expressions) {
    const rendered = renderExpressionWithEntityRefs(expr, model, style, lang, true);
    renderedExpressions.push(rendered.text);
    perExprRefs.push(rendered.refs);
  }

  refsBySection[sectionKey] = perExprRefs;
  return renderedExpressions;
}

function findEntity(model: OntologyModel, iri: string) {
  return model.classes.get(iri)
    ?? model.objectProperties.get(iri)
    ?? model.dataProperties.get(iri)
    ?? model.annotationProperties.get(iri)
    ?? model.individuals.get(iri);
}

/**
 * Patch every entity's axiom arrays and Manchester expression strings to replace
 * occurrences of `oldIri` with `newIri`. Called after an IRI rename so that
 * referencing entities stay consistent with the updated rawContent; without this,
 * AxiomSync would revert the rename the next time any referencing entity is saved.
 */
function updateIriReferencesInModel(model: OntologyModel, oldIri: string, newIri: string): void {
  function replaceInArray(arr: string[]): void {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === oldIri) { arr[i] = newIri; }
    }
  }
  function replaceInExpressions(arr: string[]): void {
    const from = `<${oldIri}>`;
    const to = `<${newIri}>`;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].includes(from)) { arr[i] = arr[i].split(from).join(to); }
    }
  }

  for (const cls of model.classes.values()) {
    replaceInArray(cls.superClassIris);
    replaceInArray(cls.equivalentClassIris);
    replaceInArray(cls.disjointClassIris);
    replaceInExpressions(cls.superClassExpressions);
    replaceInExpressions(cls.equivalentClassExpressions);
    replaceInExpressions(cls.gciExpressions);
  }
  for (const prop of model.objectProperties.values()) {
    replaceInArray(prop.superPropertyIris);
    replaceInArray(prop.domainIris);
    replaceInArray(prop.rangeIris);
    if (prop.inverseOfIri === oldIri) { prop.inverseOfIri = newIri; }
    if (prop.equivalentPropertyIris) { replaceInArray(prop.equivalentPropertyIris); }
    if (prop.disjointPropertyIris) { replaceInArray(prop.disjointPropertyIris); }
    if (prop.propertyChains) {
      for (const chain of prop.propertyChains) { replaceInArray(chain); }
    }
  }
  for (const prop of model.dataProperties.values()) {
    replaceInArray(prop.superPropertyIris);
    replaceInArray(prop.domainIris);
    replaceInArray(prop.rangeIris);
  }
  for (const prop of model.annotationProperties.values()) {
    replaceInArray(prop.superPropertyIris);
    replaceInArray(prop.domainIris);
    replaceInArray(prop.rangeIris);
  }
  for (const ind of model.individuals.values()) {
    replaceInArray(ind.classIris);
    for (const a of ind.objectPropertyAssertions) {
      if (a.propertyIri === oldIri) { a.propertyIri = newIri; }
      if (a.targetIri === oldIri) { a.targetIri = newIri; }
    }
    for (const a of ind.dataPropertyAssertions) {
      if (a.propertyIri === oldIri) { a.propertyIri = newIri; }
    }
  }
}

function hasInferredHierarchy(model: OntologyModel): boolean {
  for (const children of model.inferredSubClasses.values()) {
    if (children.size > 0) { return true; }
  }
  return false;
}

function hasClassificationAffectingChange(
  entity: NonNullable<ReturnType<typeof findEntity>>,
  msg: Extract<EntityEditorWebviewToExt, { type: 'save' }>,
): boolean {
  const sameStringArray = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
    JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const sameChains = (a: readonly string[][] | undefined, b: readonly string[][] | undefined) =>
    JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const sameObjAssertions = (
    a: readonly { propertyIri: string; targetIri: string }[] | undefined,
    b: readonly { propertyIri: string; targetIri: string }[] | undefined,
  ) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const sameDataAssertions = (
    a: readonly { propertyIri: string; value: string; datatype?: string }[] | undefined,
    b: readonly { propertyIri: string; value: string; datatype?: string }[] | undefined,
  ) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

  switch (entity.type) {
    case 'class': {
      const cls = entity as OWLClass;
      return !sameStringArray(cls.superClassIris, msg.superClassIris)
        || !sameStringArray(cls.superClassExpressions, msg.superClassExpressions)
        || !sameStringArray(cls.equivalentClassIris, msg.equivalentClassIris)
        || !sameStringArray(cls.equivalentClassExpressions, msg.equivalentClassExpressions)
        || !sameStringArray(cls.gciExpressions, msg.gciExpressions)
        || !sameStringArray(cls.disjointClassIris, msg.disjointClassIris);
    }
    case 'objectProperty': {
      const prop = entity as OWLObjectProperty;
      return !sameStringArray(prop.superPropertyIris, msg.superPropertyIris)
        || !sameStringArray(prop.domainIris, msg.domainIris)
        || !sameStringArray(prop.rangeIris, msg.rangeIris)
        || (prop.inverseOfIri ?? undefined) !== (msg.inverseOfIri || undefined)
        || !!prop.isTransitive !== !!msg.isTransitive
        || !!prop.isSymmetric !== !!msg.isSymmetric
        || !!prop.isFunctional !== !!msg.isFunctional
        || !!prop.isInverseFunctional !== !!msg.isInverseFunctional
        || !!prop.isReflexive !== !!msg.isReflexive
        || !!prop.isIrreflexive !== !!msg.isIrreflexive
        || !!prop.isAsymmetric !== !!msg.isAsymmetric
        || !sameStringArray(prop.equivalentPropertyIris, msg.equivalentPropertyIris)
        || !sameStringArray(prop.disjointPropertyIris, msg.disjointPropertyIris)
        || !sameChains(prop.propertyChains, msg.propertyChains);
    }
    case 'dataProperty': {
      const prop = entity as OWLDataProperty;
      return !sameStringArray(prop.superPropertyIris, msg.superPropertyIris)
        || !sameStringArray(prop.domainIris, msg.domainIris)
        || !sameStringArray(prop.rangeIris, msg.rangeIris)
        || !!prop.isFunctional !== !!msg.isFunctional;
    }
    case 'annotationProperty': {
      const prop = entity as OWLAnnotationProperty;
      return !sameStringArray(prop.superPropertyIris, msg.superPropertyIris)
        || !sameStringArray(prop.domainIris, msg.domainIris)
        || !sameStringArray(prop.rangeIris, msg.rangeIris);
    }
    case 'individual': {
      const ind = entity as OWLIndividual;
      return !sameStringArray(ind.classIris, msg.classIris)
        || !sameObjAssertions(ind.objectPropertyAssertions, msg.objectPropertyAssertions)
        || !sameDataAssertions(ind.dataPropertyAssertions, msg.dataPropertyAssertions);
    }
  }
}

function localName(iri: string): string {
  const h = iri.lastIndexOf('#');
  const s = iri.lastIndexOf('/');
  const pos = Math.max(h, s);
  return pos >= 0 ? iri.slice(pos + 1) : iri;
}


// Wraps bare HTTP(S) IRIs with angle brackets so the Manchester parser sees
// the <IRI> token form it expects.  Mirrors the helper in DLQueryPanel.ts.
function wrapIrisInAngleBrackets(expr: string): string {
  return expr.replace(/https?:\/\/[^\s(),{}<>]+/g, u => `<${u}>`);
}

// Normalises display-format text to a single-line <IRI>-form Manchester
// expression.  Steps:
//   1. collectLogicalLines  — join visual line-continuations ("    and …")
//   2. normalizeExpression  — resolve label tokens to bare IRIs (requires model)
//   3. wrapIrisInAngleBrackets — wrap bare IRIs in < >
// Returns the normalised lines (usually one per editor).
function toNormalisedLines(text: string, model: OntologyModel, index: OntologyIndex): string[] {
  return collectLogicalLines(text)
    .map(line => wrapIrisInAngleBrackets(normalizeExpression(line, model, index)));
}

const DANGLING_KW = new Set([
  'some', 'only', 'and', 'or', 'not', 'min', 'max', 'exactly', 'value',
]);

// Manchester logical/restriction keywords (lowercase) used in entity-ref scan.
const MANCHESTER_KW_LC = new Set([
  'some', 'only', 'value', 'min', 'max', 'exactly', 'and', 'or', 'not', 'that', 'self',
]);

// Returns true when a Manchester expression is structurally incomplete —
// ends with a keyword that requires an argument, or has unbalanced parens.
function isIncomplete(expr: string): boolean {
  const parts = expr.trimEnd().split(/\s+/);
  const last = parts[parts.length - 1]?.toLowerCase() ?? '';
  if (DANGLING_KW.has(last)) { return true; }
  let depth = 0;
  for (const c of expr) {
    if (c === '(') { depth++; }
    else if (c === ')') { depth--; if (depth < 0) { return true; } }
  }
  return depth !== 0;
}

// After toNormalisedLines, resolved entity references become <IRI> tokens.
// Any remaining bare word (not a keyword or number) or single-quoted string
// is an entity reference that could not be resolved to a model entity.
function hasUnresolvedEntityRef(normalizedLine: string): boolean {
  let i = 0;
  const n = normalizedLine.length;
  while (i < n) {
    const c = normalizedLine[i];
    if (' \t\n\r(),{}'.includes(c)) { i++; continue; }

    // Angle-bracket IRI — resolved entity reference
    if (c === '<') {
      const end = normalizedLine.indexOf('>', i + 1);
      i = end > i ? end + 1 : i + 1;
      continue;
    }

    // Single-quoted string — label that failed to resolve to any entity IRI
    if (c === "'") { return true; }

    // Double-quoted string literal — not an entity ref
    if (c === '"') {
      let j = i + 1;
      while (j < n && normalizedLine[j] !== '"') {
        if (normalizedLine[j] === '\\') { j++; }
        j++;
      }
      i = j + 1;
      continue;
    }

    // Read bare token
    const start = i;
    while (i < n && !' \t\n\r(),{}"\'<>'.includes(normalizedLine[i])) { i++; }
    const token = normalizedLine.slice(start, i);
    if (!token) { i++; continue; }

    // Pure number — shortIri display mode uses numeric SNOMED codes; skip
    if (/^\d+(\.\d+)?$/.test(token)) { continue; }

    // Manchester keyword
    if (MANCHESTER_KW_LC.has(token.toLowerCase())) { continue; }

    // Bare IRI without angle brackets (should not occur after wrapIrisInAngleBrackets)
    if (token.startsWith('http://') || token.startsWith('https://')) { continue; }

    // Anything else is an unresolved entity reference
    return true;
  }
  return false;
}

export function validateManchesterText(
  text: string,
  model?: OntologyModel,
  index?: OntologyIndex,
): { from: number; to: number; severity: 'error' | 'warning'; message: string }[] {
  const errors: { from: number; to: number; severity: 'error' | 'warning'; message: string }[] = [];

  // When model and index are available, normalise to <IRI> form so that:
  // (a) label tokens (e.g. 'Body structure') are not mistaken for dangling keywords
  // (b) unresolved entity references (unknown labels/names) can be detected
  const lines = (model && index)
    ? toNormalisedLines(text, model, index)
    : collectLogicalLines(text);

  for (const line of lines) {
    if (isIncomplete(line)) {
      errors.push({ from: 0, to: text.length, severity: 'error', message: 'Incomplete expression' });
    } else if (model && index && hasUnresolvedEntityRef(line)) {
      errors.push({ from: 0, to: text.length, severity: 'error', message: 'Unknown entity reference' });
    }
  }

  return errors;
}

// ── HTML wrapper ──────────────────────────────────────────────────────────────

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'entity-editor-webview.js'),
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
             img-src ${webview.cspSource} data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OntoGraph: Entity Info</title>
  <style>
    html, body { height: 100%; margin: 0; overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
  </style>
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
