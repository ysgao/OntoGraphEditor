import { readSession } from '../session';
import { callControlServer } from '../client';

export interface WatchNotificationArgs {
  project?: string;
  task?: string;
  entityType?: string;
  timeout?: string;
}

interface WatchNotificationResponse {
  timedOut?: boolean;
  notification?: unknown;
  error?: string;
  [key: string]: unknown;
}

export async function runWatchNotification(args: WatchNotificationArgs): Promise<void> {
  const session = readSession();

  const query = new URLSearchParams();
  if (args.project) {
    query.set('projectKey', args.project);
  }
  if (args.task) {
    query.set('taskKey', args.task);
  }
  if (args.entityType) {
    query.set('entityType', args.entityType);
  }
  if (args.timeout) {
    query.set('timeoutSeconds', args.timeout);
  }
  const qs = query.toString();
  const path = `/tasks/wait-notification${qs ? `?${qs}` : ''}`;

  const result = await callControlServer<WatchNotificationResponse>(session, 'GET', path);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
    console.error(`Failed to watch for a notification (HTTP ${result.statusCode}): ${detail}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.body, null, 2));
  if (result.body.timedOut) {
    process.exitCode = 1;
  }
}
