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

/** The three SNOMED CT case significance values — mirrors conceptEdit.js's
 * toggleCaseSignificance(), which cycles CASE_INSENSITIVE → INITIAL_CHARACTER_CASE_INSENSITIVE →
 * ENTIRE_TERM_CASE_SENSITIVE → CASE_INSENSITIVE. Exactly one applies at a time. */
const CASE_SIGNIFICANCE_VALUES = ['CASE_INSENSITIVE', 'INITIAL_CHARACTER_CASE_INSENSITIVE', 'ENTIRE_TERM_CASE_SENSITIVE'] as const;
type CaseSignificanceValue = (typeof CASE_SIGNIFICANCE_VALUES)[number];

function isCaseSignificanceValue(value: string): value is CaseSignificanceValue {
  return (CASE_SIGNIFICANCE_VALUES as readonly string[]).includes(value);
}

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

export interface UpdateDescriptionInput extends TaskContextInput {
  conceptId: string;
  descriptionId: string;
  term?: string;
  caseSignificance?: string;
}

/** Updates an existing, never-versioned description in place — the same descriptionId is kept,
 * no new description is created. Mirrors conceptEdit.js's updateDescription() for a plain
 * term-only edit (no type/language change passed): that path never creates a new description or
 * reassigns concept.fsn, it just mutates description.term on the existing object. Unlike the
 * real UI — which lets caseSignificance be toggled even on released descriptions via a separate,
 * looser guard — this action blocks ANY edit once effectiveTime is set, since the description
 * must never have been versioned. */
export async function updateDescription(ctx: ActionContext, input: UpdateDescriptionInput): Promise<ActionResult> {
  if (!input.conceptId || !input.descriptionId) {
    return { statusCode: 400, body: { error: 'conceptId and descriptionId are required.' } };
  }
  if (!input.term && !input.caseSignificance) {
    return { statusCode: 400, body: { error: 'At least one of term or caseSignificance must be provided.' } };
  }
  if (input.caseSignificance && !isCaseSignificanceValue(input.caseSignificance)) {
    return { statusCode: 400, body: { error: `caseSignificance must be one of: ${CASE_SIGNIFICANCE_VALUES.join(', ')}.` } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const descriptions = Array.isArray(concept.descriptions) ? (concept.descriptions as Record<string, unknown>[]) : [];
    const description = descriptions.find((d) => d.descriptionId === input.descriptionId);
    if (!description) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no description ${input.descriptionId}.` } };
    }
    if (description.effectiveTime != null) {
      return {
        statusCode: 409,
        body: {
          error: `Description ${input.descriptionId} has effectiveTime ${String(description.effectiveTime)} set (already versioned) — cannot update.`,
        },
      };
    }
    if (input.term) {
      description.term = input.term;
    }
    if (input.caseSignificance) {
      description.caseSignificance = input.caseSignificance;
    }
    return null;
  });
}

export interface SetCaseSignificanceInput extends TaskContextInput {
  conceptId: string;
  descriptionId: string;
  caseSignificance: string;
}

/** Sets a description's caseSignificance to exactly one of the three SNOMED CT values, addressed
 * by descriptionId — a dedicated command (mirroring setDefinitionStatus's own enum validation)
 * rather than relying on updateDescription's looser optional caseSignificance param, so an
 * invalid value gets a clear "must be one of ..." error instead of silently being written.
 * Deliberately has NO effectiveTime/released guard, matching the real UI's
 * toggleCaseSignificance() (`ng-disabled="isStatic || isLockedModule(...) || showInferredRels"`
 * — it omits description.released entirely): case significance may be changed even on an
 * already-versioned description. */
export async function setCaseSignificance(ctx: ActionContext, input: SetCaseSignificanceInput): Promise<ActionResult> {
  if (!input.conceptId || !input.descriptionId || !input.caseSignificance) {
    return { statusCode: 400, body: { error: 'conceptId, descriptionId, and caseSignificance are required.' } };
  }
  if (!isCaseSignificanceValue(input.caseSignificance)) {
    return { statusCode: 400, body: { error: `caseSignificance must be one of: ${CASE_SIGNIFICANCE_VALUES.join(', ')}.` } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const descriptions = Array.isArray(concept.descriptions) ? (concept.descriptions as Record<string, unknown>[]) : [];
    const description = descriptions.find((d) => d.descriptionId === input.descriptionId);
    if (!description) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no description ${input.descriptionId}.` } };
    }
    description.caseSignificance = input.caseSignificance;
    return null;
  });
}

