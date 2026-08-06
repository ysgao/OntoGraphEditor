import { requestJson } from '../httpJson';

/**
 * GET <imsEndpoint>/auth — the IMS "who am I" endpoint, cookie-authenticated. Extracted out of
 * authoringPanel.ts (which still uses this for window.__ONTOGRAPH_CONFIG__.accountDetails) so
 * scaRelayManager.ts can resolve the same `login` for its STOMP subscription destination without
 * a webview panel ever having opened.
 */
export async function fetchAccountDetails(imsEndpoint: string, cookie: string): Promise<Record<string, unknown> | null> {
  const url = imsEndpoint.replace(/\/$/, '') + '/auth';
  const result = await requestJson<Record<string, unknown>>(url, { cookie, timeoutMs: 8000 });
  if (result.statusCode >= 200 && result.statusCode < 300 && result.body) {
    return result.body;
  }
  console.warn(`[OntoGraph] fetchAccountDetails: HTTP ${result.statusCode} from ${url}`);
  return null;
}
