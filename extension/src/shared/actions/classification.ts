import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, authoringServicesEndpoint, terminologyServerEndpoint, getCookie, deriveBranchRoot } from './taskContext';
import { fetchTask } from './fetchTask';

const CLASSIFICATION_RUNNING_STATUSES = ['RUNNING', 'BUILDING', 'SCHEDULED', 'QUEUED'];
const VALIDATION_RUNNING_STATUSES = ['QUEUED', 'SCHEDULED', 'RUNNING'];
const BLOCKED_TASK_STATUSES = ['Promoted', 'Completed'];

const POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_SECONDS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
  check: () => Promise<{ done: boolean; value: T }>,
  intervalMs: number,
  maxAttempts: number
): Promise<{ value: T; timedOut: boolean }> {
  let attempt = 0;
  for (;;) {
    const { done, value } = await check();
    if (done) {
      return { value, timedOut: false };
    }
    if (attempt >= maxAttempts) {
      return { value, timedOut: true };
    }
    attempt++;
    await sleep(intervalMs);
  }
}

/** Mirrors edit.js's $scope.classify()/taskDetail.js's $scope.startValidation() precondition
 * checks: block on a Promoted/Completed task, and transition New -> IN_PROGRESS first. */
async function ensureTaskInProgress(ctx: ActionContext, projectKey: string, taskKey: string): Promise<{ error?: string }> {
  const task = await fetchTask(ctx, projectKey, taskKey);
  if (!task) {
    return { error: `Could not fetch task ${projectKey}/${taskKey}.` };
  }
  if (task.status && BLOCKED_TASK_STATUSES.includes(task.status)) {
    return { error: `Task ${projectKey}/${taskKey} is ${task.status} — cannot start a new job.` };
  }
  if (task.status === 'New') {
    const cookie = await getCookie(ctx);
    const url = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}`;
    await requestJson(url, { method: 'PUT', body: { status: 'IN_PROGRESS' }, cookie });
  }
  return {};
}

export interface ClassifyInput extends TaskContextInput {
  wait?: boolean;
  timeoutSeconds?: number;
}

export async function classify(ctx: ActionContext, input: ClassifyInput): Promise<ActionResult> {
  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }
  const { projectKey, taskKey, branchPath } = taskContext;

  const precheck = await ensureTaskInProgress(ctx, projectKey, taskKey);
  if (precheck.error) {
    return { statusCode: 400, body: { error: precheck.error } };
  }

  const cookie = await getCookie(ctx);
  const startUrl = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}/classifications`;
  const startResult = await requestJson<{ id?: string; status?: string }>(startUrl, { method: 'POST', body: {}, cookie });

  if (startResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }
  if (!startResult.body?.id) {
    ctx.outputChannel.appendLine(
      `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: start failed (HTTP ${startResult.statusCode}) — raw body: ${startResult.rawBody}`
    );
    return {
      statusCode: startResult.statusCode || 500,
      body: { error: 'Failed to start classification.', details: startResult.body ?? startResult.rawBody },
    };
  }

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: started (${startResult.body.status ?? 'unknown'})`
  );

  if (!input.wait) {
    return { statusCode: 200, body: { jobId: startResult.body.id, status: startResult.body.status } };
  }

  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const maxAttempts = Math.ceil((timeoutSeconds * 1000) / POLL_INTERVAL_MS);

  // authoring-services caches latestClassificationJson; without this cache-evict before every
  // check, a completed job keeps reading back as stale "RUNNING" forever (the exact bug fixed
  // in edit.js's pollClassificationStatusInVsCode()).
  const { value: finalStatus, timedOut } = await pollUntil(
    async () => {
      const evictUrl = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}/classifications/status/cache-evict`;
      await requestJson(evictUrl, { method: 'POST', body: {}, cookie });
      const task = await fetchTask(ctx, projectKey, taskKey);
      const status = task?.latestClassificationJson?.status as string | undefined;
      const stillRunning = !status || CLASSIFICATION_RUNNING_STATUSES.includes(status);
      return { done: !stillRunning, value: status };
    },
    POLL_INTERVAL_MS,
    maxAttempts
  );

  let details: unknown;
  const branchRoot = deriveBranchRoot(branchPath);
  const classificationsUrl = `${terminologyServerEndpoint()}/${branchRoot}/classifications`;
  const classificationsResult = await requestJson<{ items?: unknown[] }>(classificationsUrl, { cookie });
  if (classificationsResult.body?.items?.length) {
    details = classificationsResult.body.items[classificationsResult.body.items.length - 1];
  }

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: final status ${finalStatus ?? 'unknown'}${timedOut ? ' (timed out waiting)' : ''}`
  );

  return { statusCode: 200, body: { jobId: startResult.body.id, finalStatus, timedOut, details } };
}

export interface ValidateInput extends TaskContextInput {
  enableMrcmValidation?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
}

export async function validate(ctx: ActionContext, input: ValidateInput): Promise<ActionResult> {
  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }
  const { projectKey, taskKey } = taskContext;

  const precheck = await ensureTaskInProgress(ctx, projectKey, taskKey);
  if (precheck.error) {
    return { statusCode: 400, body: { error: precheck.error } };
  }

  const cookie = await getCookie(ctx);
  let startUrl = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}/validation`;
  if (typeof input.enableMrcmValidation === 'boolean') {
    startUrl += `?enableMRCMValidation=${input.enableMrcmValidation}`;
  }
  const startResult = await requestJson(startUrl, { method: 'POST', body: {}, cookie });

  if (startResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }
  if (startResult.statusCode < 200 || startResult.statusCode >= 300) {
    return { statusCode: startResult.statusCode, body: { error: 'Failed to start validation.', details: startResult.body } };
  }

  ctx.outputChannel.appendLine(`[${new Date().toISOString()}] validate ${projectKey}/${taskKey}: started`);

  if (!input.wait) {
    return { statusCode: 200, body: { started: true } };
  }

  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const maxAttempts = Math.ceil((timeoutSeconds * 1000) / POLL_INTERVAL_MS);

  // Unlike classification, no cache-evict endpoint exists for validation status in
  // scaService.js — inferred safe to poll directly, but not confirmed against a live server.
  // If this is later found to also read back stale, add an evict call the same way classify does.
  const { value: finalStatus, timedOut } = await pollUntil(
    async () => {
      const task = await fetchTask(ctx, projectKey, taskKey);
      const status = task?.latestValidationStatus;
      const stillRunning = !status || VALIDATION_RUNNING_STATUSES.includes(status);
      return { done: !stillRunning, value: status };
    },
    POLL_INTERVAL_MS,
    maxAttempts
  );

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] validate ${projectKey}/${taskKey}: final status ${finalStatus ?? 'unknown'}${timedOut ? ' (timed out waiting)' : ''}`
  );

  return { statusCode: 200, body: { finalStatus, timedOut } };
}
