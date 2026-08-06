import { describe, expect, it } from 'vitest';
import {
  buildSockJsSessionPath,
  decodeSockJsFrame,
  decodeStompFrame,
  encodeSockJsMessage,
  encodeStompFrame,
} from './sockjsStompCodec';

describe('decodeSockJsFrame', () => {
  it('decodes the open frame', () => {
    expect(decodeSockJsFrame('o')).toEqual({ type: 'open' });
  });

  it('decodes a heartbeat frame', () => {
    expect(decodeSockJsFrame('h')).toEqual({ type: 'heartbeat' });
  });

  it('decodes a message frame containing one STOMP frame', () => {
    const raw = 'a["CONNECTED\\nversion:1.1\\n\\n\\u0000"]';
    const decoded = decodeSockJsFrame(raw);
    expect(decoded.type).toBe('message');
    if (decoded.type === 'message') {
      expect(decoded.messages).toEqual(['CONNECTED\nversion:1.1\n\n\u0000']);
    }
  });

  it('decodes a message frame containing multiple STOMP frames', () => {
    const raw = 'a["one","two"]';
    const decoded = decodeSockJsFrame(raw);
    expect(decoded).toEqual({ type: 'message', messages: ['one', 'two'] });
  });

  it('decodes a close frame', () => {
    expect(decodeSockJsFrame('c[3000,"Go away!"]')).toEqual({ type: 'close', code: 3000, reason: 'Go away!' });
  });

  it('falls back to unknown for malformed frames', () => {
    expect(decodeSockJsFrame('a[not json')).toEqual({ type: 'unknown', raw: 'a[not json' });
  });
});

describe('encodeSockJsMessage', () => {
  it('wraps the payload in a one-element JSON array', () => {
    expect(encodeSockJsMessage('hello')).toBe('["hello"]');
  });
});

describe('buildSockJsSessionPath', () => {
  it('builds a <3-digit>/<8-char>/websocket path', () => {
    const path = buildSockJsSessionPath(() => 0);
    expect(path).toMatch(/^\d{3}\/[a-z0-9]{8}\/websocket$/);
  });

  it('varies with the random source', () => {
    let calls = 0;
    const source = () => {
      calls += 1;
      return calls % 2 === 0 ? 0.9 : 0.1;
    };
    const path = buildSockJsSessionPath(source);
    expect(path).toMatch(/^\d{3}\/[a-z0-9]{8}\/websocket$/);
  });
});

describe('encodeStompFrame / decodeStompFrame', () => {
  it('round-trips a frame with headers and a body', () => {
    const encoded = encodeStompFrame('SEND', { destination: '/topic/foo', 'content-type': 'application/json' }, '{"a":1}');
    expect(encoded).toBe('SEND\ndestination:/topic/foo\ncontent-type:application/json\n\n{"a":1}\0');
    const decoded = decodeStompFrame(encoded);
    expect(decoded).toEqual({
      command: 'SEND',
      headers: { destination: '/topic/foo', 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('round-trips a frame with no headers and no body', () => {
    const encoded = encodeStompFrame('DISCONNECT');
    const decoded = decodeStompFrame(encoded);
    expect(decoded).toEqual({ command: 'DISCONNECT', headers: {}, body: '' });
  });

  it('parses a real CONNECTED frame', () => {
    const raw = 'CONNECTED\nversion:1.1\nuser-name:jbloggs\n\n\0';
    expect(decodeStompFrame(raw)).toEqual({
      command: 'CONNECTED',
      headers: { version: '1.1', 'user-name': 'jbloggs' },
      body: '',
    });
  });

  it('parses a MESSAGE frame carrying a JSON body', () => {
    const raw = 'MESSAGE\ndestination:/topic/user/jbloggs/notifications\nsubscription:sca-subscription-id-jbloggs\n\n{"entityType":"Classification","event":"Classification completed successfully","project":"WRPAS","task":"WRPAS-98","branchPath":"MAIN/WRPAS/WRPAS-98"}\0';
    const decoded = decodeStompFrame(raw);
    expect(decoded?.command).toBe('MESSAGE');
    expect(decoded?.headers.destination).toBe('/topic/user/jbloggs/notifications');
    expect(JSON.parse(decoded?.body ?? '')).toEqual({
      entityType: 'Classification',
      event: 'Classification completed successfully',
      project: 'WRPAS',
      task: 'WRPAS-98',
      branchPath: 'MAIN/WRPAS/WRPAS-98',
    });
  });

  it('returns null for a bare heartbeat frame', () => {
    expect(decodeStompFrame('\n')).toBeNull();
  });
});
