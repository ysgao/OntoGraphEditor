export type DLQueryType =
  | 'directSuperClasses'
  | 'superClasses'
  | 'equivalentClasses'
  | 'directSubClasses'
  | 'subClasses'
  | 'instances';

export const DL_QUERY_TYPE_LABELS: Record<DLQueryType, string> = {
  directSuperClasses: 'Direct superclasses',
  superClasses:       'Superclasses',
  equivalentClasses:  'Equivalent classes',
  directSubClasses:   'Direct subclasses',
  subClasses:         'Subclasses',
  instances:          'Instances',
};

export const DEFAULT_QUERY_TYPES: DLQueryType[] = [
  'directSuperClasses',
  'directSubClasses',
  'subClasses',
];

export interface EntityRef {
  iri: string;
  label: string;
  entityType: 'class' | 'individual';
}

export interface ResultGroup {
  queryType: DLQueryType;
  label: string;
  entities: EntityRef[];
}

export interface CompletionItem {
  label: string;
  iri: string;
  entityType: string;
}

export interface ValidationError {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

// Extension → Webview
export type DLQueryExtToWebview =
  | { type: 'dlQueryResult'; groups: ResultGroup[] }
  | { type: 'dlQueryError';  message: string }
  | { type: 'dlQueryLoading' }
  | { type: 'ontologyStatus'; hasOntology: boolean }
  | { type: 'completionResult'; requestId: number; items: CompletionItem[] }
  | { type: 'validationResult'; requestId: number; errors: ValidationError[] };

// Webview → Extension
export type DLQueryWebviewToExt =
  | { type: 'execute'; classExpression: string; queryTypes: DLQueryType[] }
  | { type: 'navigate'; iri: string; entityType: 'class' | 'individual' }
  | { type: 'requestCompletion'; requestId: number; prefix: string }
  | { type: 'validate'; requestId: number; text: string }
  | { type: 'ready' };
