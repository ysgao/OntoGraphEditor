import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { LocalProxy } from '../shared/localProxy';
import type { IpcMessage } from '../shared/ipcMessages';

export class AuthoringPanel {
  private static instance: AuthoringPanel | undefined;
  private static proxy: LocalProxy | null = null;
  private static context: vscode.ExtensionContext | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly distPath: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(context: vscode.ExtensionContext) {
    this.distPath = vscode.Uri.joinPath(
      context.extensionUri,
      'dist',
      'authoring-ui'
    );

    this.panel = vscode.window.createWebviewPanel(
      'ontographAuthoring',
      'Authoring Workbench',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.distPath],
      }
    );

    this.panel.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="color:#ccc;padding:2rem">Loading Authoring Workbench…</body></html>`;

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(context: vscode.ExtensionContext, proxy: LocalProxy, preserveFocus = false): void {
    AuthoringPanel.proxy = proxy;
    AuthoringPanel.context = context;
    if (AuthoringPanel.instance) {
      // Reveal in the panel's current column so we never override a layout the user chose.
      const col = AuthoringPanel.instance.panel.viewColumn ?? vscode.ViewColumn.Active;
      AuthoringPanel.instance.panel.reveal(col, preserveFocus);
      return;
    }
    const panel = new AuthoringPanel(context);
    AuthoringPanel.instance = panel;
    panel.initialize();
  }

  static getViewColumn(): vscode.ViewColumn | undefined {
    return AuthoringPanel.instance?.panel.viewColumn;
  }

  static reveal(preserveFocus = false): void {
    if (!AuthoringPanel.instance) { return; }
    const col = AuthoringPanel.instance.panel.viewColumn ?? vscode.ViewColumn.Active;
    AuthoringPanel.instance.panel.reveal(col, preserveFocus);
  }

  static isActive(): boolean {
    return AuthoringPanel.instance?.panel.active ?? false;
  }

  /** Called when settings change and the proxy is restarted with a new port. */
  static updateProxy(proxy: LocalProxy): void {
    AuthoringPanel.proxy = proxy;
  }

  /** Re-fetches auth and rebuilds the webview HTML after settings change. */
  static reinitialize(): void {
    AuthoringPanel.instance?.initialize();
  }

  static postMessage(msg: IpcMessage): void {
    if (!AuthoringPanel.instance) { return; }
    void AuthoringPanel.instance.panel.webview.postMessage(msg);
  }

  async initialize(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ontographEditor');
    const authoringEndpoint = cfg.get<string>('authoringServicesEndpoint', 'https://dev-authoring.ihtsdotools.org/authoring-services/');
    const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://dev-snowstorm.ihtsdotools.org/');
    const sessionCookie = (await AuthoringPanel.context?.secrets.get('imsSessionCookie')) ?? '';

    const [uiConfig, accountDetails] = await Promise.all([
      this.fetchUiConfiguration(authoringEndpoint),
      this.fetchAccountDetails(imsEndpoint, sessionCookie),
    ]);

    if (AuthoringPanel.instance !== this) { return; }

    // Show the app immediately — do not block on the auth callback.
    try {
      this.panel.webview.html = this.buildHtml(uiConfig, accountDetails ?? undefined);
    } catch { return; /* panel disposed */ }

    if (!accountDetails) {
      vscode.window.showWarningMessage(
        'OntoGraph: Not signed in to IMS.',
        'Import from Chrome',
        'Paste Cookie',
        'Open IMS in Browser'
      ).then((choice) => {
        if (choice === 'Import from Chrome') {
          vscode.commands.executeCommand('ontographEditor.importChromeCookies');
        } else if (choice === 'Paste Cookie') {
          vscode.commands.executeCommand('ontographEditor.pasteCookie');
        } else if (choice === 'Open IMS in Browser') {
          vscode.env.openExternal(vscode.Uri.parse(imsEndpoint));
        }
      });
    }
  }

  private fetchUiConfiguration(endpoint: string): Promise<object | null> {
    const url = endpoint.replace(/\/$/, '') + '/ui-configuration';
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); return; } catch { /* fall through */ }
          }
          resolve(null);
        });
      });
      req.on('error', (err: Error) => {
        console.warn('[OntoGraph] ui-configuration fetch failed:', err.message);
        resolve(null);
      });
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
  }

  private fetchAccountDetails(imsEndpoint: string, sessionCookie: string): Promise<object | null> {
    const url = imsEndpoint.replace(/\/$/, '') + '/auth';
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      const headers: Record<string, string> = { accept: 'application/json' };
      // Sanitize cookie header: HTTP forbids bytes outside 0x20-0x7E (plus \t).
      const safeCookie = sessionCookie ? sessionCookie.replace(/[^\x20-\x7e\t]/g, '') : '';
      if (safeCookie !== sessionCookie) {
        console.warn(`[OntoGraph] fetchAccountDetails sanitized cookie: ${sessionCookie.length} → ${safeCookie.length} chars`);
      }
      if (safeCookie) {
        headers['cookie'] = safeCookie;
      }
      console.log(`[OntoGraph] fetchAccountDetails GET ${url}  cookie=${safeCookie ? safeCookie.slice(0, 30) + '…' : '(none)'}`);
      const req = lib.get(url, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          console.log(`[OntoGraph] fetchAccountDetails response: HTTP ${res.statusCode}  body length=${data.length}`);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); return; } catch (e) {
              console.warn('[OntoGraph] fetchAccountDetails JSON parse failed:', e, 'body preview:', data.slice(0, 200));
            }
          } else {
            console.warn('[OntoGraph] fetchAccountDetails non-2xx body preview:', data.slice(0, 200));
          }
          resolve(null);
        });
      });
      req.on('error', (err: Error) => {
        console.warn('[OntoGraph] IMS auth fetch failed:', err.message);
        resolve(null);
      });
      req.setTimeout(8000, () => {
        console.warn('[OntoGraph] fetchAccountDetails timeout');
        req.destroy(); resolve(null);
      });
    });
  }

  private buildHtml(uiConfiguration?: object | null, accountDetails?: object): string {
    const indexPath = path.join(this.distPath.fsPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return `<html><body><p>Authoring UI not built. Run <code>npm run build:client</code> first.</p></body></html>`;
    }

    let html = fs.readFileSync(indexPath, 'utf8');
    const webview = this.panel.webview;
    const baseUri = webview.asWebviewUri(this.distPath).toString();

    // Rewrite all relative src/href asset references to vscode-webview:// URIs.
    html = html.replace(
      /((?:src|href)=["'])(?!https?:\/\/|data:|#|\/\/)(.*?)(["'])/g,
      (_, prefix, assetPath, suffix) => {
        if (!assetPath) { return `${prefix}${assetPath}${suffix}`; }
        const assetUri = webview.asWebviewUri(
          vscode.Uri.joinPath(this.distPath, assetPath)
        );
        return `${prefix}${assetUri}${suffix}`;
      }
    );

    const cfg = vscode.workspace.getConfiguration('ontographEditor');
    const authoringEndpoint = cfg.get<string>('authoringServicesEndpoint', 'https://dev-snowstorm.ihtsdotools.org/authoring-services/');
    const tsEndpoint = cfg.get<string>('terminologyServerEndpoint', 'https://dev-snowstorm.ihtsdotools.org/snowstorm/snomed-ct/');
    const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://dev-snowstorm.ihtsdotools.org/');

    const proxyPort = AuthoringPanel.proxy?.port;
    const proxyOrigin = proxyPort ? `http://localhost:${proxyPort}` : '';

    const toOrigin = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

    // Rewrite an upstream URL to point at the local proxy, preserving the path.
    // Relative URLs are passed through (the Angular app resolves them itself).
    const rewrite = (url: string, fallbackBase?: string): string => {
      if (!proxyOrigin) return url;
      try {
        const u = new URL(url, fallbackBase);
        return proxyOrigin + u.pathname + u.search + u.hash;
      } catch {
        return url;
      }
    };

    const proxiedAuthoring = rewrite(authoringEndpoint);
    const proxiedTs = rewrite(tsEndpoint);

    // Process uiConfiguration FIRST so we have all endpoint origins.
    let uiConfigToInject: object | undefined = undefined;
    if (uiConfiguration) {
      const rawEndpoints = ((uiConfiguration as Record<string, unknown>).endpoints as Record<string, unknown>) || {};
      const rewrittenEndpoints: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawEndpoints)) {
        if (typeof v === 'string' && v) {
          // ui-config sometimes returns absolute URLs, sometimes path-only.
          // Resolve path-only against authoringEndpoint's origin, then rewrite to proxy.
          rewrittenEndpoints[k] = rewrite(v, authoringEndpoint);
        } else {
          rewrittenEndpoints[k] = v;
        }
      }
      uiConfigToInject = {
        ...(uiConfiguration as Record<string, unknown>),
        endpoints: {
          ...rewrittenEndpoints,
          authoringServicesEndpoint: proxiedAuthoring,
          terminologyServerEndpoint: proxiedTs,
          // Jira collector scripts are blocked by CSP in the webview sandbox
          collectorEndpoint: '',
          msCollectorEndpoint: '',
        },
      };
    }

    const csp = [
      `default-src 'none'`,
      `script-src 'unsafe-inline' 'unsafe-eval' ${webview.cspSource} https://unpkg.com https://cdn.quilljs.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`,
      `style-src 'unsafe-inline' ${webview.cspSource} https://cdn.quilljs.com https://cdn.jsdelivr.net https://fonts.googleapis.com`,
      `font-src ${webview.cspSource} https://fonts.gstatic.com data:`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `connect-src ${webview.cspSource} ${proxyOrigin} ${toOrigin(imsEndpoint)} https://unpkg.com https://cdn.quilljs.com https://cdnjs.cloudflare.com https://snomed.statuspage.io`,
    ].join('; ');

    const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const baseTag = `<base href="${baseUri}/">`;

    const ontographConfig: Record<string, unknown> = {
      authoringServicesEndpoint: proxiedAuthoring,
      terminologyServerEndpoint: proxiedTs,
      imsEndpoint: imsEndpoint,
    };
    if (accountDetails) {
      ontographConfig.accountDetails = accountDetails;
    }
    if (uiConfigToInject) {
      ontographConfig.uiConfiguration = uiConfigToInject;
    }
    const configScript = `<script>window.__ONTOGRAPH_CONFIG__=${JSON.stringify(ontographConfig)};</script>`;

    html = html.replace(/(<head[^>]*>)/i, `$1${cspTag}${baseTag}${configScript}`);

    return html;
  }

  private handleMessage(message: { command: string; payload?: unknown }): void {
    if (message.command === 'openExternal') {
      const url = (message.payload as { url?: string } | undefined)?.url;
      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
    }
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
