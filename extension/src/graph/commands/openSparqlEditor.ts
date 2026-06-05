import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import type { OntologyModel } from '../model/OntologyModel';
import { SparqlExecutor } from '../sparql/SparqlExecutor';
import type {
  SparqlExtToWebview,
  SparqlWebviewToExt,
  QueryResultMessage,
  QueryErrorMessage,
} from '../views/SparqlEditorMessages';

const ROW_LIMIT = 1000;

// Singleton panel
let panel: vscode.WebviewPanel | undefined;

export function openSparqlEditor(
  context: vscode.ExtensionContext,
  model: OntologyModel | undefined,
): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'ontograph.sparqlEditor',
    'SPARQL Query',
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
    (msg: SparqlWebviewToExt) => {
      if (!panel) { return; }
      handleMessage(msg, panel, model);
    },
    undefined,
    context.subscriptions,
  );
}

function handleMessage(
  msg: SparqlWebviewToExt,
  p: vscode.WebviewPanel,
  model: OntologyModel | undefined,
): void {
  if (msg.type === 'ready') {
    // nothing to send on startup
    return;
  }

  if (msg.type === 'executeQuery') {
    if (msg.endpoint) {
      // Remote endpoint
      executeRemote(msg.sparql, msg.endpoint)
        .then(result => void p.webview.postMessage(result as SparqlExtToWebview))
        .catch(err => {
          const error: QueryErrorMessage = {
            type: 'queryError',
            message: err instanceof Error ? err.message : String(err),
          };
          void p.webview.postMessage(error as SparqlExtToWebview);
        });
    } else {
      // Local N3 store execution
      if (!model) {
        const error: QueryErrorMessage = {
          type: 'queryError',
          message: 'No ontology loaded. Open an OWL file first.',
        };
        void p.webview.postMessage(error as SparqlExtToWebview);
        return;
      }
      try {
        const executor = new SparqlExecutor(model);
        const result = executor.execute(msg.sparql);
        // Cap rows at ROW_LIMIT
        const total = result.total;
        const rows = result.rows.slice(0, ROW_LIMIT);
        const response: QueryResultMessage = {
          type: 'queryResult',
          columns: result.columns,
          rows,
          elapsed: result.elapsed,
          total,
        };
        void p.webview.postMessage(response as SparqlExtToWebview);
      } catch (err) {
        const error: QueryErrorMessage = {
          type: 'queryError',
          message: err instanceof Error ? err.message : String(err),
        };
        void p.webview.postMessage(error as SparqlExtToWebview);
      }
    }
  }
}

function executeRemote(sparql: string, endpoint: string): Promise<QueryResultMessage | QueryErrorMessage> {
  return new Promise((resolve) => {
    const start = Date.now();
    const encodedQuery = encodeURIComponent(sparql);
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${separator}query=${encodedQuery}`;

    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Accept': 'application/sparql-results+json',
      },
    };

    const req = lib.get(options as unknown as Parameters<typeof https.get>[0], (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const elapsed = Date.now() - start;
        try {
          const json = JSON.parse(body) as {
            head: { vars: string[] };
            results: { bindings: Array<Record<string, { type: string; value: string; 'xml:lang'?: string; datatype?: string }>> };
          };
          const columns = json.head.vars;
          const allRows = json.results.bindings.map(binding => {
            const row: Record<string, string> = {};
            for (const col of columns) {
              const cell = binding[col];
              if (cell) {
                if (cell.type === 'uri') {
                  row[col] = `<${cell.value}>`;
                } else if (cell.type === 'literal') {
                  if (cell['xml:lang']) {
                    row[col] = `"${cell.value}"@${cell['xml:lang']}`;
                  } else if (cell.datatype && cell.datatype !== 'http://www.w3.org/2001/XMLSchema#string') {
                    row[col] = `"${cell.value}"^^<${cell.datatype}>`;
                  } else {
                    row[col] = cell.value;
                  }
                } else {
                  row[col] = cell.value;
                }
              }
            }
            return row;
          });
          const total = allRows.length;
          const rows = allRows.slice(0, ROW_LIMIT);
          resolve({
            type: 'queryResult',
            columns,
            rows,
            elapsed,
            total,
          });
        } catch (e) {
          resolve({
            type: 'queryError',
            message: `Failed to parse response: ${e instanceof Error ? e.message : String(e)}\nResponse: ${body.slice(0, 200)}`,
          });
        }
      });
    });

    req.on('error', (err: Error) => {
      resolve({
        type: 'queryError',
        message: `HTTP request failed: ${err.message}`,
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      resolve({
        type: 'queryError',
        message: 'Request timed out after 30 seconds.',
      });
    });
  });
}

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'sparql-editor-webview.js'),
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
  <title>OntoGraph: SPARQL Query</title>
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
