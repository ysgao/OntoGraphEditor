import * as path from 'path';
import * as vscode from 'vscode';
import { ReasonerProcess } from './ReasonerProcess.js';
import type { DLQueryResult } from '../model/OntologyModel.js';
import type { EquivalentClassEntry, ClassificationResult, ConsistencyResult } from './ReasonerProcess.js';

export { groupEquivalentClasses } from './ReasonerProcess.js';
export type { EquivalentClassEntry, ClassificationResult, ConsistencyResult, DLQueryResult };

export class ReasonerBridge implements vscode.Disposable {
  private inner: ReasonerProcess;
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;

  constructor(private extensionPath: string) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    this.statusBarItem.text = '$(beaker) Reasoner: idle';
    this.statusBarItem.show();
    this.outputChannel = vscode.window.createOutputChannel('OntoGraph Reasoner');

    // javaPath/jvmArgs are only ever consulted at the moment the process is actually spawned
    // (ReasonerProcess.start(), gated on `!this.proc`) — matching this class's own pre-extraction
    // behavior, where those two settings were likewise only read on the first start(). timeoutMs
    // is now fixed at construction rather than re-read on every request; this is a deliberate,
    // documented, minor behavior change (see the 028-standalone-cli-reasoner completion report) —
    // changing `ontograph.reasoner.timeoutSeconds` mid-session now requires reloading the window,
    // same as `javaPath`/`jvmArgs` already did before this refactor.
    const config = vscode.workspace.getConfiguration('ontograph.reasoner');
    const javaPath: string = config.get('javaPath') ?? 'java';
    const jvmArgs: string[] = config.get('jvmArgs') ?? ['-Xmx4g'];
    const timeoutMs = ((config.get('timeoutSeconds') as number) ?? 600) * 1000;
    const jarPath = path.join(this.extensionPath, 'dist', 'java-server', 'onto-reasoner-server.jar');
    this.inner = new ReasonerProcess({ javaPath, jarPath, jvmArgs, timeoutMs });
  }

  async start(): Promise<void> {
    this.statusBarItem.text = '$(loading~spin) Reasoner: starting…';
    try {
      await this.inner.start();
      this.statusBarItem.text = this.inner.isReady()
        ? '$(check) Reasoner: ready'
        : '$(error) Reasoner: failed';
    } catch (err) {
      void vscode.window.showErrorMessage(`OntoGraph reasoner failed to start: ${err instanceof Error ? err.message : String(err)}`);
      this.statusBarItem.text = '$(error) Reasoner: offline';
    }
  }

  async classify(format: string, content: string, engine = 'auto'): Promise<ClassificationResult> {
    this.statusBarItem.text = '$(loading~spin) Classifying…';
    try {
      const result = await this.inner.classify(format, content, engine);
      this.statusBarItem.text = result.consistent
        ? '$(pass) Consistent'
        : `$(error) Inconsistent (${result.incoherentClasses.length} unsatisfiable)`;
      return result;
    } catch (err) {
      this.statusBarItem.text = '$(error) Reasoning failed';
      throw err;
    }
  }

  async classifyFile(format: string, filePath: string, engine = 'auto'): Promise<ClassificationResult> {
    this.statusBarItem.text = '$(loading~spin) Classifying…';
    try {
      const result = await this.inner.classifyFile(format, filePath, engine);
      this.statusBarItem.text = result.consistent
        ? '$(pass) Consistent'
        : `$(error) Inconsistent (${result.incoherentClasses.length} unsatisfiable)`;
      return result;
    } catch (err) {
      this.statusBarItem.text = '$(error) Reasoning failed';
      throw err;
    }
  }

  async checkConsistency(format: string, content: string): Promise<ConsistencyResult> {
    return this.inner.checkConsistency(format, content);
  }

  async convertFormat(content: string, fromFormat: string, toFormat: string): Promise<string> {
    return this.inner.convertFormat(content, fromFormat, toFormat);
  }

  isReady(): boolean {
    return this.inner.isReady();
  }

  async validateExpression(expression: string): Promise<{ valid: boolean; error?: string }> {
    return this.inner.validateExpression(expression);
  }

  async dlQuery(
    format: string,
    content: string | null,
    filePath: string | null,
    classExpression: string,
    queryTypes: string[],
    engine = 'auto',
  ): Promise<DLQueryResult> {
    return this.inner.dlQuery(format, content, filePath, classExpression, queryTypes, engine);
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
    this.inner.dispose();
  }
}
