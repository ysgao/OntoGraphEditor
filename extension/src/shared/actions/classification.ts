import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, authoringServicesEndpoint, terminologyServerEndpoint, getCookie, deriveBranchRoot } from './taskContext';
import { fetchTask } from './fetchTask';

const CLASSIFICATION_RUNNING_STATUSES = ['RUNNING', 'BUILDING', 'SCHEDULED', 'QUEUED'];
const VALIDATION_RUNNING_STATUSES = ['QUEUED', 'SCHEDULED', 'RUNNING'];
const BLOCKED_TASK_STATUSES = ['Promoted', 'Completed'];

const POLL_INTERVAL_MS = 5000;

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

/**
 * Same tightening cadence as apps/authoring-ui-vscode/app/components/edit/edit.js's
 * buildClassificationPollSchedule() — classification normally finishes in ~2 minutes, so a 90s
 * upfront skip has no real cost, then check every 10s for 30s as completion becomes likely, then
 * settle into a steady 5s cadence. Kept in sync deliberately: same underlying job, same expected
 * timing, so the CLI and the webview should feel the same when watching one complete.
 */
function buildClassificationPollSchedule(): number[] {
  const schedule = [90000];
  for (let i = 0; i < 3; i++) {
    schedule.push(10000);
  }
  for (let i = 0; i < 12; i++) {
    schedule.push(5000);
  }
  return schedule;
}

const CLASSIFICATION_POLL_SCHEDULE = buildClassificationPollSchedule();
// Schedule sums to exactly 3 minutes (90 + 3*10 + 12*5) — classification taking longer than that
// is well outside normal timing (see the webview's matching cutoff), so that's this CLI action's
// default `--timeout` too. Once the fixed schedule is exhausted, polling continues at its last
// (5s) interval until the caller's own timeoutSeconds budget elapses — so an explicit `--timeout`
// larger than 180 (e.g. for a known-large branch where ELK genuinely takes 10-20+ minutes) still
// works, it just settles into the steady 5s cadence rather than getting a schedule entry of its own.
const CLASSIFICATION_DEFAULT_TIMEOUT_SECONDS = 180;

/**
 * Task-level validation (RVF) routinely takes ~10 minutes or more — an order of magnitude longer
 * than classification's ~2 minutes — so the same flat 5s interval used for classification (or
 * even that command's tightened schedule) would still mean well over a hundred wasted round trips
 * before it's realistically done. Skip the first 5 minutes entirely, then check once a minute for
 * the next 5 (spanning the typical ~10-minute completion point), then settle into a steadier 30s
 * cadence for another 5 minutes. Sums to 15 minutes (300 + 5*60 + 10*30), this action's default
 * `--timeout` — same "well outside normal timing" reasoning as classification's cutoff, just
 * scaled to validation's much longer typical duration.
 */
function buildValidationPollSchedule(): number[] {
  const schedule = [300000];
  for (let i = 0; i < 5; i++) {
    schedule.push(60000);
  }
  for (let i = 0; i < 10; i++) {
    schedule.push(30000);
  }
  return schedule;
}

const VALIDATION_POLL_SCHEDULE = buildValidationPollSchedule();
const VALIDATION_DEFAULT_TIMEOUT_SECONDS = 900;

