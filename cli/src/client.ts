import * as http from 'http';
import type { SessionFile } from './session';

export interface HttpJsonResult<T> {
  statusCode: number;
  body: T;
}

/** Thin client for the extension host's token-authed ControlServer (extension/src/shared/controlServer.ts). */
export function callControlServer<T = unknown>(
  session: SessionFile,
  method: string,
  requestPath: string,
  body?: unknown
): Promise<HttpJsonResult<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${session.token}`,
    };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request(
      { hostname: session.host, port: session.port, path: requestPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: T;
          try {
            parsed = data ? (JSON.parse(data) as T) : ({} as T);
          } catch (err) {
            reject(new Error(`Could not parse response from OntoGraph Editor control server: ${(err as Error).message}`));
            return;
          }
          resolve({ statusCode: res.statusCode ?? 0, body: parsed });
        });
      }
    );

    req.on('error', (err) => {
      reject(
        new Error(
          `Could not reach OntoGraph Editor's control server at ${session.host}:${session.port} — ` +
            `is the extension still running in VS Code? (${err.message})`
        )
      );
    });

    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}
