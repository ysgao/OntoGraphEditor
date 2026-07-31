import { requestJson } from '../httpJson';
import type { ActionContext } from './types';
import { authoringServicesEndpoint, getCookie } from './taskContext';

export interface TaskInfo {
  status?: string;
  branchPath?: string;
  latestClassificationJson?: { status?: string; [key: string]: unknown };
  latestValidationStatus?: string;
  [key: string]: unknown;
}

export async function fetchTask(ctx: ActionContext, projectKey: string, taskKey: string): Promise<TaskInfo | null> {
  const cookie = await getCookie(ctx);
  const url = `${authoringServicesEndpoint()}/projects/${projectKey}/tasks/${taskKey}`;
  const result = await requestJson<TaskInfo>(url, { cookie });
  return result.body ?? null;
}
