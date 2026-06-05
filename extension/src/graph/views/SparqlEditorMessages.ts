export interface QueryResultMessage {
  type: 'queryResult';
  columns: string[];
  rows: Record<string, string>[];
  elapsed: number;
  total: number;
}
export interface QueryErrorMessage { type: 'queryError'; message: string }
export interface SparqlReadyMessage { type: 'ready' }
export interface ExecuteQueryMessage { type: 'executeQuery'; sparql: string; endpoint?: string }

export type SparqlExtToWebview = QueryResultMessage | QueryErrorMessage;
export type SparqlWebviewToExt = SparqlReadyMessage | ExecuteQueryMessage;
