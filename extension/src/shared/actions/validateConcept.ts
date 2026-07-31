import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, deriveBranchRoot, terminologyServerEndpoint, getCookie } from './taskContext';
import { cleanConceptForUpdate } from './updateConcept';

export interface ValidateConceptInput extends TaskContextInput {
  conceptId: string;
}

interface ValidationResultItem {
  componentId?: string;
  conceptId?: string;
  severity?: string;
  message?: string;
}

/** Mirrors the O(n^2) de-dup terminologyServerService.js's validateConcept() applies to the same
 * endpoint's response (its own comment cites Snowstorm bug WRP-2912 as the reason duplicates show
 * up in the first place). */
function dedupe(items: ValidationResultItem[]): ValidationResultItem[] {
  const deduped: ValidationResultItem[] = [];
  for (const item of items) {
    const isDuplicate = deduped.some(
      (seen) =>
        seen.componentId === item.componentId &&
        seen.severity === item.severity &&
        seen.conceptId === item.conceptId &&
        seen.message === item.message
    );
    if (!isDuplicate) {
      deduped.push(item);
    }
  }
  return deduped;
}

/**
 * Runs the same pre-save validation check the interactive editor uses — terminologyServerService.js's
 * validateConcept(), POST browser/{branchRoot}/{projectKey}/{taskKey}/validate/concept — against a
 * concept's CURRENT server-side state, without saving anything. This is the read-only counterpart
 * to the validationResults every write action already surfaces via ?validate=true: a plain GET
 * never triggers validation, and a write action's validationResults only reflect that write's own
 * moment in time, so there was previously no way for a headless caller to see conventions
 * warnings/errors (e.g. "For each active FSN there is a synonym that has the same text") already
 * sitting on a concept that was saved by someone/something else. Deliberately does not broadcast
 * to the webview like the write actions do — a read-only check shouldn't overwrite what a human
 * might currently see reflecting their own unsaved local edits.
 */
export async function validateConcept(ctx: ActionContext, input: ValidateConceptInput): Promise<ActionResult> {
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

  const branchRoot = deriveBranchRoot(taskContext.branchPath);
  const validateUrl = `${tsEndpoint}/browser/${branchRoot}/${taskContext.projectKey}/${taskContext.taskKey}/validate/concept`;
  const validateResult = await requestJson<ValidationResultItem[]>(validateUrl, {
    method: 'POST',
    body: cleanConceptForUpdate(getResult.body),
    cookie,
  });

  if (validateResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }
  if (validateResult.statusCode < 200 || validateResult.statusCode >= 300) {
    return { statusCode: validateResult.statusCode, body: { error: 'Validation check failed.', details: validateResult.body } };
  }

  const items = Array.isArray(validateResult.body) ? dedupe(validateResult.body) : [];
  return {
    statusCode: 200,
    body: {
      conceptId: input.conceptId,
      validationResults: items,
      hasErrors: items.some((item) => item.severity === 'ERROR'),
      hasWarnings: items.some((item) => item.severity === 'WARNING'),
    },
  };
}
