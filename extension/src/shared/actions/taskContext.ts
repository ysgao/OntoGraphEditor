import * as vscode from 'vscode';
import { requestJson } from '../httpJson';
import { getSessionState } from '../sessionState';
import type { ActionContext, ProjectMetadata, TaskContextInput } from './types';
import { DialectMetadata, parseDialectMetadata } from './dialectMetadata';

export const DEFAULT_MODULE_ID = '900000000000207008';
export const DEFAULT_TERMINOLOGY_SERVER_ENDPOINT = 'https://uat-snowstorm.ihtsdotools.org/snowstorm/snomed-ct/';
export const DEFAULT_AUTHORING_SERVICES_ENDPOINT = 'https://uat-snowstorm.ihtsdotools.org/authoring-services/';

export type TaskContextResult =
  | { ok: true; projectKey: string; taskKey: string; branchPath: string }
  | { ok: false; error: string };

export function terminologyServerEndpoint(): string {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  return cfg.get<string>('terminologyServerEndpoint', DEFAULT_TERMINOLOGY_SERVER_ENDPOINT).replace(/\/$/, '');
}

export function authoringServicesEndpoint(): string {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  return cfg.get<string>('authoringServicesEndpoint', DEFAULT_AUTHORING_SERVICES_ENDPOINT).replace(/\/$/, '');
}

/** Sibling microservice of authoring-services (same host, see authoringPanel.ts's
 * SIBLING_ENDPOINTS) — mirrors terminologyServerService.js's traceabilityEndpoint. */
export function traceabilityServiceEndpoint(): string {
  return `${new URL(authoringServicesEndpoint()).origin}/authoring-traceability-service`;
}

export async function getCookie(ctx: ActionContext): Promise<string> {
  return (await ctx.vscodeContext.secrets.get('imsSessionCookie')) ?? '';
}

export function deriveBranchRoot(branchPath: string): string {
  const segments = branchPath.split('/').filter(Boolean);
  return segments.slice(0, -2).join('/');
}

/** Resolves projectKey/taskKey/branchPath from explicit input, falling back to the currently
 * open task, and fetching branchPath from authoring-services if not already known. */
export async function resolveTaskContext(ctx: ActionContext, input: TaskContextInput): Promise<TaskContextResult> {
  const current = getSessionState().currentTask;
  const projectKey = input.projectKey || current?.projectKey;
  const taskKey = input.taskKey || current?.taskKey;
  // Only trust current.branchPath when NEITHER projectKey nor taskKey was overridden — if either
  // was, current.branchPath belongs to a different (project, task) pair than the one just
  // resolved above, and must be looked up fresh instead of silently reused.
  const usingCurrentTask = !input.projectKey && !input.taskKey;
  let branchPath = input.branchPath || (usingCurrentTask ? current?.branchPath : undefined);

  if (!projectKey || !taskKey) {
    return { ok: false, error: 'No task context: open a task in OntoGraph Editor, or pass projectKey/taskKey explicitly.' };
  }

  if (!branchPath) {
    branchPath = (await resolveBranchPath(ctx, projectKey, taskKey)) ?? undefined;
  }
  if (!branchPath) {
    return { ok: false, error: `Could not resolve branch path for ${projectKey}/${taskKey}.` };
  }

  return { ok: true, projectKey, taskKey, branchPath };
}

export async function resolveBranchPath(ctx: ActionContext, projectKey: string, taskKey: string): Promise<string | null> {
  const cookie = await getCookie(ctx);
  const url = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}`;
  const result = await requestJson<{ branchPath?: string }>(url, { cookie });
  return result.body?.branchPath ?? null;
}

/**
 * Fetches (and caches, per projectKey) the raw `metadata` object from authoring-services'
 * `GET /projects/{projectKey}` — the single source both resolveDefaultModuleId() and
 * dialectMetadata.ts's resolveDialectMetadata() derive from, mirroring how the real app's
 * project.js/edit.js pass the same `$scope.project.metadata` to both getCurrentModuleId()'s
 * callers and metadataService.setExtensionMetadata().
 */
export async function fetchProjectMetadata(ctx: ActionContext, projectKey: string): Promise<ProjectMetadata> {
  const cached = ctx.projectMetadataCache.get(projectKey);
  if (cached) {
    return cached;
  }

  const cookie = await getCookie(ctx);
  const url = `${authoringServicesEndpoint()}/projects/${projectKey}`;
  const result = await requestJson<{ metadata?: ProjectMetadata }>(url, { cookie });
  const metadata = result.body?.metadata ?? {};

  ctx.projectMetadataCache.set(projectKey, metadata);
  return metadata;
}

/**
 * Mirrors apps/authoring-ui-vscode's metadataService.js getCurrentModuleId(): an extension
 * project must use its own module, not the international core module — Snowstorm's
 * classifier/MRCM checks choke on module-mismatched content on an extension branch.
 */
export async function resolveDefaultModuleId(ctx: ActionContext, projectKey: string): Promise<string> {
  const metadata = await fetchProjectMetadata(ctx, projectKey);

  const disabledRaw = metadata.multipleModuleEditingDisabled;
  const notDisabled = !disabledRaw || disabledRaw === 'false';
  if (metadata.expectedExtensionModules?.length && notDisabled) {
    return metadata.expectedExtensionModules[0];
  }
  if (metadata.defaultModuleId) {
    return metadata.defaultModuleId;
  }
  return DEFAULT_MODULE_ID;
}

/** Fetches the project's metadata (shared cache with resolveDefaultModuleId, via
 * fetchProjectMetadata above) and parses it into dialect/acceptability defaults — see
 * dialectMetadata.ts's parseDialectMetadata() for the parsing itself. */
export async function resolveDialectMetadata(ctx: ActionContext, projectKey: string): Promise<DialectMetadata> {
  const metadata = await fetchProjectMetadata(ctx, projectKey);
  return parseDialectMetadata(metadata);
}
