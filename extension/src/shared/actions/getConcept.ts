import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, terminologyServerEndpoint, getCookie } from './taskContext';

export interface GetConceptInput extends TaskContextInput {
  conceptId: string;
}

export async function getConcept(ctx: ActionContext, input: GetConceptInput): Promise<ActionResult> {
  if (!input.conceptId) {
    return { statusCode: 400, body: { error: 'conceptId is required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const cookie = await getCookie(ctx);
  const url = `${terminologyServerEndpoint()}/browser/${taskContext.branchPath}/concepts/${input.conceptId}`;
  const result = await requestJson(url, { cookie });

  if (result.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in via "OntoGraph: Set IMS Session Cookie" or "OntoGraph: Import IMS Cookies from Chrome".' } };
  }

  return { statusCode: result.statusCode, body: result.body };
}
