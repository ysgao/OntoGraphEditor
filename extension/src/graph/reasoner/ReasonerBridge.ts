import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as readline from 'readline';
import * as path from 'path';
import * as vscode from 'vscode';
import type { DLQueryResult } from '../model/OntologyModel.js';

export interface ClassificationResult {
  consistent: boolean;
  incoherentClasses: string[];
  /** Directed edges of the inferred hierarchy: [parentIri, childIri] */
  hierarchy: [string, string][];
}

export interface ConsistencyResult {
  consistent: boolean;
  explanation?: string[];
}

export type { DLQueryResult };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export class ReasonerBridge implements vscode.Disposable {
  private proc: cp.ChildProcess | undefined;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;
  private ready = false;

  constructor(private extensionPath: string) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    this.statusBarItem.text = '$(beaker) Reasoner: idle';
    this.statusBarItem.show();
    this.outputChannel = vscode.window.createOutputChannel('OntoGraph Reasoner');
  }

  async start(): Promise<void> {
    if (this.proc) { return; }
    const config = vscode.workspace.getConfiguration('ontograph.reasoner');
    const javaPath: string = config.get('javaPath') ?? 'java';
    const jvmArgs: string[] = config.get('jvmArgs') ?? ['-Xmx4g'];
    const jarPath = path.join(this.extensionPath, 'dist', 'java-server', 'onto-reasoner-server.jar');

    this.statusBarItem.text = '$(loading~spin) Reasoner: starting…';

    this.proc = cp.spawn(javaPath, [...jvmArgs, '-jar', jarPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.on('error', (err) => {
      vscode.window.showErrorMessage(`OntoGraph reasoner failed to start: ${err.message}`);
      this.proc = undefined;
      this.ready = false;
      this.statusBarItem.text = '$(error) Reasoner: offline';
    });

    this.proc.on('exit', () => {
      this.proc = undefined;
      this.ready = false;
      this.statusBarItem.text = '$(warning) Reasoner: stopped';
    });

    const rl = readline.createInterface({ input: this.proc.stdout! });
    rl.on('line', (line) => {
      if (!line.trim()) { return; }
      try {
        const msg = JSON.parse(line) as { id: number; result?: unknown; error?: { message: string } };
        const req = this.pending.get(msg.id);
        if (!req) { return; }
        clearTimeout(req.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          req.reject(new Error(msg.error.message));
        } else {
          req.resolve(msg.result);
        }
      } catch {
        // ignore malformed lines (e.g. JVM startup messages)
      }
    });

    const stderrRl = readline.createInterface({ input: this.proc.stderr! });
    stderrRl.on('line', (line) => this.outputChannel.appendLine(line));

    // Pre-warm the JVM
    try {
      await this.request('ping', {});
      this.ready = true;
      this.statusBarItem.text = '$(check) Reasoner: ready';
    } catch {
      this.statusBarItem.text = '$(error) Reasoner: failed';
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error('Reasoner process is not running'));
        return;
      }
      const config = vscode.workspace.getConfiguration('ontograph.reasoner');
      const timeoutMs = ((config.get('timeoutSeconds') as number) ?? 600) * 1000;
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Reasoner request '${method}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ id, method, params }) + '\n';
      this.proc.stdin.write(payload);
    });
  }

  async classify(format: string, content: string, engine = 'auto'): Promise<ClassificationResult> {
    if (!this.proc) { await this.start(); }
    this.statusBarItem.text = '$(loading~spin) Classifying…';
    const { params, tempFile } = await this.buildParams({ format, content, engine });
    return this.classifyWithParams(params, tempFile);
  }

  async classifyFile(format: string, filePath: string, engine = 'auto'): Promise<ClassificationResult> {
    if (!this.proc) { await this.start(); }
    this.statusBarItem.text = '$(loading~spin) Classifying…';
    return this.classifyWithParams({ format, filePath, engine }, undefined);
  }

  private async classifyWithParams(
    params: Record<string, unknown>,
    tempFile: string | undefined,
  ): Promise<ClassificationResult> {
    try {
      const result = await this.request('classify', params) as ClassificationResult;
      this.statusBarItem.text = result.consistent
        ? '$(pass) Consistent'
        : `$(error) Inconsistent (${result.incoherentClasses.length} unsatisfiable)`;
      return result;
    } catch (err) {
      this.statusBarItem.text = '$(error) Reasoning failed';
      throw err;
    } finally {
      if (tempFile) { await fs.promises.unlink(tempFile).catch(() => {}); }
    }
  }

  async checkConsistency(format: string, content: string): Promise<ConsistencyResult> {
    if (!this.proc) { await this.start(); }
    const { params, tempFile } = await this.buildParams({ format, content });
    try {
      return await this.request('checkConsistency', params) as ConsistencyResult;
    } finally {
      if (tempFile) { await fs.promises.unlink(tempFile).catch(() => {}); }
    }
  }

  /**
   * For large content, writes it to a temp file and substitutes a filePath param
   * to avoid JSON-encoding tens of MB over the stdin pipe.
   */
  private async buildParams(
    base: Record<string, string | undefined>,
  ): Promise<{ params: Record<string, string | undefined>; tempFile: string | undefined }> {
    const content = base.content;
    if (content && content.length > 512_000) {
      const id = this.nextId;
      const tempFile = path.join(os.tmpdir(), `ontograph-${id}.owl`);
      await fs.promises.writeFile(tempFile, content, 'utf8');
      const { content: _omit, ...rest } = base;
      return { params: { ...rest, filePath: tempFile }, tempFile };
    }
    return { params: base, tempFile: undefined };
  }

  async convertFormat(content: string, fromFormat: string, toFormat: string): Promise<string> {
    if (!this.proc) { await this.start(); }
    return this.request('convertFormat', { content, fromFormat, toFormat }) as Promise<string>;
  }

  isReady(): boolean {
    return this.ready;
  }

  async validateExpression(expression: string): Promise<{ valid: boolean; error?: string }> {
    if (!this.proc) { await this.start(); }
    return this.request('validateExpression', { expression }) as Promise<{ valid: boolean; error?: string }>;
  }

  async dlQuery(
    format: string,
    content: string | null,
    filePath: string | null,
    classExpression: string,
    queryTypes: string[],
    engine = 'auto',
  ): Promise<DLQueryResult> {
    if (!this.proc) { await this.start(); }

    let params: Record<string, unknown>;
    let tempFile: string | undefined;
    const rawContent = content ?? '';

    if (!filePath && rawContent.length > 512_000) {
      const id = this.nextId;
      tempFile = path.join(os.tmpdir(), `ontograph-${id}.owl`);
      await fs.promises.writeFile(tempFile, rawContent, 'utf8');
      params = { format, filePath: tempFile, classExpression, queryTypes, engine };
    } else if (filePath) {
      params = { format, filePath, classExpression, queryTypes, engine };
    } else {
      params = { format, content: rawContent, classExpression, queryTypes, engine };
    }

    try {
      return await this.request('dlQuery', params) as DLQueryResult;
    } finally {
      if (tempFile) { await fs.promises.unlink(tempFile).catch(() => {}); }
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('ReasonerBridge disposed'));
    }
    this.pending.clear();
    this.proc?.kill();
    this.proc = undefined;
  }
}
