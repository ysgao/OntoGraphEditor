import * as http from 'http';
import * as https from 'https';

/**
 * Minimal HTTP reverse-proxy that runs inside the extension host.
 *
 * The VS Code webview runs in a sandboxed Electron BrowserView with a
 * vscode-webview:// origin. External APIs like authoring-services have no
 * Access-Control-Allow-Origin for that origin, so all XHR calls are
 * CORS-blocked. This proxy listens on localhost, adds CORS headers, and
 * forwards requests to the real backend — bypassing the browser CORS check
 * because Node.js is not subject to it.
 *
 * Authentication: The authoring-services backend uses IMS session cookies.
 * The webview has its own isolated cookie jar (not shared with the system
 * browser), so logged-in IMS cookies are not available in the webview.
 * Workaround: the user pastes their IMS session cookie into the VS Code
 * setting `ontographEditor.imsSessionCookie`; the proxy injects it into
 * every forwarded request.
 */
export class LocalProxy {
  private server: http.Server | null = null;
  private _port = 0;
  private targetBase: URL;
  private sessionCookie: string;

  constructor(targetEndpoint: string, sessionCookie = '') {
    // Use the upstream ORIGIN (scheme + host + port) — request path is forwarded verbatim,
    // so the same proxy can reach /authoring-services/*, /snowstorm/*, /template-service/*, etc.
    const u = new URL(targetEndpoint);
    this.targetBase = new URL(u.origin + '/');
    this.sessionCookie = sessionCookie;
  }

  updateSessionCookie(cookie: string): void {
    this.sessionCookie = cookie;
  }

  get port(): number { return this._port; }

  start(): Promise<number> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
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

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept,X-Requested-With');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const targetPath = req.url || '/';

    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    headers['host'] = this.targetBase.host;
    // Remove origin/referer so the backend doesn't see vscode-webview://
    delete headers['origin'];
    delete headers['referer'];

    if (this.sessionCookie) {
      const safe = this.sessionCookie.replace(/[^\x20-\x7e\t]/g, '');
      if (safe) { headers['cookie'] = safe; }
    }

    const options: https.RequestOptions = {
      hostname: this.targetBase.hostname,
      port: this.targetBase.port || (this.targetBase.protocol === 'https:' ? 443 : 80),
      path: targetPath,
      method: req.method,
      headers: headers as http.OutgoingHttpHeaders,
    };

    const lib = this.targetBase.protocol === 'https:' ? https : http;
    const proxyReq = lib.request(options, (proxyRes) => {
      const outHeaders: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (k.toLowerCase() !== 'access-control-allow-origin') {
          outHeaders[k] = v;
        }
      }
      outHeaders['access-control-allow-origin'] = '*';
      res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[OntoGraph proxy] upstream error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end(`Proxy error: ${err.message}`);
    });

    req.pipe(proxyReq);
  }
}
