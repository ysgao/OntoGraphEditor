import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class AuthoringPanel {
  private static instance: AuthoringPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly distPath: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(context: vscode.ExtensionContext) {
    this.distPath = vscode.Uri.joinPath(
      context.extensionUri,
      '..',
      'apps',
      'authoring-ui-vscode',
      'dist'
    );

    this.panel = vscode.window.createWebviewPanel(
      'ontographAuthoring',
      'Authoring Workbench',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.distPath],
      }
    );

    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(context: vscode.ExtensionContext): void {
    if (AuthoringPanel.instance) {
      AuthoringPanel.instance.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    AuthoringPanel.instance = new AuthoringPanel(context);
  }

  private buildHtml(): string {
    const indexPath = path.join(this.distPath.fsPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return `<html><body><p>Authoring UI not built. Run <code>npm run build:client</code> first.</p></body></html>`;
    }

    let html = fs.readFileSync(indexPath, 'utf8');
    const webview = this.panel.webview;
    const base = webview.asWebviewUri(this.distPath).toString();

    // Rewrite all relative src/href/url() asset references to webview URIs
    html = html.replace(
      /((?:src|href)=["'])(?!https?:\/\/|data:|#|\/\/)(.*?)(["'])/g,
      (_, prefix, assetPath, suffix) => {
        const assetUri = webview.asWebviewUri(
          vscode.Uri.joinPath(this.distPath, assetPath)
        );
        return `${prefix}${assetUri}${suffix}`;
      }
    );

    // Inject <base> tag so relative XHR paths resolve correctly
    html = html.replace('<head>', `<head><base href="${base}/">`);

    return html;
  }

  private handleMessage(message: { command: string; payload?: unknown }): void {
    // Forward IPC messages to other panels as needed
    vscode.commands.executeCommand('ontographEditor.ipcRoute', message);
  }

  dispose(): void {
    AuthoringPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
