/**
 * Minimal SockJS-over-WebSocket framing + STOMP text-frame codec.
 *
 * The Angular app's scaService.js talks to authoring-services via
 * `new SockJS(wsUrl, null, {transports: ["websocket"]})` + `Stomp.over(socketProvider)` — SockJS
 * forced to its single "websocket" transport, then STOMP framed on top. Node has no equivalent of
 * that browser library pair, so this hand-rolls both framing layers directly over the `ws`
 * package rather than pulling in `sockjs-client` (Node support needs extra peer deps and is
 * browser-first) or `@stomp/stompjs` (would still need a custom adapter to unwrap SockJS's
 * `a["..."]` array framing, i.e. the same amount of code for one more dependency).
 *
 * SockJS "websocket" transport wire format (server side is Spring's SockJS, matching the
 * javascript sockjs-client's websocket.js):
 *   - "o"           - open frame, sent once right after the WS connection is accepted
 *   - "h"            - heartbeat
 *   - "a[\"msg\",...]" - one or more application-level messages, JSON-array-of-strings encoded
 *   - "c[<code>,\"<reason>\"]" - close frame
 * Outgoing application messages are sent the same way: a JSON array of strings, e.g. '["PING"]'.
 */

export type SockJsFrame =
  | { type: 'open' }
  | { type: 'heartbeat' }
  | { type: 'message'; messages: string[] }
  | { type: 'close'; code: number; reason: string }
  | { type: 'unknown'; raw: string };

export function decodeSockJsFrame(raw: string): SockJsFrame {
  if (raw === 'o') {
    return { type: 'open' };
  }
  if (raw === 'h') {
    return { type: 'heartbeat' };
  }
  if (raw.startsWith('a')) {
    try {
      const messages = JSON.parse(raw.slice(1)) as string[];
      return { type: 'message', messages };
    } catch {
      return { type: 'unknown', raw };
    }
  }
  if (raw.startsWith('c')) {
    try {
      const [code, reason] = JSON.parse(raw.slice(1)) as [number, string];
      return { type: 'close', code, reason };
    } catch {
      return { type: 'unknown', raw };
    }
  }
  return { type: 'unknown', raw };
}

export function encodeSockJsMessage(payload: string): string {
  return JSON.stringify([payload]);
}

/**
 * SockJS session path suffix Spring's server expects: `<3-digit-server-id>/<8-char-session-id>/websocket`.
 * The values only need to look plausible to the server-side router — SockJS never validates
 * them beyond routing the initial HTTP upgrade to its websocket handler.
 */
export function buildSockJsSessionPath(randomSource: () => number = Math.random): string {
  const serverId = String(Math.floor(randomSource() * 1000)).padStart(3, '0');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let sessionId = '';
  for (let i = 0; i < 8; i++) {
    sessionId += alphabet[Math.floor(randomSource() * alphabet.length)];
  }
  return `${serverId}/${sessionId}/websocket`;
}

export interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

/** STOMP wire format: `COMMAND\nheader:value\n...\n\nbody\0`. */
export function encodeStompFrame(command: string, headers: Record<string, string> = {}, body = ''): string {
  const headerLines = Object.entries(headers).map(([k, v]) => `${k}:${v}`);
  return [command, ...headerLines, '', body].join('\n') + '\0';
}

/** Returns null for STOMP heartbeat frames (a bare newline, no command). */
export function decodeStompFrame(raw: string): StompFrame | null {
  const trimmed = raw.replace(/\0$/, '');
  if (trimmed.trim() === '') {
    return null;
  }
  const headerBodySplit = trimmed.indexOf('\n\n');
  const headerBlock = headerBodySplit === -1 ? trimmed : trimmed.slice(0, headerBodySplit);
  const body = headerBodySplit === -1 ? '' : trimmed.slice(headerBodySplit + 2);
  const lines = headerBlock.split('\n');
  const command = lines[0];
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx === -1) { continue; }
    headers[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return { command, headers, body };
}
