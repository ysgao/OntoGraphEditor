import type { EntityType } from '../model/OntologyModel';

// ── Extension → Webview ───────────────────────────────────────────────────────

export interface LoadEntityMessage {
  type: 'loadEntity';
  entityType: EntityType;
  iri: string;
  label: string;
  labels: Record<string, string[]>;
  annotations: Record<string, string[]>;
  displayStyle: 'label' | 'shortIri' | 'fullIri';

  // Class
  superClassIris?: string[];
  superClassExpressions?: string[];
  equivalentClassIris?: string[];
  equivalentClassExpressions?: string[];
  gciExpressions?: string[];
  disjointClassIris?: string[];

  // Object/Data/Annotation property
  superPropertyIris?: string[];
  domainIris?: string[];
  rangeIris?: string[];
  isTransitive?: boolean;
  isSymmetric?: boolean;
  isFunctional?: boolean;
  isInverseFunctional?: boolean;
  isReflexive?: boolean;
  isIrreflexive?: boolean;
  isAsymmetric?: boolean;
  inverseOfIri?: string;
  equivalentPropertyIris?: string[];
  disjointPropertyIris?: string[];
  propertyChains?: string[][];

  // Individual
  classIris?: string[];
  objectPropertyAssertions?: { propertyIri: string; targetIri: string }[];
  dataPropertyAssertions?: { propertyIri: string; value: string; datatype?: string }[];

  /** IRI → human-readable label for all IRIs in the list fields */
  iriLabels: Record<string, string>;

  /** CodeMirror ranges for clickable entity tokens in expression sections, per expression */
  expressionEntityRefs?: Record<string, {
    from: number;
    to: number;
    iri: string;
    entityType: EntityType;
    label: string;
  }[][]>;

  /** Draft invalid expressions from a previous save, keyed by section. */
  draftExpressions?: Array<{
    sectionKey: 'superClassExpressions' | 'equivalentClassExpressions' | 'gciExpressions';
    text: string;
  }>;
}

export interface CompletionResultMessage {
  type: 'completionResult';
  requestId: number;
  items: { label: string; iri: string; entityType: string }[];
}

export interface ValidationResultMessage {
  type: 'validationResult';
  requestId: number;
  errors: { from: number; to: number; severity: 'error' | 'warning'; message: string }[];
}

// ── Webview → Extension ───────────────────────────────────────────────────────

export interface EntityEditorReadyMessage { type: 'ready' }
export interface RequestCompletionMessage { type: 'requestCompletion'; requestId: number; prefix: string }
export interface ValidateMessage { type: 'validate'; requestId: number; text: string }
export interface NavigateMessage { type: 'navigate'; iri: string }
export interface FocusEntityMessage { type: 'focusEntity'; iri: string }
export interface OpenExternalMessage { type: 'openExternal'; url: string }

export interface SaveEntityMessage {
  type: 'save';
  iri: string;
  entityType: EntityType;
  /** Zero-based indices within each expression array that have CodeMirror error diagnostics. */
  invalidExpressionIndices?: {
    superClassExpressions?: number[];
    equivalentClassExpressions?: number[];
    gciExpressions?: number[];
  };
  superClassIris?: string[];
  superClassExpressions?: string[];
  equivalentClassIris?: string[];
  equivalentClassExpressions?: string[];
  gciExpressions?: string[];
  disjointClassIris?: string[];
  superPropertyIris?: string[];
  domainIris?: string[];
  rangeIris?: string[];
  isTransitive?: boolean;
  isSymmetric?: boolean;
  isFunctional?: boolean;
  isInverseFunctional?: boolean;
  isReflexive?: boolean;
  isIrreflexive?: boolean;
  isAsymmetric?: boolean;
  inverseOfIri?: string;
  equivalentPropertyIris?: string[];
  disjointPropertyIris?: string[];
  propertyChains?: string[][];
  classIris?: string[];
  objectPropertyAssertions?: { propertyIri: string; targetIri: string }[];
  dataPropertyAssertions?: { propertyIri: string; value: string; datatype?: string }[];
  labels?: Record<string, string[]>;
  annotations?: Record<string, string[]>;
}

export interface SaveDraftErrorMessage {
  type: 'saveDraftError';
  invalidExpressions: Array<{ sectionKey: string; index: number; text: string }>;
}

/** Snapshot of all entity editor fields at a point in time — stored by EntityEditHistory. */
export type EntitySnapshot = Omit<LoadEntityMessage, 'type' | 'draftExpressions'>;

/** Post-delete file line numbers for items removed during a save — used by undo to restore to the original file location. */
export interface PositionHints {
  /** annotation key (propIri|text|lang) → post-delete line */
  annotations: Map<string, number>;
  /** trimmed GCI axiom line text → post-delete line */
  gcis: Map<string, number>;
  /** trimmed regular axiom line text → post-delete line */
  regAxioms: Map<string, number>;
}

export interface UndoRequestMessage { type: 'undoRequest' }
export interface RedoRequestMessage { type: 'redoRequest' }
export interface UndoRedoStateMessage { type: 'undoRedoState'; canUndo: boolean; canRedo: boolean }
export interface AutoSaveMessage { type: 'autoSave' }

export type EntityEditorExtToWebview =
  | LoadEntityMessage
  | CompletionResultMessage
  | ValidationResultMessage
  | SaveDraftErrorMessage
  | UndoRedoStateMessage
  | AutoSaveMessage;
export type EntityEditorWebviewToExt =
  | EntityEditorReadyMessage
  | RequestCompletionMessage
  | ValidateMessage
  | NavigateMessage
  | FocusEntityMessage
  | OpenExternalMessage
  | SaveEntityMessage
  | UndoRequestMessage
  | RedoRequestMessage;
