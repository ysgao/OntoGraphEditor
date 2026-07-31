import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, terminologyServerEndpoint, getCookie } from './taskContext';

export interface DeleteConceptInput extends TaskContextInput {
  conceptId: string;
}

/**
 * Deletes a never-versioned concept outright. Unlike the other mutations in updateConcept.ts,
 * this is a real DELETE — not a GET-mutate-PUT — mirroring terminologyServerService.js's
 * deleteConcept(): DELETE against the plain component REST API (no /browser/ prefix) on the
 * raw task branch. Snowstorm cascades removal of the concept's own descriptions/relationships/
 * axioms server-side in that one call.
 */
export async function deleteConcept(ctx: ActionContext, input: DeleteConceptInput): Promise<ActionResult> {
  if (!input.conceptId) {
    return { statusCode: 400, body: { error: 'conceptId is required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const cookie = await getCookie(ctx);
  const tsEndpoint = terminologyServerEndpoint();
  const getUrl = `${tsEndpoint}/browser/${taskContext.branchPath}/concepts/${input.conceptId}`;
  const getResult = await requestJson<Record<string, unknown>>(getUrl, { cookie });

  if (getResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }
  if (getResult.statusCode < 200 || getResult.statusCode >= 300 || !getResult.body) {
    return { statusCode: getResult.statusCode || 404, body: { error: `Could not fetch concept ${input.conceptId}.`, details: getResult.body } };
  }

  if (getResult.body.effectiveTime != null) {
    return {
      statusCode: 409,
      body: {
        error: `Concept ${input.conceptId} has effectiveTime ${String(getResult.body.effectiveTime)} set (already versioned) — cannot delete.`,
      },
    };
  }

  const deleteUrl = `${tsEndpoint}/${taskContext.branchPath}/concepts/${input.conceptId}`;
  const deleteResult = await requestJson(deleteUrl, { method: 'DELETE', cookie });

  if (deleteResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] delete-concept ${taskContext.projectKey}/${taskContext.taskKey}: ` +
      `${deleteResult.statusCode < 300 ? 'OK' : 'FAILED (' + deleteResult.statusCode + ')'} — ${input.conceptId}`
  );

  if (deleteResult.statusCode === 409) {
    return {
      statusCode: 409,
      body: { error: `Cannot delete concept ${input.conceptId} — one or more of its components is published.`, details: deleteResult.body },
    };
  }

  return { statusCode: deleteResult.statusCode, body: deleteResult.body };
}