export interface DeleteDescriptionInput extends TaskContextInput {
  conceptId: string;
  descriptionId: string;
}

/** Mirrors conceptEdit.js's removeDescription(): splice the description out of the concept's
 * descriptions array and PUT the whole concept back. Only permitted when the description itself
 * has never been versioned — the UI hides the remove button via `ng-if="!description.effectiveTime
 * && !description.released"`; we enforce the same guard server-side since there's no dedicated
 * description-delete endpoint on Snowstorm. */
export async function deleteDescription(ctx: ActionContext, input: DeleteDescriptionInput): Promise<ActionResult> {
  if (!input.conceptId || !input.descriptionId) {
    return { statusCode: 400, body: { error: 'conceptId and descriptionId are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const descriptions = Array.isArray(concept.descriptions) ? (concept.descriptions as Record<string, unknown>[]) : [];
    const index = descriptions.findIndex((d) => d.descriptionId === input.descriptionId);
    if (index === -1) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no description ${input.descriptionId}.` } };
    }
    if (descriptions[index].effectiveTime != null) {
      return {
        statusCode: 409,
        body: {
          error: `Description ${input.descriptionId} has effectiveTime ${String(descriptions[index].effectiveTime)} set (already versioned) — cannot delete.`,
        },
      };
    }
    descriptions.splice(index, 1);
    concept.descriptions = descriptions;
    return null;
  });
}

export interface UpdateAxiomInput extends TaskContextInput {
  conceptId: string;
  axiomId: string;
  relationships: Record<string, unknown>[];
}

/** Replaces an existing, never-versioned class axiom's relationships wholesale, addressed by
 * axiomId rather than by index (unlike addRelationship, which only appends and is index-based).
 * Mirrors conceptEdit.js's relationship-editing functions (setAxiomRelationshipTargetConcept,
 * updateRelationship, dropAxiomRelationshipGroup, etc.) — all of them mutate axiom.relationships
 * in memory and funnel into the same whole-concept PUT via autoSave(); there is no dedicated
 * per-axiom or per-relationship REST endpoint in Snowstorm's browser API, confirmed by grepping
 * every $http.put/post call in terminologyServerService.js. */
export async function updateAxiom(ctx: ActionContext, input: UpdateAxiomInput): Promise<ActionResult> {
  if (!input.conceptId || !input.axiomId || !Array.isArray(input.relationships)) {
    return { statusCode: 400, body: { error: 'conceptId, axiomId, and relationships (array) are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const axioms = Array.isArray(concept.classAxioms) ? (concept.classAxioms as Record<string, unknown>[]) : [];
    const axiom = axioms.find((a) => a.axiomId === input.axiomId);
    if (!axiom) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no class axiom ${input.axiomId}.` } };
    }
    if (axiom.effectiveTime != null) {
      return {
        statusCode: 409,
        body: { error: `Axiom ${input.axiomId} has effectiveTime ${String(axiom.effectiveTime)} set (already versioned) — cannot update.` },
      };
    }
    axiom.relationships = input.relationships;
    return null;
  });
}

export interface UpdateGciAxiomInput extends TaskContextInput {
  conceptId: string;
  axiomId: string;
  relationships: Record<string, unknown>[];
}

/** Same operation as updateAxiom, applied to gciAxioms instead of classAxioms. Kept as a
 * distinct command (not a shared "component" abstraction) for parity with deleteAxiom/
 * deleteGciAxiom, even though the underlying logic is identical modulo which array is targeted —
 * this mirrors how conceptEdit.js's own relationship-editing functions are parameterized by the
 * axiom object rather than branching on axiom.type. definitionStatus is deliberately NOT exposed
 * here (setDefinitionStatus stays classAxioms-only): the real UI hides the definitionStatus
 * toggle entirely for GCI axioms (axiomTemplate.html gates it on `axiom.type === 'additional'`),
 * since GCIs are always necessary-conditions and have no primitive/fully-defined distinction. */
