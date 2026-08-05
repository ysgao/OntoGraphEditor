import * as crypto from 'crypto';
import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import {
  resolveTaskContext,
  resolveDefaultModuleId,
  resolveDialectMetadata,
  deriveBranchRoot,
  terminologyServerEndpoint,
  getCookie,
} from './taskContext';
import { broadcastValidationResults } from './validationBroadcast';
import { DialectMetadata, buildAcceptabilityMap, buildFsnAcceptabilityMap } from './dialectMetadata';

const ISA_TYPE_ID = '116680003';

export interface CreateConceptBody extends TaskContextInput {
  fsn: string;
  semanticTag?: string;
  preferredTerm?: string;
  parentConceptId: string;
  moduleId?: string;
}

/**
 * Builds a new description's acceptabilityMap from the project's real dialect metadata (see
 * dialectMetadata.ts), mirroring componentAuthoringUtil.js's getNewFsn()/getNewPt()/
 * getNewDescription(). `initial` matches the real functions' own `initial` parameter — true for
 * a brand-new concept's FSN+PT (getNewConcept() always passes initial=true), false for a
 * description added to an already-existing concept.
 */
export function makeDescription(
  type: 'FSN' | 'SYNONYM',
  term: string,
  moduleId: string,
  dialectMeta: DialectMetadata,
  acceptability: 'PREFERRED' | 'ACCEPTABLE' = 'PREFERRED',
  initial = false
) {
  const acceptabilityMap =
    type === 'FSN' ? buildFsnAcceptabilityMap(dialectMeta, initial) : buildAcceptabilityMap(dialectMeta, acceptability, initial, 'en');
  return {
    active: true,
    moduleId,
    type,
    term,
    lang: 'en',
    caseSignificance: 'CASE_INSENSITIVE',
    acceptabilityMap,
  };
}

export async function createConcept(ctx: ActionContext, input: CreateConceptBody): Promise<ActionResult> {
  if (!input.fsn || !input.parentConceptId) {
    return { statusCode: 400, body: { error: 'fsn and parentConceptId are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }
  const { projectKey, taskKey, branchPath } = taskContext;

  const branchRoot = deriveBranchRoot(branchPath);
  const cookie = await getCookie(ctx);
  const moduleId = input.moduleId || (await resolveDefaultModuleId(ctx, projectKey));
  const dialectMeta = await resolveDialectMetadata(ctx, projectKey);
  const preferredTerm = input.preferredTerm || input.fsn;
  const fsnTerm = input.semanticTag ? `${input.fsn} (${input.semanticTag})` : input.fsn;

  const payload = {
    conceptId: null,
    moduleId,
    definitionStatus: 'PRIMITIVE',
    active: true,
    descriptions: [
      makeDescription('FSN', fsnTerm, moduleId, dialectMeta, 'PREFERRED', true),
      makeDescription('SYNONYM', preferredTerm, moduleId, dialectMeta, 'PREFERRED', true),
    ],
    relationships: [] as unknown[],
    classAxioms: [
      {
        axiomId: crypto.randomUUID(),
        definitionStatus: 'PRIMITIVE',
        effectiveTime: null,
        active: true,
        released: false,
        moduleId,
        relationships: [
          {
            active: true,
            groupId: 0,
            type: { conceptId: ISA_TYPE_ID },
            target: { conceptId: input.parentConceptId },
          },
        ],
      },
    ],
  };

  const url = `${terminologyServerEndpoint()}/browser/${branchRoot}/${projectKey}/${taskKey}/concepts/?validate=true`;
  const result = await requestJson(url, { method: 'POST', body: payload, cookie });

  if (result.sessionExpired) {
    const msg = 'IMS session expired — re-sign in via "OntoGraph: Set IMS Session Cookie" or "OntoGraph: Import IMS Cookies from Chrome".';
    ctx.outputChannel.appendLine(`[${new Date().toISOString()}] create-concept ${projectKey}/${taskKey}: SESSION EXPIRED`);
    return { statusCode: 401, body: { error: msg } };
  }

  const resultBody = result.body as Record<string, unknown> | null;
  const created = resultBody && 'conceptId' in resultBody ? resultBody.conceptId : undefined;
  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] create-concept ${projectKey}/${taskKey}: ` +
      `${result.statusCode < 300 ? 'OK' : 'FAILED (' + result.statusCode + ')'} — ${fsnTerm}` +
      (created ? ` → ${created}` : '')
  );

  if (typeof created === 'string') {
    broadcastValidationResults(created, resultBody?.validationResults);
  }

  return { statusCode: result.statusCode, body: result.body };
}
