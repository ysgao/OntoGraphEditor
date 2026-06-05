import * as http from 'http';

/**
 * Starts a one-shot local HTTP server that:
 *   1. Opens IMS in the system browser via openBrowserFn, with our /callback as serviceReferer.
 *   2. Serves a callback page that ALWAYS asks the user to paste the iam_session cookie
 *      (IMS sets iam_session as HttpOnly, so document.cookie can't capture it).
 *      Auto-fetch of /auth is attempted only to preview the account name.
 *   3. Receives { account?, cookies } via POST /auth-data.
 *   4. Resolves with { account (may be null), cookies } or null on timeout.
 */
export function waitForImsCallback(
  imsEndpoint: string,
  openBrowserFn: (url: string) => void,
  timeoutMs = 120_000
): Promise<{ account: object | null; cookies: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { account: object | null; cookies: string } | null) => {
      if (!settled) {
        settled = true;
        console.log('[OntoGraph] authServer finish:',
          result ? `account=${!!result.account} cookies=${result.cookies?.length ?? 0}chars` : 'null');
        server.close();
        resolve(result);
      }
    };

    let port = 0;

    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      console.log(`[OntoGraph] authServer hit: ${req.method} ${urlPath}`);

      if (urlPath === '/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildCallbackPage(imsEndpoint, port));
        return;
      }

      if (urlPath === '/auth-data' && req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204); res.end(); return;
      }

      if (urlPath === '/auth-data' && req.method === 'POST') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        let body = '';
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          try {
            const { account, cookies } = JSON.parse(body);
            const cookieStr = (typeof cookies === 'string' ? cookies : '').trim();
            if (cookieStr) {
              finish({ account: account && typeof account === 'object' ? account : null, cookies: cookieStr });
            } else if (account && typeof account === 'object') {
              finish({ account, cookies: '' });
            } else {
              finish(null);
            }
          } catch { finish(null); }
        });
        return;
      }

      res.writeHead(404); res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      const callbackUrl = `http://localhost:${port}/callback`;
      console.log(`[OntoGraph] authServer listening on ${port}, opening browser to: ${imsEndpoint}?serviceReferer=${encodeURIComponent(callbackUrl)}`);
      openBrowserFn(`${imsEndpoint}?serviceReferer=${encodeURIComponent(callbackUrl)}`);
    });

    server.on('error', (err) => {
      console.error('[OntoGraph] authServer error:', err);
      finish(null);
    });
    setTimeout(() => {
      console.log('[OntoGraph] authServer timeout fired');
      finish(null);
    }, timeoutMs);
  });
}

function buildCallbackPage(imsEndpoint: string, port: number): string {
  const authUrl = imsEndpoint.replace(/\/$/, '') + '/auth';
  const dataUrl = `http://localhost:${port}/auth-data`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OntoGraph – Sign In</title>
  <style>
    body{font-family:sans-serif;padding:2rem;color:#333;max-width:560px}
    h3{margin-top:0}
    label{display:block;font-size:13px;margin-bottom:4px;font-weight:600}
    input{width:100%;padding:8px;font-size:13px;box-sizing:border-box;border:1px solid #ccc;border-radius:3px;font-family:monospace}
    button{margin-top:10px;padding:8px 18px;background:#0070d2;color:#fff;border:none;
           border-radius:3px;cursor:pointer;font-size:14px}
    button:hover{background:#005bb5}
    button:disabled{background:#999;cursor:not-allowed}
    .hint{font-size:13px;color:#444;margin:8px 0;line-height:1.5}
    code{background:#f4f4f4;padding:1px 4px;border-radius:2px;font-size:12px}
    .err{color:#c00;font-size:13px;margin-top:8px;display:none}
    .ok{color:#080;font-size:13px;margin:8px 0;display:none}
    .preview{background:#f0f7ff;padding:10px;border-radius:4px;font-size:13px;margin:10px 0;display:none}
  </style>
</head>
<body>
<h3 id="title">OntoGraph – Complete Sign-In</h3>
<p>You are signed in to IMS in this browser. To let the VS Code extension use your session,
   paste your <code>iam_session</code> cookie value below.</p>

<div id="preview" class="preview"></div>

<p class="hint">
  <strong>How to find it:</strong><br>
  Open <strong>DevTools</strong> (F12) → <strong>Application</strong> tab (Chrome/Edge) or
  <strong>Storage</strong> tab (Firefox) → expand <strong>Cookies</strong> →
  click the IMS domain → find row <code>iam_session</code> → copy the <em>Value</em> column.
</p>

<label for="cookie">iam_session value</label>
<input id="cookie" type="text" placeholder="abc123def456…" autocomplete="off" spellcheck="false" autofocus>
<button id="submitBtn" onclick="submitCookie()">Submit</button>
<p class="err" id="err"></p>
<p class="ok" id="ok"></p>

<script>
// Try to preview the account (best-effort; not required).
(async function () {
  try {
    const res = await fetch(${JSON.stringify(authUrl)}, { credentials: 'include' });
    if (!res.ok) return;
    const account = await res.json();
    const previewEl = document.getElementById('preview');
    const name = account.displayName || account.login || account.username || account.email || 'signed in';
    previewEl.textContent = 'Detected account: ' + name;
    previewEl.style.display = '';
    window.__previewAccount = account;
  } catch (e) {
    // Auto-fetch blocked — no preview, but cookie paste still works.
  }
})();

async function submitCookie() {
  const val = document.getElementById('cookie').value.trim();
  const err = document.getElementById('err');
  const ok = document.getElementById('ok');
  err.style.display = 'none';
  ok.style.display = 'none';
  if (!val) {
    err.textContent = 'Please paste the iam_session value.';
    err.style.display = '';
    return;
  }
  const cookieStr = val.startsWith('iam_session=') ? val : 'iam_session=' + val;
  document.getElementById('submitBtn').disabled = true;
  try {
    await fetch(${JSON.stringify(dataUrl)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: window.__previewAccount || null, cookies: cookieStr })
    });
    ok.textContent = 'Cookie submitted! Return to VS Code — the panel will reload.';
    ok.style.display = '';
  } catch (e) {
    err.textContent = 'Failed to submit: ' + String(e);
    err.style.display = '';
    document.getElementById('submitBtn').disabled = false;
  }
}
</script>
</body>
</html>`;
}
