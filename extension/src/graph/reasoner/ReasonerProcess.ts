import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as readline from 'readline';
import * as path from 'path';
import type { DLQueryResult } from '../model/OntologyModel.js';

export interface ReasonerProcessOptions {
  javaPath: string;
  jarPath: string;
  jvmArgs?: string[];
  timeoutMs?: number;
}

export interface EquivalentClassEntry {
  classIri: string;
  equivalentClassIri?: string;
  equivalentClassExpression?: string;
}

export interface ClassificationResult {
  consistent: boolean;
  incoherentClasses: string[];
  /** Directed edges of the inferred hierarchy: [parentIri, childIri] */
  hierarchy: [string, string][];
  /** Reasoner-derived class equivalences not already asserted in the ontology */
  equivalentClasses: EquivalentClassEntry[];
}

export interface ConsistencyResult {
  consistent: boolean;
  explanation?: string[];
}

/** Groups flat equivalentClasses entries by classIri, splitting named vs. complex targets. */
export function groupEquivalentClasses(
  entries: EquivalentClassEntry[],
): Map<string, { iris: string[]; expressions: string[] }> {
  const grouped = new Map<string, { iris: string[]; expressions: string[] }>();
  for (const entry of entries) {
    let group = grouped.get(entry.classIri);
    if (!group) {
      group = { iris: [], expressions: [] };
      grouped.set(entry.classIri, group);
    }
    if (entry.equivalentClassIri) {
      group.iris.push(entry.equivalentClassIri);
    } else if (entry.equivalentClassExpression) {
      group.expressions.push(entry.equivalentClassExpression);
    }
  }
  return grouped;
}

export type { DLQueryResult };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * VS-Code-API-free JSON-RPC-over-stdio client for the Java reasoner — extracted from
 * `ReasonerBridge` so it can be reused headlessly (e.g. by the standalone CLI package) without
 * any `vscode` dependency. All configuration (java executable, jar, JVM args, timeout) is passed
 * explicitly via the constructor rather than read from `vscode.workspace.getConfiguration(...)`.
 */
export class ReasonerProcess {
  private proc: cp.ChildProcess | undefined;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private ready = false;
  private readonly javaPath: string;
  private readonly jarPath: string;
  private readonly jvmArgs: string[];
  private readonly timeoutMs: number;

  constructor(options: ReasonerProcessOptions) {
    this.javaPath = options.javaPath;
    this.jarPath = options.jarPath;
    this.jvmArgs = options.jvmArgs ?? ['-Xmx4g'];
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  async start(): Promise<void> {
    if (this.proc) { return; }

    this.proc = cp.spawn(this.javaPath, [...this.jvmArgs, '-jar', this.jarPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.on('error', () => {
      this.proc = undefined;
      this.ready = false;
    });

    this.proc.on('exit', () => {
      this.proc = undefined;
      this.ready = false;
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
    stderrRl.on('line', () => { /* no output-channel sink at this layer — callers may add their own */ });

    try {
      await this.request('ping', {});
      this.ready = true;
    } catch {
      // start() completes regardless — callers observe readiness via isReady()/request failures
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error('Reasoner process is not running'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Reasoner request '${method}' timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ id, method, params }) + '\n';
      this.proc.stdin.write(payload);
    });
  }

  async classify(format: string, content: string, engine = 'auto'): Promise<ClassificationResult> {
    if (!this.proc) { await this.start(); }
    const { params, tempFile } = await this.buildParams({ format, content, engine });
    return this.classifyWithParams(params, tempFile);
  }

  async classifyFile(format: string, filePath: string, engine = 'auto'): Promise<ClassificationResult> {
    if (!this.proc) { await this.start(); }
    return this.classifyWithParams({ format, filePath, engine }, undefined);
  }

  private async classifyWithParams(
    params: Record<string, unknown>,
    tempFile: string | undefined,
  ): Promise<ClassificationResult> {
    try {
      return await this.request('classify', params) as ClassificationResult;
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
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('ReasonerProcess disposed'));
    }
    this.pending.clear();
    this.proc?.kill();
    this.proc = undefined;
  }
}
