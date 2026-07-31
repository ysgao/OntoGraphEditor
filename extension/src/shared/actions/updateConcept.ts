import { requestJson } from '../httpJson';
import type { ActionContext, ActionResult, TaskContextInput } from './types';
import {
  resolveTaskContext,
  resolveDefaultModuleId,
  deriveBranchRoot,
  terminologyServerEndpoint,
  getCookie,
  TaskContextResult,
} from './taskContext';
import { makeDescription } from './createConcept';

/**
 * Mirrors terminologyServerService.js's cleanConcept()/cleanDescription()/cleanRelationship()/
 * cleanAxiom() allow-lists exactly, applied recursively — not just top-level. getConcept's GET
 * response is documented as already "save-ready," but the real app still re-cleans on every
 * save regardless, so we do too rather than trusting that documentation blindly.
 */
const ALLOWED_CONCEPT_FIELDS = [
  'fsn',
  'released',
  'conceptId',
  'definitionStatus',
  'active',
  'moduleId',
  'isLeafInferred',
  'effectiveTime',
  'descriptions',
  'annotations',
  'preferredSynonym',
  'relationships',
  'inactivationIndicator',
  'associationTargets',
  'classAxioms',
  'gciAxioms',
];
const ALLOWED_DESCRIPTION_FIELDS = [
  'conceptId',
  'released',
  'active',
  'moduleId',
  'term',
  'lang',
  'caseSignificance',
  'effectiveTime',
  'descriptionId',
  'type',
  'acceptabilityMap',
  'inactivationIndicator',
  'associationTargets',
];
const ALLOWED_RELATIONSHIP_FIELDS = [
  'active',
  'released',
  'moduleId',
  'target',
  'relationshipId',
  'effectiveTime',
  'characteristicType',
  'sourceId',
  'modifier',
  'type',
  'groupId',
  'concreteValue',
];
const ALLOWED_RELATIONSHIP_REF_FIELDS = ['conceptId', 'fsn', 'pt', 'active', 'definitionStatus', 'effectiveTime', 'moduleId', 'released'];
const ALLOWED_AXIOM_FIELDS = ['axiomId', 'definitionStatus', 'effectiveTime', 'active', 'released', 'moduleId', 'relationships'];

function pick(obj: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in obj) {
      cleaned[key] = obj[key];
    }
  }
  return cleaned;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanRelationshipRef(ref: unknown): unknown {
  return isObject(ref) ? pick(ref, ALLOWED_RELATIONSHIP_REF_FIELDS) : ref;
}

function cleanRelationship(rel: unknown): unknown {
  if (!isObject(rel)) {
    return rel;
  }
  const cleaned = pick(rel, ALLOWED_RELATIONSHIP_FIELDS);
  if ('type' in cleaned) {
    cleaned.type = cleanRelationshipRef(cleaned.type);
  }
  if ('target' in cleaned) {
    cleaned.target = cleanRelationshipRef(cleaned.target);
  }
  return cleaned;
}

function cleanDescription(desc: unknown): unknown {
  return isObject(desc) ? pick(desc, ALLOWED_DESCRIPTION_FIELDS) : desc;
}

function cleanAxiom(axiom: unknown): unknown {
  if (!isObject(axiom)) {
    return axiom;
  }
  const cleaned = pick(axiom, ALLOWED_AXIOM_FIELDS);
  if (Array.isArray(cleaned.relationships)) {
    cleaned.relationships = cleaned.relationships.map(cleanRelationship);
  }
  return cleaned;
}

function cleanConceptForUpdate(concept: Record<string, unknown>): Record<string, unknown> {
  const cleaned = pick(concept, ALLOWED_CONCEPT_FIELDS);
  if (Array.isArray(cleaned.descriptions)) {
    cleaned.descriptions = cleaned.descriptions.map(cleanDescription);
  }
  if (Array.isArray(cleaned.relationships)) {
    cleaned.relationships = cleaned.relationships.map(cleanRelationship);
  }
  if (Array.isArray(cleaned.classAxioms)) {
    cleaned.classAxioms = cleaned.classAxioms.map(cleanAxiom);
  }
  if (Array.isArray(cleaned.gciAxioms)) {
    cleaned.gciAxioms = cleaned.gciAxioms.map(cleanAxiom);
  }
  return cleaned;
}

type ResolvedTaskContext = Extract<TaskContextResult, { ok: true }>;

/** GET the current full concept, apply `mutate` in memory, PUT the whole thing back —
 * updateConcept has no delta/patch semantics, it's always a full-object replace. */
