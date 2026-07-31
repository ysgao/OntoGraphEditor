import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getSessionState } from './sessionState';
import type { ActionContext, ActionResult } from './actions/types';
import { createConcept } from './actions/createConcept';
import { getConcept } from './actions/getConcept';
import { searchConcepts } from './actions/searchConcepts';
import {
  addDescription,
  addRelationship,
  inactivateConcept,
  setDefinitionStatus,
  updateDescription,
  setCaseSignificance,
  deleteDescription,
  updateAxiom,
  deleteAxiom,
  updateGciAxiom,
  deleteGciAxiom,
} from './actions/updateConcept';
import { deleteConcept } from './actions/deleteConcept';
import { classify, validate } from './actions/classification';

/**
 * Local, token-authed HTTP API for the headless CLI (cli/). Unlike LocalProxy (which exists
 * purely to work around the webview's CORS/cookie-jar sandboxing), this server hands out
 * actions backed by the user's real IMS session cookie to any local process that knows the
 * token — so every request must present it, and it is generated fresh per activation rather
 * than fixed or configurable.
 *
 * This is the extensibility point for AI-driven authoring actions: each action is its own
 * module under ./actions, sharing resolveTaskContext()/the stored cookie/requestJson() from
 * ./actions/taskContext.ts — this file is just the route table.
 */
export class ControlServer {
  private server: http.Server | null = null;
  private _port = 0;
  readonly token: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly moduleIdCache = new Map<string, string>();

  constructor(private readonly vscodeContext: vscode.ExtensionContext) {
    this.token = crypto.randomBytes(24).toString('hex');
    this.outputChannel = vscode.window.createOutputChannel('OntoGraph AI Actions');
  }

  get port(): number {
    return this._port;
  }

