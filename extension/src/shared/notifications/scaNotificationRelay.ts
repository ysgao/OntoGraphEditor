import WebSocket from 'ws';
import {
  buildSockJsSessionPath,
  decodeSockJsFrame,
  decodeStompFrame,
  encodeSockJsMessage,
  encodeStompFrame,
} from './sockjsStompCodec';

export interface ScaRelayOptions {
  /** authoring-services base URL, trailing slash expected — same value authoringPanel.ts already
   * resolves as `authoringEndpoint` (config `ontographEditor.authoringServicesEndpoint`). */
  authoringServicesEndpoint: string;
  /** Raw IMS session cookie; sanitized to printable ASCII before use, same as fetchAccountDetails(). */
  cookie: string;
  /** IMS login/username — the same value scaService.js reads from $rootScope.accountDetails.login
   * to build its subscription destination. */
  login: string;
  onNotification: (payload: unknown) => void;
}

export interface ScaRelayHandle {
  stop(): void;
}

// Capped exponential backoff — a dropped connection shouldn't need the panel reopened to recover.
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Opens the real STOMP-over-SockJS connection to authoring-services that scaService.js's
 * stompConnect() explicitly skips in VS Code mode (window.acquireVsCodeApi() guard — a webview
 * can't reach it directly anyway, see the CSP connect-src allowlist in authoringPanel.ts), and
 * forwards each parsed notification to `onNotification`. The caller (AuthoringPanel) relays that
 * into the webview via postMessage({command: 'SCA_NOTIFICATION', ...}), where vsCodeService.js
 * feeds it into the exact same scaService.handleNotificationPayload() the browser's own live
 * STOMP subscription would have called — see ipcMessages.ts's ScaNotificationMessage.
 */
export function startScaRelay(options: ScaRelayOptions): ScaRelayHandle {
  let stopped = false;
  let socket: WebSocket | undefined;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const safeCookie = options.cookie.replace(/[^\x20-\x7e\t]/g, '');

  const scheduleReconnect = () => {
    if (stopped) { return; }
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  function connect(): void {
    if (stopped) { return; }

    const base = options.authoringServicesEndpoint.replace(/\/+$/, '') + '/';
    const wsUrl = `${base}authoring-services-websocket/${buildSockJsSessionPath()}`;

    const ws = new WebSocket(wsUrl, {
      headers: safeCookie ? { cookie: safeCookie } : undefined,
    });
    socket = ws;

    ws.on('message', (data) => {
      const frame = decodeSockJsFrame(data.toString());

      if (frame.type === 'open') {
        // SockJS transport is up — now speak STOMP on top of it.
        ws.send(encodeSockJsMessage(encodeStompFrame('CONNECT', {
          'accept-version': '1.1,1.0',
          'heart-beat': '0,0',
          host: '/',
        })));
        return;
      }

      if (frame.type === 'close') {
        ws.close();
        return;
      }

      if (frame.type !== 'message') {
        return;
      }

      for (const raw of frame.messages) {
        const stompFrame = decodeStompFrame(raw);
        if (!stompFrame) { continue; } // heartbeat

        if (stompFrame.command === 'CONNECTED') {
          if (!stompFrame.headers['user-name']) {
            console.warn('[OntoGraph] scaNotificationRelay: CONNECTED frame missing user-name — cookie likely expired');
            ws.close();
            continue;
          }
          reconnectAttempt = 0;
          const destination = `/topic/user/${options.login}/notifications`;
          ws.send(encodeSockJsMessage(encodeStompFrame('SUBSCRIBE', {
            id: `sca-subscription-id-${options.login}`,
            destination,
          })));
          continue;
        }

        if (stompFrame.command === 'MESSAGE') {
          try {
            options.onNotification(JSON.parse(stompFrame.body));
          } catch (err) {
            console.warn('[OntoGraph] scaNotificationRelay: failed to parse notification body:', err);
          }
          continue;
        }

        if (stompFrame.command === 'ERROR') {
          console.warn('[OntoGraph] scaNotificationRelay: STOMP ERROR frame', stompFrame.headers, stompFrame.body);
        }
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      console.warn(`[OntoGraph] scaNotificationRelay: unexpected HTTP ${res.statusCode} on WS upgrade — check authoringServicesEndpoint/cookie`);
      ws.terminate();
    });

    ws.on('error', (err) => {
      console.warn('[OntoGraph] scaNotificationRelay: WebSocket error:', err.message);
    });

    ws.on('close', scheduleReconnect);
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.removeAllListeners();
      socket?.close();
    },
  };
}