export async function updateGciAxiom(ctx: ActionContext, input: UpdateGciAxiomInput): Promise<ActionResult> {
  if (!input.conceptId || !input.axiomId || !Array.isArray(input.relationships)) {
    return { statusCode: 400, body: { error: 'conceptId, axiomId, and relationships (array) are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const axioms = Array.isArray(concept.gciAxioms) ? (concept.gciAxioms as Record<string, unknown>[]) : [];
    const axiom = axioms.find((a) => a.axiomId === input.axiomId);
    if (!axiom) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no GCI axiom ${input.axiomId}.` } };
    }
    if (axiom.effectiveTime != null) {
      return {
        statusCode: 409,
        body: { error: `GCI axiom ${input.axiomId} has effectiveTime ${String(axiom.effectiveTime)} set (already versioned) — cannot update.` },
      };
    }
    axiom.relationships = input.relationships;
    return null;
  });
}

export interface DeleteAxiomInput extends TaskContextInput {
  conceptId: string;
  axiomId: string;
}

/** Mirrors conceptEdit.js's removeAxiom() for type === axiomType.ADDITIONAL: splice the class
 * axiom out and PUT the concept back, guarded by the same two rules the UI enforces — the axiom
 * must never have been versioned, and a concept must always retain at least one class axiom
 * (the UI blocks removal via `scope.concept.classAxioms.length < 2`). GCI axioms have no such
 * minimum — see deleteGciAxiom, which is a distinct command precisely because that rule differs. */
export async function deleteAxiom(ctx: ActionContext, input: DeleteAxiomInput): Promise<ActionResult> {
  if (!input.conceptId || !input.axiomId) {
    return { statusCode: 400, body: { error: 'conceptId and axiomId are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const axioms = Array.isArray(concept.classAxioms) ? (concept.classAxioms as Record<string, unknown>[]) : [];
    const index = axioms.findIndex((a) => a.axiomId === input.axiomId);
    if (index === -1) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no class axiom ${input.axiomId}.` } };
    }
    if (axioms.length < 2) {
      return { statusCode: 409, body: { error: `Concept ${input.conceptId} has only one class axiom — a concept must retain at least one.` } };
    }
    if (axioms[index].effectiveTime != null) {
      return {
        statusCode: 409,
        body: {
          error: `Axiom ${input.axiomId} has effectiveTime ${String(axioms[index].effectiveTime)} set (already versioned) — cannot delete.`,
        },
      };
    }
    axioms.splice(index, 1);
    concept.classAxioms = axioms;
    return null;
  });
}

export interface DeleteGciAxiomInput extends TaskContextInput {
  conceptId: string;
  axiomId: string;
}

/** Mirrors conceptEdit.js's removeAxiom() for type === axiomType.GCI: splice the GCI axiom out
 * and PUT the concept back. Unlike deleteAxiom, there is no minimum-count rule — GCI axioms are
 * optional, so the only guard is that the targeted axiom must never have been versioned. */
export async function deleteGciAxiom(ctx: ActionContext, input: DeleteGciAxiomInput): Promise<ActionResult> {
  if (!input.conceptId || !input.axiomId) {
    return { statusCode: 400, body: { error: 'conceptId and axiomId are required.' } };
  }

  const taskContext = await resolveTaskContext(ctx, input);
  if (!taskContext.ok) {
    return { statusCode: 400, body: { error: taskContext.error } };
  }

  return fetchAndUpdateConcept(ctx, taskContext, input.conceptId, (concept) => {
    const axioms = Array.isArray(concept.gciAxioms) ? (concept.gciAxioms as Record<string, unknown>[]) : [];
    const index = axioms.findIndex((a) => a.axiomId === input.axiomId);
    if (index === -1) {
      return { statusCode: 404, body: { error: `Concept ${input.conceptId} has no GCI axiom ${input.axiomId}.` } };
    }
    if (axioms[index].effectiveTime != null) {
      return {
        statusCode: 409,
        body: {
          error: `GCI axiom ${input.axiomId} has effectiveTime ${String(axioms[index].effectiveTime)} set (already versioned) — cannot delete.`,
        },
      };
    }
    axioms.splice(index, 1);
    concept.gciAxioms = axioms;
    return null;
  });
}