async function pollWithSchedule<T>(
  check: () => Promise<{ done: boolean; value: T }>,
  schedule: number[],
  timeoutSeconds: number
): Promise<{ value: T; timedOut: boolean }> {
  const timeoutMs = timeoutSeconds * 1000;
  let elapsedMs = 0;
  let index = 0;
  for (;;) {
    const delay = schedule[Math.min(index, schedule.length - 1)];
    await sleep(delay);
    elapsedMs += delay;
    const { done, value } = await check();
    if (done) {
      return { value, timedOut: false };
    }
    if (elapsedMs >= timeoutMs) {
      return { value, timedOut: true };
    }
    index++;
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

/**
 * Reads the task's current `latestClassificationJson` without starting anything — mirrors
 * edit.js's `pollClassificationStatusInVsCode()`: cache-evict then re-fetch the task. Without the
 * evict call first, authoring-services keeps serving a cached snapshot, so a job that's actually
 * finished can read back as permanently "RUNNING" (the same bug that function works around for
 * the webview's spinner; see apps/authoring-ui-vscode/CLAUDE.md's "Classification/validation
 * status polling in VS Code mode").
 */
async function fetchLatestClassificationJson(
  ctx: ActionContext,
  projectKey: string,
  taskKey: string,
  cookie: string
): Promise<Record<string, unknown> | undefined> {
  const evictUrl = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}/classifications/status/cache-evict`;
  await requestJson(evictUrl, { method: 'POST', body: {}, cookie });
  const task = await fetchTask(ctx, projectKey, taskKey);
  return task?.latestClassificationJson as Record<string, unknown> | undefined;
}

/** Polls an in-flight classification job (started by this call or found already running) to a
 * terminal status, evicting the cache each attempt per fetchLatestClassificationJson's note. Uses
 * CLASSIFICATION_POLL_SCHEDULE's tightening cadence rather than a flat interval — see its comment. */
async function pollClassificationToTerminal(
  ctx: ActionContext,
  projectKey: string,
  taskKey: string,
  cookie: string,
  timeoutSeconds: number
): Promise<{ finalStatus: string | undefined; timedOut: boolean }> {
  const { value: finalStatus, timedOut } = await pollWithSchedule(
    async () => {
      const json = await fetchLatestClassificationJson(ctx, projectKey, taskKey, cookie);
      const status = json?.status as string | undefined;
      const stillRunning = !status || CLASSIFICATION_RUNNING_STATUSES.includes(status);
      return { done: !stillRunning, value: status };
    },
    CLASSIFICATION_POLL_SCHEDULE,
    timeoutSeconds
  );
  return { finalStatus, timedOut };
}

/** Must use the task's own full branchPath here (matches terminologyServerService.js's
 * getClassifications(branchPath)), not deriveBranchRoot's stripped-down project/codesystem root —
 * that variant (getClassificationsForBranchRoot) lists every classification ever run anywhere on
 * that root, so it was silently returning an unrelated, possibly months-old job. */
async function fetchClassificationDetails(branchPath: string, jobId: string, cookie: string): Promise<unknown> {
  const classificationsUrl = `${terminologyServerEndpoint()}/${branchPath}/classifications`;
  const classificationsResult = await requestJson<{ items?: Array<{ id?: string }> }>(classificationsUrl, { cookie });
  if (!classificationsResult.body?.items?.length) {
    return undefined;
  }
  return (
    classificationsResult.body.items.find((item) => item.id === jobId) ??
    classificationsResult.body.items[classificationsResult.body.items.length - 1]
  );
}

export type ClassificationStatusInput = TaskContextInput;

/** Read-only equivalent of pollClassificationStatusInVsCode()'s single check — no start, no
 * accept, just today's latestClassificationJson. Safe to call anytime, including while classify
 * is (or might be) already running elsewhere, since it never touches the start/save endpoints. */
export async function classificationStatus(ctx: ActionContext, input: ClassificationStatusInput): Promise<ActionResult> {
  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }
  const { projectKey, taskKey } = taskContext;

  const cookie = await getCookie(ctx);
  const latestClassificationJson = await fetchLatestClassificationJson(ctx, projectKey, taskKey, cookie);

  if (!latestClassificationJson) {
    return { statusCode: 200, body: { hasClassification: false } };
  }
  return {
    statusCode: 200,
    body: {
      hasClassification: true,
      jobId: latestClassificationJson.id,
      status: latestClassificationJson.status,
      running: CLASSIFICATION_RUNNING_STATUSES.includes(latestClassificationJson.status as string),
      latestClassificationJson,
    },
  };
}

export interface ClassifyInput extends TaskContextInput {
  wait?: boolean;
  timeoutSeconds?: number;
}

/**
 * Headless classify is self-healing rather than fire-and-forget-only: before ever starting a new
 * job, it checks the task's *current* classification state (the same read classificationStatus
 * exposes) and reacts to what's actually there, instead of always POSTing a fresh start —
 * discovered the hard way when a plain `classify` call, run while an earlier job had already
 * completed but not been saved, silently kicked off a second, redundant ELK run rather than
 * accepting the one that was already done.
 *
 * - Already RUNNING/BUILDING/SCHEDULED/QUEUED elsewhere → attach to that job and wait for it
 *   (never start a second one; starting while one is genuinely running gets rejected by
 *   authoring-services anyway, but a completed-but-unsaved job does NOT block a new start, which
 *   is exactly how the redundant run above happened). This poll runs regardless of this call's own
 *   `wait` flag — finding an unresolved job in progress means the branch needs it resolved, not a
 *   fire-and-forget response about a *different*, about-to-be-started job.
 * - Already COMPLETED but not yet saved → skip starting entirely; accept it immediately (mirrors
 *   the "CLI is headless, no human to click Accept" rationale below, just reached without wasting
 *   a second run first).
 * - SAVED, STALE, SAVE_FAILED, or no prior job at all → nothing pending; start a new job exactly
 *   as before (fire-and-forget unless `wait` is set).
 */
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
  const timeoutSeconds = input.timeoutSeconds ?? CLASSIFICATION_DEFAULT_TIMEOUT_SECONDS;

  const existing = await fetchLatestClassificationJson(ctx, projectKey, taskKey, cookie);
  const existingStatus = existing?.status as string | undefined;
  const existingJobId = existing?.id as string | undefined;

  if (existingJobId && existingStatus && CLASSIFICATION_RUNNING_STATUSES.includes(existingStatus)) {
    ctx.outputChannel.appendLine(
      `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: found job ${existingJobId} already ${existingStatus} — waiting on it instead of starting a new one`
    );
    const { finalStatus, timedOut } = await pollClassificationToTerminal(ctx, projectKey, taskKey, cookie, timeoutSeconds);
    const details = await fetchClassificationDetails(branchPath, existingJobId, cookie);
    let save: { accepted: boolean; status?: string; error?: string } = { accepted: false };
    if (!timedOut && finalStatus === 'COMPLETED') {
      save = await acceptClassification(cookie, branchPath, projectKey, taskKey, existingJobId);
    }
    ctx.outputChannel.appendLine(
      `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: attached job ${existingJobId} final status ${finalStatus ?? 'unknown'}${timedOut ? ' (timed out waiting)' : ''}, save ${JSON.stringify(save)}`
    );
    return { statusCode: 200, body: { jobId: existingJobId, finalStatus, timedOut, details, save, attachedToExisting: true } };
  }

  if (existingJobId && existingStatus === 'COMPLETED') {
    ctx.outputChannel.appendLine(
      `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: found job ${existingJobId} already COMPLETED and unsaved — accepting it instead of starting a new run`
    );
    const details = await fetchClassificationDetails(branchPath, existingJobId, cookie);
    const save = await acceptClassification(cookie, branchPath, projectKey, taskKey, existingJobId);
    ctx.outputChannel.appendLine(`[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: accepted existing job ${existingJobId}, save ${JSON.stringify(save)}`);
    return { statusCode: 200, body: { jobId: existingJobId, finalStatus: 'COMPLETED', timedOut: false, details, save, acceptedExisting: true } };
  }

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

  const jobId = startResult.body.id;

  if (!input.wait) {
    return { statusCode: 200, body: { jobId, status: startResult.body.status } };
  }

  const { finalStatus, timedOut } = await pollClassificationToTerminal(ctx, projectKey, taskKey, cookie, timeoutSeconds);
  const details = await fetchClassificationDetails(branchPath, jobId, cookie);

  // The CLI is headless — there's no human to click "Accept Classification Results" in the
  // Authoring Workbench, so a completed job auto-saves here (mirrors classification.js's
  // scope.saveClassification(), the handler behind that button).
  let save: { accepted: boolean; status?: string; error?: string } = { accepted: false };
  if (!timedOut && finalStatus === 'COMPLETED') {
    save = await acceptClassification(cookie, branchPath, projectKey, taskKey, jobId);
  }

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] classify ${projectKey}/${taskKey}: final status ${finalStatus ?? 'unknown'}${timedOut ? ' (timed out waiting)' : ''}, save ${JSON.stringify(save)}`
  );

  return { statusCode: 200, body: { jobId, finalStatus, timedOut, details, save } };
}

const SAVE_TERMINAL_STATUSES = ['SAVED', 'STALE', 'SAVE_FAILED'];
const SAVE_TIMEOUT_SECONDS = 120;

/** Mirrors classification.js's scope.saveClassification()/startSavingClassificationPolling():
 * PUT {status:"SAVED"} to the job, then poll the task-scoped classification resource (same one
 * getClassificationForTask reads) until it lands on SAVED/STALE/SAVE_FAILED. */
async function acceptClassification(
  cookie: string,
  branchPath: string,
  projectKey: string,
  taskKey: string,
  jobId: string
): Promise<{ accepted: boolean; status?: string; error?: string }> {
  const saveUrl = `${terminologyServerEndpoint()}/${branchPath}/classifications/${jobId}`;
  const saveStart = await requestJson(saveUrl, { method: 'PUT', body: { status: 'SAVED' }, cookie });

  if (saveStart.statusCode === 400) {
    return { accepted: false, error: 'Report stale — re-classify and save.' };
  }
  if (saveStart.statusCode < 200 || saveStart.statusCode >= 300) {
    return { accepted: false, error: `Failed to save classification (HTTP ${saveStart.statusCode}).` };
  }

  const branchRoot = deriveBranchRoot(branchPath);
  const statusUrl = `${terminologyServerEndpoint()}/browser/${branchRoot}/${projectKey}/${taskKey}/classifications/${jobId}`;
  const maxAttempts = Math.ceil((SAVE_TIMEOUT_SECONDS * 1000) / POLL_INTERVAL_MS);

  const { value: status, timedOut } = await pollUntil(
    async () => {
      const result = await requestJson<{ status?: string }>(statusUrl, { cookie });
      const status = result.body?.status;
      return { done: !!status && SAVE_TERMINAL_STATUSES.includes(status), value: status };
    },
    POLL_INTERVAL_MS,
    maxAttempts
  );

  if (timedOut) {
    return { accepted: false, status, error: 'Timed out waiting for classification results to save.' };
  }
  if (status === 'SAVED') {
    return { accepted: true, status };
  }
  return {
    accepted: false,
    status,
    error: status === 'STALE' ? 'Report stale — re-classify and save.' : 'Saving classification failed.',
  };
}

export type ValidationStatusInput = TaskContextInput;

/** Read-only check of the task's current validation status — no start, just today's
 * `latestValidationStatus`. Unlike classificationStatus(), there's no separate cache-evict
 * endpoint for validation in scaService.js, so this is a plain fetchTask() read (see validate()'s
 * own comment on this below). Exists so a caller can check progress on a run that's expected to
 * take ~10 minutes or more without either blocking on `validate-task --wait` or guessing. */
export async function validationStatus(ctx: ActionContext, input: ValidationStatusInput): Promise<ActionResult> {
  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }
  const { projectKey, taskKey } = taskContext;

  const task = await fetchTask(ctx, projectKey, taskKey);
  const status = task?.latestValidationStatus as string | undefined;

  return {
    statusCode: 200,
    body: {
      hasValidation: !!status,
      status,
      running: !!status && VALIDATION_RUNNING_STATUSES.includes(status),
    },
  };
}

