import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext } from './taskContext';
import { waitForNotification } from '../notifications/notificationBus';
import type { NotificationPayload } from '../notifications/notificationBus';

const DEFAULT_TIMEOUT_SECONDS = 60;

export interface WatchNotificationInput extends TaskContextInput {
  /** Omit to match any of Classification/Validation/Rebase/Promotion/BranchState/BranchHead/
   * Feedback/AuthorChange — the entityType values scaService.js's handleNotificationPayload
   * switch handles (ConflictReport stays an unhandled TODO there too). */
  entityType?: string;
  timeoutSeconds?: number;
}

type RaceResult = { kind: 'notification'; payload: NotificationPayload } | { kind: 'timeout' };

/**
 * Blocks until the next SCA notification matching this task (and, if given, entityType) arrives,
 * or `timeoutSeconds` elapses — a read-only "tell me what happens next" companion to
 * classify()/validate(), which only wake early on a notification for their own specific job.
 * Reuses resolveTaskContext() exactly like those two, so — like them — this requires a
 * resolvable project+task (explicit or the currently open one); watching a whole project or
 * branch with no task is out of scope.
 */
export async function watchNotification(ctx: ActionContext, input: WatchNotificationInput): Promise<ActionResult> {
  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }
  const { projectKey, taskKey, branchPath } = taskContext;
  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  const wake = waitForNotification({ entityType: input.entityType, projectKey, taskKey, branchPath });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<RaceResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutSeconds * 1000);
  });
  const notified = wake.promise.then((payload): RaceResult => ({ kind: 'notification', payload }));

  const result = await Promise.race([notified, timeout]);
  wake.cancel();
  clearTimeout(timer);

  if (result.kind === 'timeout') {
    return { statusCode: 200, body: { timedOut: true } };
  }
  return { statusCode: 200, body: { timedOut: false, notification: result.payload } };
}
