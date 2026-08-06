function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface RoleGroupAttribute {
  typeId: string;
  targetId: string;
}

export function relationshipAttribute(rel: Record<string, unknown>): RoleGroupAttribute | null {
  const type = rel.type;
  const target = rel.target;
  const typeId = isObject(type) ? type.conceptId : undefined;
  const targetId = isObject(target) ? target.conceptId : undefined;
  return typeof typeId === 'string' && typeof targetId === 'string' ? { typeId, targetId } : null;
}

/** True iff every pair in `needle` is present in `haystack` (order-independent, respecting
 * duplicate counts) — `needle` only has to *identify* the group, not enumerate its full
 * membership. A group with extra relationships beyond what's in `needle` still matches. */
export function attributesAreSubsetOf(needle: RoleGroupAttribute[], haystack: RoleGroupAttribute[]): boolean {
  const remaining = [...haystack];
  for (const pair of needle) {
    const index = remaining.findIndex((r) => r.typeId === pair.typeId && r.targetId === pair.targetId);
    if (index === -1) {
      return false;
    }
    remaining.splice(index, 1);
  }
  return true;
}

export type RoleGroupMatch =
  | { ok: true; groupId: number; relationships: Record<string, unknown>[] }
  | { ok: false; statusCode: number; error: string };

/** Pure matching core of removeRoleGroup (updateConcept.ts): given one axiom's relationships and a
 * caller-supplied set of attribute pairs (plus an optional groupId hint), resolves which single
 * role group they identify — or reports why they don't resolve to exactly one.
 *
 * `attributes` only needs to *identify* the group, not enumerate it: if one pair already occurs in
 * only one role group, that's enough — the whole group is returned, including relationships not
 * mentioned in `attributes`. If the pairs match more than one group, resolution fails with a 409
 * listing every candidate groupId rather than guessing.
 *
 * groupId 0 (SNOMED's ungrouped bucket, which typically also holds the stated Is-a) is excluded
 * from matching unless `groupIdHint` is explicitly 0 — a pair matching an ungrouped relationship
 * should never accidentally resolve to "the ungrouped bucket" and sweep up unrelated ungrouped
 * relationships as collateral damage.
 *
 * Kept dependency-free (no vscode, no network) so this resolution logic is unit-testable without
 * mocking fetchAndUpdateConcept's GET/PUT round trip — see updateConcept.test.ts. */
export function findRoleGroupByAttributes(
  relationships: Record<string, unknown>[],
  attributes: RoleGroupAttribute[],
  groupIdHint?: number
): RoleGroupMatch {
  const groupsByGroupId = new Map<number, Record<string, unknown>[]>();
  for (const rel of relationships) {
    const groupId = typeof rel.groupId === 'number' ? rel.groupId : 0;
    const group = groupsByGroupId.get(groupId);
    if (group) {
      group.push(rel);
    } else {
      groupsByGroupId.set(groupId, [rel]);
    }
  }

  const matchingGroupIds: number[] = [];
  for (const [groupId, groupRelationships] of groupsByGroupId) {
    if (groupIdHint != null ? groupId !== groupIdHint : groupId === 0) {
      continue;
    }
    const pairs = groupRelationships.map(relationshipAttribute).filter((p): p is RoleGroupAttribute => p != null);
    if (attributesAreSubsetOf(attributes, pairs)) {
      matchingGroupIds.push(groupId);
    }
  }

  if (matchingGroupIds.length === 0) {
    return { ok: false, statusCode: 404, error: 'has no role group containing all of the given attributes.' };
  }
  if (matchingGroupIds.length > 1) {
    return {
      ok: false,
      statusCode: 409,
      error:
        `has ${matchingGroupIds.length} role groups matching the given attributes ` +
        `(groupIds: ${matchingGroupIds.join(', ')}) — ambiguous. Add another attribute pair to narrow it down ` +
        `to one group, or pass groupId to target one directly.`,
    };
  }

  const targetGroupId = matchingGroupIds[0];
  return { ok: true, groupId: targetGroupId, relationships: groupsByGroupId.get(targetGroupId)! };
}
