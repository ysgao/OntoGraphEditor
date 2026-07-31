import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import { resolveTaskContext, terminologyServerEndpoint, traceabilityServiceEndpoint, getCookie } from './taskContext';

export type ReviewConceptsInput = TaskContextInput;

interface ComponentChange {
  componentSubType?: string;
  [key: string]: unknown;
}

interface TraceabilityConceptChange {
  conceptId: string | number;
  componentChanges?: ComponentChange[];
}

interface TraceabilityActivity {
  activityType?: string;
  commitDate?: string;
  conceptChanges?: TraceabilityConceptChange[];
}

interface TraceabilityResponse {
  content?: TraceabilityActivity[];
}

interface BulkLoadConceptItem {
  conceptId: string;
  fsn?: { term?: string };
  pt?: { term?: string };
}

interface ReviewConceptAccumulator {
  conceptId: string;
  lastUpdatedTime?: string;
  componentSubTypes: Set<string>;
}

async function bulkFetchTerms(branchPath: string, conceptIds: string[], cookie: string): Promise<Map<string, { fsn?: string; pt?: string }>> {
  const terms = new Map<string, { fsn?: string; pt?: string }>();
  if (conceptIds.length === 0) {
    return terms;
  }

  const url = `${terminologyServerEndpoint()}/browser/${branchPath}/concepts/bulk-load`;
  const result = await requestJson<BulkLoadConceptItem[]>(url, { method: 'POST', body: { conceptIds }, cookie });
  for (const item of result.body ?? []) {
    terms.set(item.conceptId, { fsn: item.fsn?.term, pt: item.pt?.term });
  }
  return terms;
}

/**
 * Mirrors apps/authoring-ui-vscode's reviewService.js's getLatestReview(): buckets the task
 * branch's authoring-traceability-service commit log into concepts with stated (non-inferred)
 * changes awaiting review vs. concepts only affected by classification (inferred relationships),
 * excluding any concept that also has a stated change from the classified-only bucket. This is
 * NOT Snowstorm's /reviews branch-diff API — that endpoint is dead code in the Angular app (no
 * call sites); the real "Concepts for Review" tab has always been traceability-log-derived.
 */
export async function reviewConcepts(ctx: ActionContext, input: ReviewConceptsInput): Promise<ActionResult> {
  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const cookie = await getCookie(ctx);
  const url = `${traceabilityServiceEndpoint()}/activities?size=500&onBranch=${encodeURIComponent(taskContext.branchPath)}`;
  const result = await requestJson<TraceabilityResponse>(url, { cookie });

  if (result.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in via "OntoGraph: Set IMS Session Cookie" or "OntoGraph: Import IMS Cookies from Chrome".' } };
  }
  if (result.statusCode === 404) {
    return { statusCode: 200, body: { branchPath: taskContext.branchPath, concepts: [], conceptsClassified: [] } };
  }
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return { statusCode: result.statusCode, body: { error: 'Could not fetch traceability for branch.', details: result.body } };
  }

  const concepts = new Map<string, ReviewConceptAccumulator>();
  const conceptsClassified = new Map<string, ReviewConceptAccumulator>();

  const record = (map: Map<string, ReviewConceptAccumulator>, conceptId: string, commitDate: string | undefined, subTypes: (string | undefined)[]) => {
    const existing = map.get(conceptId);
    if (existing) {
      subTypes.forEach((t) => t && existing.componentSubTypes.add(t));
      existing.lastUpdatedTime = commitDate;
    } else {
      map.set(conceptId, { conceptId, lastUpdatedTime: commitDate, componentSubTypes: new Set(subTypes.filter((t): t is string => !!t)) });
    }
  };

  for (const change of result.body?.content ?? []) {
    if (change.activityType !== 'CONTENT_CHANGE' && change.activityType !== 'CLASSIFICATION_SAVE') {
      continue;
    }
    for (const conceptChange of change.conceptChanges ?? []) {
      const conceptId = String(conceptChange.conceptId);
      const componentChanges = conceptChange.componentChanges ?? [];
      const subTypes = componentChanges.map((c) => c.componentSubType);

      if (change.activityType === 'CLASSIFICATION_SAVE') {
        record(conceptsClassified, conceptId, change.commitDate, subTypes);
        continue;
      }

      const hasStatedChange = componentChanges.some((c) => c.componentSubType !== 'INFERRED_RELATIONSHIP');
      record(hasStatedChange ? concepts : conceptsClassified, conceptId, change.commitDate, subTypes);
    }
  }

  // Exclude stated edits from the classified/inferred bucket (reviewService.js's "Exclude stated edits from Inferred tab").
  for (const conceptId of concepts.keys()) {
    conceptsClassified.delete(conceptId);
  }

  const allIds = [...new Set([...concepts.keys(), ...conceptsClassified.keys()])];
  const terms = await bulkFetchTerms(taskContext.branchPath, allIds, cookie);

  const toList = (map: Map<string, ReviewConceptAccumulator>) =>
    [...map.values()]
      .sort((a, b) => (b.lastUpdatedTime ?? '').localeCompare(a.lastUpdatedTime ?? ''))
      .map((c) => ({
        conceptId: c.conceptId,
        fsn: terms.get(c.conceptId)?.fsn,
        pt: terms.get(c.conceptId)?.pt,
        lastUpdatedTime: c.lastUpdatedTime,
        changedComponentTypes: [...c.componentSubTypes],
      }));

  return {
    statusCode: 200,
    body: {
      branchPath: taskContext.branchPath,
      concepts: toList(concepts),
      conceptsClassified: toList(conceptsClassified),
    },
  };
}
