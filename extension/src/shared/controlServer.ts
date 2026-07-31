import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { requestJson } from './httpJson';
import { getSessionState } from './sessionState';

/**
 * Local, token-authed HTTP API for the headless CLI (cli/). Unlike LocalProxy (which exists
 * purely to work around the webview's CORS/cookie-jar sandboxing), this server hands out
 * actions backed by the user's real IMS session cookie to any local process that knows the
 * token — so every request must present it, and it is generated fresh per activation rather
 * than fixed or configurable.
 *
 * This is the extensibility point for future AI-driven authoring actions: each new action is
 * a new route reusing resolveTaskContext()/the stored cookie/requestJson(), no new plumbing.
 */

const DEFAULT_MODULE_ID = '900000000000207008';
const EN_US_REFSET = '900000000000509007';
const EN_GB_REFSET = '900000000000508004';
const ISA_TYPE_ID = '116680003';
const DEFAULT_TERMINOLOGY_SERVER_ENDPOINT = 'https://uat-snowstorm.ihtsdotools.org/snowstorm/snomed-ct/';
const DEFAULT_AUTHORING_SERVICES_ENDPOINT = 'https://uat-snowstorm.ihtsdotools.org/authoring-services/';

export interface CreateConceptBody {
  fsn: string;
  semanticTag?: string;
  preferredTerm?: string;
  parentConceptId: string;
  moduleId?: string;
  projectKey?: string;
  taskKey?: string;
  branchPath?: string;
}

interface ActionResult {
  statusCode: number;
  body: unknown;
}

