import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mutable state the stream mock closes over ──────────────────────────────
let writtenChunks: string[] = [];
let finishCallback: (() => void) | null = null;
let errorCallback: ((err: Error) => void) | null = null;
let drainCallback: (() => void) | null = null;
// Set to true before a test to make write() return false once (backpressure).
let triggerBackpressureOnce = false;
// Set to a non-null Error to emit 'error' instead of 'finish'.
let streamError: Error | null = null;

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn((_path: string, _opts: unknown) => ({
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'finish') finishCallback = cb as () => void;
      if (event === 'error') errorCallback = cb as (err: Error) => void;
    },
    once(event: string, cb: () => void) {
      if (event === 'drain') drainCallback = cb;
    },
    write(chunk: string) {
      writtenChunks.push(chunk);
      if (triggerBackpressureOnce) {
        triggerBackpressureOnce = false;
        return false;
      }
      return true;
    },
    end() {
      if (streamError) {
        errorCallback?.(streamError);
      } else {
        finishCallback?.();
      }
    },
  })),
}));

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtime: 1000, size: 4 }),
    },
  },
}));

vi.mock('./reloadGuard', () => ({
  recordSelfWrite: vi.fn(),
}));

import * as vscode from 'vscode';
import * as reloadGuard from './reloadGuard.js';
import { writeTextStreamed } from './streamWrite.js';

function fileUri(fsPath: string): vscode.Uri {
  return { scheme: 'file', fsPath, toString: () => `file://${fsPath}` } as unknown as vscode.Uri;
}

describe('writeTextStreamed', () => {
  beforeEach(() => {
    writtenChunks = [];
    finishCallback = null;
    errorCallback = null;
    drainCallback = null;
    triggerBackpressureOnce = false;
    streamError = null;
    vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ mtime: 1000, size: 4 } as vscode.FileStat);
    vi.mocked(reloadGuard.recordSelfWrite).mockReset();
  });

  it('non-file URI uses workspace.fs.writeFile', async () => {
    const uri = { scheme: 'untitled', fsPath: '/foo', toString: () => 'untitled:/foo' } as unknown as vscode.Uri;
    await writeTextStreamed(uri, 'hello');
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledOnce();
    const arg = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0][1] as Uint8Array;
    expect(new TextDecoder().decode(arg)).toBe('hello');
  });

  it('file URI writes via stream', async () => {
    await writeTextStreamed(fileUri('/tmp/ont.ofn'), 'abc');
    expect(writtenChunks.join('')).toBe('abc');
  });

  it('small text written in a single chunk', async () => {
    await writeTextStreamed(fileUri('/tmp/a.ofn'), 'Class: Foo\n');
    expect(writtenChunks.join('')).toBe('Class: Foo\n');
  });

  it('handles backpressure — resumes after drain event', async () => {
    const CHUNK_CHARS = 1 << 20;
    const text = 'x'.repeat(CHUNK_CHARS + 1);
    triggerBackpressureOnce = true;

    const writePromise = writeTextStreamed(fileUri('/tmp/big.ofn'), text);
    // Dynamic import inside writeTextStreamed takes several microtask ticks to
    // resolve. Poll until the stream has registered its drain handler.
    await vi.waitFor(() => { expect(drainCallback).not.toBeNull(); });
    drainCallback!();
    await writePromise;

    expect(writtenChunks.join('')).toBe(text);
    expect(writtenChunks.length).toBeGreaterThanOrEqual(2);
  });

  it('records self-write fingerprint after successful write', async () => {
    await writeTextStreamed(fileUri('/tmp/b.ofn'), 'data');
    expect(reloadGuard.recordSelfWrite).toHaveBeenCalledWith('file:///tmp/b.ofn', 1000, 4);
  });

  it('does not throw when stat fails after write', async () => {
    vi.mocked(vscode.workspace.fs.stat).mockRejectedValueOnce(new Error('stat failed'));
    await expect(writeTextStreamed(fileUri('/tmp/c.ofn'), 'data')).resolves.toBeUndefined();
    expect(reloadGuard.recordSelfWrite).not.toHaveBeenCalled();
  });

  it('rejects when stream emits error', async () => {
    streamError = new Error('disk full');
    await expect(writeTextStreamed(fileUri('/tmp/d.ofn'), 'data')).rejects.toThrow('disk full');
  });
});
