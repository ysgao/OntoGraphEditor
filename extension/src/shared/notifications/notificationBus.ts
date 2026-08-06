/**
 * In-process pub/sub for parsed SCA STOMP notifications (see scaNotificationRelay.ts). Both
 * consumers run inside the same extension host process as the relay, so this is a plain
 * EventEmitter-style bus rather than anything involving IPC or caching:
 *  - extension.ts forwards every notification into the open Authoring webview (if any).
 *  - classification.ts's poll loop wakes early on a matching notification instead of only on its
 *    next scheduled tick, so authoring-cli's `classify --wait`/`validate-task --wait` benefit too
 *    without needing their own STOMP connection or any ControlServer route changes.
 */

export type NotificationPayload = Record<string, unknown>;

export interface NotificationMatch {
  /** Omit to match any entityType — used by watchNotification.ts's "tell me what happens next"
   * command; classification.ts's wake-early usage always passes one explicitly. */
  entityType?: string;
  projectKey: string;
  taskKey: string;
  branchPath: string;
}

type Listener = (payload: NotificationPayload) => void;

const listeners = new Set<Listener>();

export function emitNotification(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  for (const listener of listeners) {
    listener(payload as NotificationPayload);
  }
}

/** Returns an unsubscribe function. */
export function onNotification(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Mirrors scaService.js's handleNotificationPayload switch cases: a notification names a task,
 * OR (no task) a project, OR (no task, no project) a branchPath — never more than one of the
 * three, so matching falls back through them in that same order.
 */
export function matchesNotification(payload: NotificationPayload, match: NotificationMatch): boolean {
  if (match.entityType !== undefined && payload.entityType !== match.entityType) {
    return false;
  }
  if (payload.task) {
    return payload.task === match.taskKey && payload.project === match.projectKey;
  }
  if (payload.project) {
    return payload.project === match.projectKey;
  }
  return payload.branchPath === match.branchPath;
}

export interface WaitHandle {
  promise: Promise<NotificationPayload>;
  cancel: () => void;
}

/** Resolves with the matching payload the first time a notification matching `match` arrives.
 * cancel() unsubscribes without resolving — call it when giving up on the wait for any other
 * reason (e.g. a race against a timer that won instead). Safe to call after the promise already
 * resolved. */
export function waitForNotification(match: NotificationMatch): WaitHandle {
  let unsubscribe: () => void = () => {};
  const promise = new Promise<NotificationPayload>((resolve) => {
    unsubscribe = onNotification((payload) => {
      if (matchesNotification(payload, match)) {
        unsubscribe();
        resolve(payload);
      }
    });
  });
  return { promise, cancel: unsubscribe };
}