export class ControlServer {
  private server: http.Server | null = null;
  private _port = 0;
  readonly token: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly moduleIdCache = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext) {
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

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${this.token}`) {
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    try {
      if (req.method === 'GET' && url.pathname === '/session') {
        this.sendJson(res, 200, getSessionState());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/concepts') {
        const body = await this.readJsonBody<CreateConceptBody>(req);
        const result = await this.createConcept(body);
        this.sendJson(res, result.statusCode, result.body);
        return;
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[error] ${message}`);
      this.sendJson(res, 500, { error: message });
    }
  }

  private readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
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

  private async createConcept(input: CreateConceptBody): Promise<ActionResult> {
    const current = getSessionState().currentTask;
    const projectKey = input.projectKey || current?.projectKey;
    const taskKey = input.taskKey || current?.taskKey;
    let branchPath = input.branchPath || (input.projectKey ? undefined : current?.branchPath);

    if (!projectKey || !taskKey) {
      return {
        statusCode: 400,
        body: { error: 'No task context: open a task in OntoGraph Editor, or pass projectKey/taskKey explicitly.' },
      };
    }
    if (!input.fsn || !input.parentConceptId) {
      return { statusCode: 400, body: { error: 'fsn and parentConceptId are required.' } };
    }

    if (!branchPath) {
      branchPath = (await this.resolveBranchPath(projectKey, taskKey)) ?? undefined;
    }
    if (!branchPath) {
      return { statusCode: 400, body: { error: `Could not resolve branch path for ${projectKey}/${taskKey}.` } };
    }

    const branchRoot = deriveBranchRoot(branchPath);
    const cfg = vscode.workspace.getConfiguration('ontographEditor');
    const tsEndpoint = cfg.get<string>('terminologyServerEndpoint', DEFAULT_TERMINOLOGY_SERVER_ENDPOINT);
    const cookie = (await this.context.secrets.get('imsSessionCookie')) ?? '';

    const moduleId = input.moduleId || (await this.resolveDefaultModuleId(projectKey));
    const preferredTerm = input.preferredTerm || input.fsn;
    const fsnTerm = input.semanticTag ? `${input.fsn} (${input.semanticTag})` : input.fsn;

    const payload = {
      conceptId: null,
      moduleId,
      definitionStatus: 'PRIMITIVE',
      active: true,
      descriptions: [makeDescription('FSN', fsnTerm, moduleId), makeDescription('SYNONYM', preferredTerm, moduleId)],
      relationships: [] as unknown[],
      classAxioms: [
        {
          axiomId: crypto.randomUUID(),
          definitionStatus: 'PRIMITIVE',
          effectiveTime: null,
          active: true,
          released: false,
          moduleId,
          relationships: [
            {
              active: true,
              groupId: 0,
              type: { conceptId: ISA_TYPE_ID },
              target: { conceptId: input.parentConceptId },
            },
          ],
        },
      ],
    };

    const url = tsEndpoint.replace(/\/$/, '') + `/browser/${branchRoot}/${projectKey}/${taskKey}/concepts/`;
    const result = await requestJson(url, { method: 'POST', body: payload, cookie });

    if (result.sessionExpired) {
      const msg = 'IMS session expired — re-sign in via "OntoGraph: Set IMS Session Cookie" or "OntoGraph: Import IMS Cookies from Chrome".';
      this.outputChannel.appendLine(`[${new Date().toISOString()}] create-concept ${projectKey}/${taskKey}: SESSION EXPIRED`);
      return { statusCode: 401, body: { error: msg } };
    }

    const created =
      result.body && typeof result.body === 'object' && 'conceptId' in (result.body as Record<string, unknown>)
        ? (result.body as Record<string, unknown>).conceptId
        : undefined;
    this.outputChannel.appendLine(
      `[${new Date().toISOString()}] create-concept ${projectKey}/${taskKey}: ` +
        `${result.statusCode < 300 ? 'OK' : 'FAILED (' + result.statusCode + ')'} — ${fsnTerm}` +
        (created ? ` → ${created}` : '')
    );

    return { statusCode: result.statusCode, body: result.body };
  }

  private async resolveBranchPath(projectKey: string, taskKey: string): Promise<string | null> {
    const cfg = vscode.workspace.getConfiguration('ontographEditor');
    const asEndpoint = cfg.get<string>('authoringServicesEndpoint', DEFAULT_AUTHORING_SERVICES_ENDPOINT);
    const cookie = (await this.context.secrets.get('imsSessionCookie')) ?? '';
    const url = asEndpoint.replace(/\/$/, '') + `/projects/${projectKey}/tasks/${taskKey}`;
    const result = await requestJson<{ branchPath?: string }>(url, { cookie });
    return result.body?.branchPath ?? null;
  }

  /**
   * Mirrors apps/authoring-ui-vscode's metadataService.js getCurrentModuleId(): an extension
   * project must use its own module, not the international core module — Snowstorm's
   * classifier/MRCM checks choke on module-mismatched content on an extension branch.
   */
  private async resolveDefaultModuleId(projectKey: string): Promise<string> {
    const cached = this.moduleIdCache.get(projectKey);
    if (cached) {
      return cached;
    }

    const cfg = vscode.workspace.getConfiguration('ontographEditor');
    const asEndpoint = cfg.get<string>('authoringServicesEndpoint', DEFAULT_AUTHORING_SERVICES_ENDPOINT);
    const cookie = (await this.context.secrets.get('imsSessionCookie')) ?? '';
    const url = asEndpoint.replace(/\/$/, '') + `/projects/${projectKey}`;
    const result = await requestJson<{ metadata?: ProjectMetadata }>(url, { cookie });
    const metadata = result.body?.metadata;

    let moduleId = DEFAULT_MODULE_ID;
    if (metadata) {
      const disabledRaw = metadata.multipleModuleEditingDisabled;
      const notDisabled = !disabledRaw || disabledRaw === 'false';
      if (metadata.expectedExtensionModules?.length && notDisabled) {
        moduleId = metadata.expectedExtensionModules[0];
      } else if (metadata.defaultModuleId) {
        moduleId = metadata.defaultModuleId;
      }
    }

    this.moduleIdCache.set(projectKey, moduleId);
    return moduleId;
  }
}

interface ProjectMetadata {
  defaultModuleId?: string;
  expectedExtensionModules?: string[];
  multipleModuleEditingDisabled?: boolean | string;
}

function makeDescription(type: 'FSN' | 'SYNONYM', term: string, moduleId: string) {
  return {
    active: true,
    moduleId,
    type,
    term,
    lang: 'en',
    caseSignificance: 'CASE_INSENSITIVE',
    acceptabilityMap: { [EN_US_REFSET]: 'PREFERRED', [EN_GB_REFSET]: 'PREFERRED' },
  };
}

function deriveBranchRoot(branchPath: string): string {
  const segments = branchPath.split('/').filter(Boolean);
  return segments.slice(0, -2).join('/');
}
