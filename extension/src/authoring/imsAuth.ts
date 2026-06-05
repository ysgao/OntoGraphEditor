import * as https from 'https';
import * as http from 'http';

/**
 * Logs into IHTSDO IMS with username/password.
 * Returns the session cookie string (e.g. "iam_session=abc123") extracted
 * from the Set-Cookie response header, or null on failure.
 */
export function imsLogin(imsEndpoint: string, username: string, password: string): Promise<string | null> {
  const url = imsEndpoint.replace(/\/$/, '') + '/api/auth/login';
  // IHTSDO IMS uses "login" field name, not "username"
  const body = JSON.stringify({ login: username, password });

  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    let urlObj: URL;
    try { urlObj = new URL(url); } catch { resolve(null); return; }

    console.log(`[OntoGraph] IMS login POST → ${url}`);

    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || undefined,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk: string) => { responseBody += chunk; });
      res.on('end', () => {
        console.log(`[OntoGraph] IMS login response: HTTP ${res.statusCode}`);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          const setCookie = res.headers['set-cookie'];
          if (setCookie?.length) {
            const cookies = setCookie.map(c => c.split(';')[0].trim()).join('; ');
            resolve(cookies);
            return;
          }
          console.warn('[OntoGraph] IMS login: 2xx but no Set-Cookie header. Body:', responseBody.slice(0, 200));
        } else {
          console.warn(`[OntoGraph] IMS login: HTTP ${res.statusCode}. Body:`, responseBody.slice(0, 200));
        }
        resolve(null);
      });
    });

    req.on('error', (err: Error) => {
      console.warn('[OntoGraph] IMS login request failed:', err.message);
      resolve(null);
    });
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}
