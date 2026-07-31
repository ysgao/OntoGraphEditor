import * as http from 'http';
import * as https from 'https';

export interface RequestJsonOptions {
  method?: string;
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface RequestJsonResult<T = unknown> {
  statusCode: number;
  body: T | null;
  rawBody: string;
  /** True when a JSON response was expected but an HTML/non-JSON body came back — usually an expired-session login redirect. */
  sessionExpired: boolean;
}

/** Shared raw http/https JSON request helper for the extension host (no external HTTP dependency is installed). */
export function requestJson<T = unknown>(url: string, opts: RequestJsonOptions = {}): Promise<RequestJsonResult<T>> {
  const { method = 'GET', cookie, body, headers = {}, timeoutMs = 15000 } = opts;

  return new Promise((resolve, reject) => {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch (err) {
      reject(err as Error);
      return;
    }

    const lib = urlObj.protocol === 'https:' ? https : http;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;

    const outHeaders: Record<string, string> = {
      accept: 'application/json',
      ...headers,
    };
    if (payload !== undefined) {
      outHeaders['content-type'] = 'application/json';
      outHeaders['content-length'] = String(Buffer.byteLength(payload));
    }
    if (cookie) {
      const safe = cookie.replace(/[^\x20-\x7e\t]/g, '');
      if (safe) {
        outHeaders['cookie'] = safe;
      }
    }

    const req = lib.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: outHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          const contentType = res.headers['content-type'] ?? '';
          const looksJson = contentType.includes('application/json');
          let parsed: T | null = null;
          let sessionExpired = false;
          if (data) {
            try {
              parsed = JSON.parse(data) as T;
            } catch {
              sessionExpired = !looksJson;
            }
          }
          resolve({ statusCode, body: parsed, rawBody: data, sessionExpired });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}