export interface ValidateInput extends TaskContextInput {
  enableMrcmValidation?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
}

async function pollValidationToTerminal(
  ctx: ActionContext,
  projectKey: string,
  taskKey: string,
  timeoutSeconds: number
): Promise<{ finalStatus: string | undefined; timedOut: boolean }> {
  // Unlike classification, no cache-evict endpoint exists for validation status in
  // scaService.js — inferred safe to poll directly, but not confirmed against a live server.
  // If this is later found to also read back stale, add an evict call the same way classify does.
  const { value: finalStatus, timedOut } = await pollWithSchedule(
    async () => {
      const task = await fetchTask(ctx, projectKey, taskKey);
      const status = task?.latestValidationStatus;
      const stillRunning = !status || VALIDATION_RUNNING_STATUSES.includes(status);
      return { done: !stillRunning, value: status };
    },
    VALIDATION_POLL_SCHEDULE,
    timeoutSeconds
  );
  return { finalStatus, timedOut };
}

/**
 * Checks the task's current validation status before starting anything — same rationale as
 * classify()'s self-healing check: two validations running concurrently on the same task is pure
 * waste (RVF work against the same branch state, twice), so a call that finds one already
 * `RUNNING`/`QUEUED`/`SCHEDULED` attaches to and waits on it instead of starting a second one.
 * That wait happens regardless of this call's own `wait` flag — finding an unresolved run in
 * progress means it needs resolving, not a fire-and-forget response about a different,
 * about-to-be-started run (mirrors classify()'s identical reasoning for a running classification).
 */
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

  const timeoutSeconds = input.timeoutSeconds ?? VALIDATION_DEFAULT_TIMEOUT_SECONDS;

  const existingTask = await fetchTask(ctx, projectKey, taskKey);
  const existingStatus = existingTask?.latestValidationStatus;
  if (existingStatus && VALIDATION_RUNNING_STATUSES.includes(existingStatus)) {
    ctx.outputChannel.appendLine(
      `[${new Date().toISOString()}] validate ${projectKey}/${taskKey}: validation already ${existingStatus} — waiting on it instead of starting a new one`
    );
    const { finalStatus, timedOut } = await pollValidationToTerminal(ctx, projectKey, taskKey, timeoutSeconds);
    ctx.outputChannel.appendLine(
      `[${new Date().toISOString()}] validate ${projectKey}/${taskKey}: attached run final status ${finalStatus ?? 'unknown'}${timedOut ? ' (timed out waiting)' : ''}`
    );
    return { statusCode: 200, body: { finalStatus, timedOut, attachedToExisting: true } };
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

  const { finalStatus, timedOut } = await pollValidationToTerminal(ctx, projectKey, taskKey, timeoutSeconds);

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] validate ${projectKey}/${taskKey}: final status ${finalStatus ?? 'unknown'}${timedOut ? ' (timed out waiting)' : ''}`
  );

  return { statusCode: 200, body: { finalStatus, timedOut } };
}