  start(): Promise<number> {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    return new Promise((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number };
        this._port = addr.port;
        resolve(this._port);
      });
      this.server!.on('error', reject);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this._port = 0;
  }

  private get actionContext(): ActionContext {
    return {
      vscodeContext: this.vscodeContext,
      outputChannel: this.outputChannel,
      moduleIdCache: this.moduleIdCache,
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${this.token}`) {
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && path === '/session') {
        this.sendJson(res, 200, getSessionState());
        return;
      }

      if (method === 'POST' && path === '/concepts') {
        await this.dispatch(req, res, (body) => createConcept(this.actionContext, body));
        return;
      }

      if (method === 'POST' && path === '/concepts/search') {
        await this.dispatch(req, res, (body) => searchConcepts(this.actionContext, body));
        return;
      }

      const conceptIdMatch = path.match(/^\/concepts\/([^/]+)$/);
      if (method === 'GET' && conceptIdMatch) {
        const conceptId = decodeURIComponent(conceptIdMatch[1]);
        const result = await getConcept(this.actionContext, {
          conceptId,
          projectKey: url.searchParams.get('projectKey') ?? undefined,
          taskKey: url.searchParams.get('taskKey') ?? undefined,
          branchPath: url.searchParams.get('branchPath') ?? undefined,
        });
        this.sendJson(res, result.statusCode, result.body);
        return;
      }

      const descriptionsMatch = path.match(/^\/concepts\/([^/]+)\/descriptions$/);
      if (method === 'POST' && descriptionsMatch) {
        const conceptId = decodeURIComponent(descriptionsMatch[1]);
        await this.dispatch(req, res, (body) => addDescription(this.actionContext, { ...body, conceptId }));
        return;
      }

      const relationshipsMatch = path.match(/^\/concepts\/([^/]+)\/relationships$/);
      if (method === 'POST' && relationshipsMatch) {
        const conceptId = decodeURIComponent(relationshipsMatch[1]);
        await this.dispatch(req, res, (body) => addRelationship(this.actionContext, { ...body, conceptId }));
        return;
      }

      const definitionStatusMatch = path.match(/^\/concepts\/([^/]+)\/definition-status$/);
      if (method === 'POST' && definitionStatusMatch) {
        const conceptId = decodeURIComponent(definitionStatusMatch[1]);
        await this.dispatch(req, res, (body) => setDefinitionStatus(this.actionContext, { ...body, conceptId }));
        return;
      }

      const inactivateMatch = path.match(/^\/concepts\/([^/]+)\/inactivate$/);
      if (method === 'POST' && inactivateMatch) {
        const conceptId = decodeURIComponent(inactivateMatch[1]);
        await this.dispatch(req, res, (body) => inactivateConcept(this.actionContext, { ...body, conceptId }));
        return;
      }

      if (method === 'DELETE' && conceptIdMatch) {
        const conceptId = decodeURIComponent(conceptIdMatch[1]);
        await this.dispatch(req, res, (body) => deleteConcept(this.actionContext, { ...body, conceptId }));
        return;
      }

      const descriptionByIdMatch = path.match(/^\/concepts\/([^/]+)\/descriptions\/([^/]+)$/);
      if (method === 'POST' && descriptionByIdMatch) {
        const conceptId = decodeURIComponent(descriptionByIdMatch[1]);
        const descriptionId = decodeURIComponent(descriptionByIdMatch[2]);
        await this.dispatch(req, res, (body) => updateDescription(this.actionContext, { ...body, conceptId, descriptionId }));
        return;
      }

      const caseSignificanceMatch = path.match(/^\/concepts\/([^/]+)\/descriptions\/([^/]+)\/case-significance$/);
      if (method === 'POST' && caseSignificanceMatch) {
        const conceptId = decodeURIComponent(caseSignificanceMatch[1]);
        const descriptionId = decodeURIComponent(caseSignificanceMatch[2]);
        await this.dispatch(req, res, (body) => setCaseSignificance(this.actionContext, { ...body, conceptId, descriptionId }));
        return;
      }
      if (method === 'DELETE' && descriptionByIdMatch) {
        const conceptId = decodeURIComponent(descriptionByIdMatch[1]);
        const descriptionId = decodeURIComponent(descriptionByIdMatch[2]);
        await this.dispatch(req, res, (body) => deleteDescription(this.actionContext, { ...body, conceptId, descriptionId }));
        return;
      }

      const axiomByIdMatch = path.match(/^\/concepts\/([^/]+)\/axioms\/([^/]+)$/);
      if (method === 'POST' && axiomByIdMatch) {
        const conceptId = decodeURIComponent(axiomByIdMatch[1]);
        const axiomId = decodeURIComponent(axiomByIdMatch[2]);
        await this.dispatch(req, res, (body) => updateAxiom(this.actionContext, { ...body, conceptId, axiomId }));
        return;
      }
      if (method === 'DELETE' && axiomByIdMatch) {
        const conceptId = decodeURIComponent(axiomByIdMatch[1]);
        const axiomId = decodeURIComponent(axiomByIdMatch[2]);
        await this.dispatch(req, res, (body) => deleteAxiom(this.actionContext, { ...body, conceptId, axiomId }));
        return;
      }

      const gciAxiomByIdMatch = path.match(/^\/concepts\/([^/]+)\/gci-axioms\/([^/]+)$/);
      if (method === 'POST' && gciAxiomByIdMatch) {
        const conceptId = decodeURIComponent(gciAxiomByIdMatch[1]);
        const axiomId = decodeURIComponent(gciAxiomByIdMatch[2]);
        await this.dispatch(req, res, (body) => updateGciAxiom(this.actionContext, { ...body, conceptId, axiomId }));
        return;
      }
      if (method === 'DELETE' && gciAxiomByIdMatch) {
        const conceptId = decodeURIComponent(gciAxiomByIdMatch[1]);
        const axiomId = decodeURIComponent(gciAxiomByIdMatch[2]);
        await this.dispatch(req, res, (body) => deleteGciAxiom(this.actionContext, { ...body, conceptId, axiomId }));
        return;
      }

      if (method === 'POST' && path === '/tasks/classify') {
        await this.dispatch(req, res, (body) => classify(this.actionContext, body));
        return;
      }

      if (method === 'POST' && path === '/tasks/validate') {
        await this.dispatch(req, res, (body) => validate(this.actionContext, body));
        return;
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[error] ${message}`);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async dispatch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (body: any) => Promise<ActionResult>
  ): Promise<void> {
    const body = await this.readJsonBody(req);
    const result = await run(body);
    this.sendJson(res, result.statusCode, result.body);
  }

  private readJsonBody<T = Record<string, unknown>>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: string) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(data ? (JSON.parse(data) as T) : ({} as T));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    const payload = JSON.stringify(body ?? {});
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(payload);
  }
}
