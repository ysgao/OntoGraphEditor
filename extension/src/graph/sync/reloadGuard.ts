let suppressUntil = 0;
const activeWrites = new Map<string, number>();
const writeQueue = new Map<string, Promise<void>>();
const ownWrites = new Map<string, { mtime: number; size: number }>();

/**
 * Record the post-write stat of a file we wrote. Used by the file watcher to
 * tell apart "our own write" from "external edit": if the stat the watcher
 * sees matches the fingerprint, it suppresses the reload. Required because
 * disposing the watcher during the write is not enough — macOS fsevents can
 * deliver the change event milliseconds AFTER the watcher is recreated.
 */
export function recordSelfWrite(uri: string, mtime: number, size: number): void {
  ownWrites.set(uri, { mtime, size });
}

/**
 * True when `stat` matches the last recorded self-write for this URI.
 * mtime tolerance: 100ms (filesystem-timer granularity).
 */
export function isOwnRecentWrite(uri: string, mtime: number, size: number): boolean {
  const w = ownWrites.get(uri);
  if (!w) { return false; }
  return Math.abs(w.mtime - mtime) < 100 && w.size === size;
}

export type WatcherSuspendHandler = (uri: string, suspend: boolean) => void;
let watcherSuspendHandler: WatcherSuspendHandler | undefined;

/**
 * Register a callback that disposes/recreates the file-system watcher around a
 * programmatic write. queueSyncWrite calls handler(uri, true) before fn and
 * handler(uri, false) after fn completes, so the watcher never sees the change
 * events emitted by our own writeFile.
 */
export function registerWatcherSuspendHandler(h: WatcherSuspendHandler | undefined): void {
  watcherSuspendHandler = h;
}

export function suppressReloadFor(ms: number): void {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

/**
 * True while a programmatic write is in progress (or while the legacy global
 * suppress window is open). When `uri` is provided, only checks that URI.
 * Used by handleDocument and any other re-parse path to defer work until the
 * in-memory model and disk are back in agreement.
 */
export function isReloadSuppressed(uri?: string): boolean {
  if (Date.now() < suppressUntil) { return true; }
  if (uri !== undefined) { return (activeWrites.get(uri) ?? 0) > 0; }
  for (const n of activeWrites.values()) { if (n > 0) { return true; } }
  return false;
}

export function beginSyncWrite(uri: string): void {
  activeWrites.set(uri, (activeWrites.get(uri) ?? 0) + 1);
}

export function endSyncWrite(uri: string): void {
  const n = (activeWrites.get(uri) ?? 1) - 1;
  if (n <= 0) { activeWrites.delete(uri); } else { activeWrites.set(uri, n); }
}

/**
 * Serialize writes to the same URI. Each call appends to the per-URI promise
 * chain. While fn runs:
 *   • the lock is held (isReloadSuppressed(uri) === true) so re-parse paths
 *     other than the file watcher skip,
 *   • the file watcher is suspended via the registered handler so OS change
 *     events from our own write never fire onDidChange.
 * The watcher is resumed only after fn resolves/rejects, bounding suspension
 * to the actual write window — no fixed cooldown timer.
 */
export function queueSyncWrite(uri: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueue.get(uri) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    beginSyncWrite(uri);
    watcherSuspendHandler?.(uri, true);
    try {
      await fn();
    } finally {
      // Release suspension BEFORE clearing the lock so the watcher is back in
      // place before any other path can observe lock=false.
      watcherSuspendHandler?.(uri, false);
      endSyncWrite(uri);
    }
  });
  writeQueue.set(uri, next.finally(() => {
    if (writeQueue.get(uri) === next) { writeQueue.delete(uri); }
  }));
  return next;
}
