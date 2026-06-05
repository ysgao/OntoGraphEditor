/** Node in the graph view */
export interface GraphNode {
  id: string;          // IRI
  label: string;
  type: 'class' | 'objectProperty' | 'dataProperty' | 'annotationProperty' | 'individual';
  isRoot?: boolean;    // focused / entry node
  isInferred?: boolean;
}

/** Edge in the graph view */
export interface GraphEdge {
  id: string;
  source: string;      // IRI
  target: string;      // IRI
  type: 'subClassOf' | 'equivalentTo' | 'disjointWith' | 'subPropertyOf'
      | 'domain' | 'range' | 'type' | 'inverseOf' | 'inferred';
  label?: string;
  isInferred?: boolean;
}

// ── Extension → Webview ─────────────────────────────────────────────────────

export interface UpdateGraphMessage {
  type: 'updateGraph';
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusIri?: string;
}

export interface SelectNodeMessage {
  type: 'selectNode';
  iri: string;
}

// ── Webview → Extension ─────────────────────────────────────────────────────

export interface ReadyMessage            { type: 'ready'; }
export interface NodeClickedMessage      { type: 'nodeClicked'; iri: string; }
export interface RequestNeighborhoodMessage {
  type: 'requestNeighborhood';
  iri: string;
  depth: number;
  showInferred: boolean;
  showDisjoint: boolean;
}

export type ExtToWebview = UpdateGraphMessage | SelectNodeMessage;
export type WebviewToExt = ReadyMessage | NodeClickedMessage | RequestNeighborhoodMessage;
