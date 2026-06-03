/**
 * IPC message contracts crossing the VS Code extension host bridge.
 * Both webview panels (authoring + graph) and extension.ts import from this file.
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

export type IpcMessage = ConceptFocusMessage | GraphNodeSelectMessage;

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