async function fetchAndUpdateConcept(
  ctx: ActionContext,
  taskContext: ResolvedTaskContext,
  conceptId: string,
  mutate: (concept: Record<string, unknown>) => ActionResult | null
): Promise<ActionResult> {
  const cookie = await getCookie(ctx);
  const tsEndpoint = terminologyServerEndpoint();
  const getUrl = `${tsEndpoint}/browser/${taskContext.branchPath}/concepts/${conceptId}`;
  const getResult = await requestJson<Record<string, unknown>>(getUrl, { cookie });

  if (getResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }
  if (getResult.statusCode < 200 || getResult.statusCode >= 300 || !getResult.body) {
    return { statusCode: getResult.statusCode || 404, body: { error: `Could not fetch concept ${conceptId}.`, details: getResult.body } };
  }

  const concept = getResult.body;
  const mutateError = mutate(concept);
  if (mutateError) {
    return mutateError;
  }

  const branchRoot = deriveBranchRoot(taskContext.branchPath);
  const putUrl = `${tsEndpoint}/browser/${branchRoot}/${taskContext.projectKey}/${taskContext.taskKey}/concepts/${conceptId}`;
  const putResult = await requestJson(putUrl, { method: 'PUT', body: cleanConceptForUpdate(concept), cookie });

  if (putResult.sessionExpired) {
    return { statusCode: 401, body: { error: 'IMS session expired — re-sign in.' } };
  }

  ctx.outputChannel.appendLine(
    `[${new Date().toISOString()}] update-concept ${taskContext.projectKey}/${taskContext.taskKey}: ` +
      `${putResult.statusCode < 300 ? 'OK' : 'FAILED (' + putResult.statusCode + ')'} — ${conceptId}`
  );

  return { statusCode: putResult.statusCode, body: putResult.body };
}

export interface AddDescriptionInput extends TaskContextInput {
  conceptId: string;
  term: string;
  type: 'FSN' | 'SYNONYM';
  semanticTag?: string;
  moduleId?: string;
}

export async function addDescription(ctx: ActionContext, input: AddDescriptionInput): Promise<ActionResult> {
  if (!input.conceptId || !input.term || !input.type) {
    return { statusCode: 400, body: { error: 'conceptId, term, and type are required.' } };
  }
  if (input.type !== 'FSN' && input.type !== 'SYNONYM') {
    return { statusCode: 400, body: { error: 'type must be FSN or SYNONYM.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const moduleId = input.moduleId || (await resolveDefaultModuleId(ctx, taskContext.projectKey));
  const term = input.type === 'FSN' && input.semanticTag ? `${input.term} (${input.semanticTag})` : input.term;

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const descriptions = Array.isArray(concept.descriptions) ? (concept.descriptions as unknown[]) : [];
    descriptions.push(makeDescription(input.type, term, moduleId));
    concept.descriptions = descriptions;
    return null;
  });
}

export interface AddRelationshipInput extends TaskContextInput {
  conceptId: string;
  typeId: string;
  targetId: string;
  groupId?: number;
  axiomIndex?: number;
}

export async function addRelationship(ctx: ActionContext, input: AddRelationshipInput): Promise<ActionResult> {
  if (!input.conceptId || !input.typeId || !input.targetId) {
    return { statusCode: 400, body: { error: 'conceptId, typeId, and targetId are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const axiomIndex = input.axiomIndex ?? 0;
  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const axioms = Array.isArray(concept.classAxioms) ? (concept.classAxioms as Record<string, unknown>[]) : [];
    const axiom = axioms[axiomIndex];
    if (!axiom) {
      return {
        statusCode: 400,
        body: { error: `Concept ${input.conceptId} has no classAxiom at index ${axiomIndex} (has ${axioms.length}).` },
      };
    }
    const relationships = Array.isArray(axiom.relationships) ? (axiom.relationships as unknown[]) : [];
    relationships.push({
      active: true,
      groupId: input.groupId ?? 0,
      type: { conceptId: input.typeId },
      target: { conceptId: input.targetId },
    });
    axiom.relationships = relationships;
    return null;
  });
}

export interface SetDefinitionStatusInput extends TaskContextInput {
  conceptId: string;
  status: 'PRIMITIVE' | 'FULLY_DEFINED';
  axiomIndex?: number;
}

export async function setDefinitionStatus(ctx: ActionContext, input: SetDefinitionStatusInput): Promise<ActionResult> {
  if (!input.conceptId || !input.status) {
    return { statusCode: 400, body: { error: 'conceptId and status are required.' } };
  }
  if (input.status !== 'PRIMITIVE' && input.status !== 'FULLY_DEFINED') {
    return { statusCode: 400, body: { error: 'status must be PRIMITIVE or FULLY_DEFINED.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  const axiomIndex = input.axiomIndex ?? 0;
  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const axioms = Array.isArray(concept.classAxioms) ? (concept.classAxioms as Record<string, unknown>[]) : [];
    const axiom = axioms[axiomIndex];
    if (!axiom) {
      return {
        statusCode: 400,
        body: { error: `Concept ${input.conceptId} has no classAxiom at index ${axiomIndex} (has ${axioms.length}).` },
      };
    }
    axiom.definitionStatus = input.status;
    concept.definitionStatus = input.status;
    return null;
  });
}

export interface InactivateConceptInput extends TaskContextInput {
  conceptId: string;
  indicator: string;
  associationRefsetId?: string;
  associationTargetId?: string;
}

export async function inactivateConcept(ctx: ActionContext, input: InactivateConceptInput): Promise<ActionResult> {
  if (!input.conceptId || !input.indicator) {
    return { statusCode: 400, body: { error: 'conceptId and indicator are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    concept.active = false;
    concept.inactivationIndicator = input.indicator;
    if (input.associationRefsetId && input.associationTargetId) {
      concept.associationTargets = { [input.associationRefsetId]: [input.associationTargetId] };
    }
    return null;
  });
}
