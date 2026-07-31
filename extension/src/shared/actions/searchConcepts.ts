import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, terminologyServerEndpoint, getCookie } from './taskContext';

export interface SearchConceptsInput extends TaskContextInput {
  term?: string;
  ecl?: string;
  active?: boolean;
  limit?: number;
}

interface SnowstormSearchItem {
  conceptId: string;
  fsn?: { term?: string };
  pt?: { term?: string };
  active?: boolean;
  moduleId?: string;
}

interface SnowstormSearchResponse {
  items?: SnowstormSearchItem[];
  total?: number;
}

export async function searchConcepts(ctx: ActionContext, input: SearchConceptsInput): Promise<ActionResult> {
  if (!input.term && !input.ecl) {
    return { statusCode: 400, body: { error: 'term or ecl is required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const cookie = await getCookie(ctx);
  const body: Record<string, unknown> = { limit: input.limit ?? 50, expand: 'fsn()' };
  if (input.term) {
    body.termFilter = input.term;
  }
  if (input.ecl) {
    body.eclFilter = input.ecl;
  }
  if (typeof input.active === 'boolean') {
    body.activeFilter = input.active;
  }

  // Note: no browser/ prefix here — Snowstorm's concept search endpoint is on the bare branch
  // path, unlike create/update/get which go through browser/{branchRoot}/{project}/{task}/...
  const url = `${terminologyServerEndpoint()}/${taskContext.branchPath}/concepts/search`;
  const result = await requestJson<SnowstormSearchResponse>(url, { method: 'POST', body, cookie });

  if (result.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in via "OntoGraph: Set IMS Session Cookie" or "OntoGraph: Import IMS Cookies from Chrome".' } };
  }

  const items = (result.body?.items ?? []).map((item) => ({
    conceptId: item.conceptId,
    fsn: item.fsn?.term,
    pt: item.pt?.term,
    active: item.active,
    moduleId: item.moduleId,
  }));

  return { statusCode: result.statusCode, body: { total: result.body?.total ?? items.length, items } };
}
