/**
 * IPC message contracts crossing the VS Code extension host bridge.
 * Shared between authoringPanel.ts, extension.ts, and the authoring webview.
 */

export interface ConceptFocusMessage {
  command: 'CONCEPT_FOCUS';
  payload: {
    /** SNOMED CT concept SCTID */
    id: string;
    /** Human-readable FSN or PT */
    label: string;
  };
}

export interface GraphNodeSelectMessage {
  command: 'GRAPH_NODE_SELECT';
  payload: {
    /** SNOMED CT concept SCTID */
    id: string;
  };
}

export interface TaskContextChangedMessage {
  command: 'TASK_CONTEXT_CHANGED';
  /** null when the user has navigated away from any task-editing screen. */
  payload: {
    projectKey: string;
    taskKey: string;
    branchPath: string;
  } | null;
}

export interface ValidationResultItem {
  componentId?: string;
  conceptId?: string;
  severity?: string;
  message?: string;
}

/** Host-initiated only — pushed after a headless authoring-cli write so a human watching the
 * same task in the open Authoring panel sees the same save-time validation messages
 * (case significance conflicts, duplicate descriptions, redundant relationships, etc.) that the
 * interactive editor would have shown after a manual save with validate=true. */
export interface ValidationResultsMessage {
  command: 'VALIDATION_RESULTS';
  payload: {
    conceptId: string;
    validationResults: ValidationResultItem[];
  };
}

export type IpcMessage = ConceptFocusMessage | GraphNodeSelectMessage | TaskContextChangedMessage | ValidationResultsMessage;

export function isConceptFocus(msg: unknown): msg is ConceptFocusMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ConceptFocusMessage).command === 'CONCEPT_FOCUS'
  );
}

export function isGraphNodeSelect(msg: unknown): msg is GraphNodeSelectMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as GraphNodeSelectMessage).command === 'GRAPH_NODE_SELECT'
  );
}

export function isTaskContextChanged(msg: unknown): msg is TaskContextChangedMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as TaskContextChangedMessage).command === 'TASK_CONTEXT_CHANGED'
  );
}
