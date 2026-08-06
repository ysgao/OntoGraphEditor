import { describe, expect, it } from 'vitest';
import { attributesAreSubsetOf, findRoleGroupByAttributes } from './roleGroupMatch';

const FINDING_SITE = '363698007';
const MORPHOLOGY = '116676008';
const DUE_TO = '42752001';
const IS_A = '116680003';

function rel(groupId: number, typeId: string, targetId: string, extra: Record<string, unknown> = {}) {
  return { groupId, type: { conceptId: typeId }, target: { conceptId: targetId }, ...extra };
}

describe('attributesAreSubsetOf', () => {
  it('matches when needle is a proper subset of haystack', () => {
    expect(attributesAreSubsetOf([{ typeId: FINDING_SITE, targetId: 'X' }], [
      { typeId: FINDING_SITE, targetId: 'X' },
      { typeId: MORPHOLOGY, targetId: 'Y' },
    ])).toBe(true);
  });

  it('does not match when a pair is missing', () => {
    expect(attributesAreSubsetOf([{ typeId: FINDING_SITE, targetId: 'Z' }], [
      { typeId: FINDING_SITE, targetId: 'X' },
    ])).toBe(false);
  });

  it('respects duplicate counts — needle with two copies of a pair needs two in haystack', () => {
    const pair = { typeId: FINDING_SITE, targetId: 'X' };
    expect(attributesAreSubsetOf([pair, pair], [pair])).toBe(false);
    expect(attributesAreSubsetOf([pair, pair], [pair, pair])).toBe(true);
  });

  it('is order-independent', () => {
    expect(attributesAreSubsetOf(
      [{ typeId: MORPHOLOGY, targetId: 'Y' }, { typeId: FINDING_SITE, targetId: 'X' }],
      [{ typeId: FINDING_SITE, targetId: 'X' }, { typeId: MORPHOLOGY, targetId: 'Y' }]
    )).toBe(true);
  });
});

describe('findRoleGroupByAttributes', () => {
  it('resolves a unique single-pair match, returning every relationship in that group, including ones not mentioned', () => {
    const relationships = [
      rel(0, IS_A, 'P'),
      rel(1, FINDING_SITE, 'X'),
      rel(1, MORPHOLOGY, 'Y'),
    ];
    const result = findRoleGroupByAttributes(relationships, [{ typeId: FINDING_SITE, targetId: 'X' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groupId).toBe(1);
      expect(result.relationships).toHaveLength(2);
    }
  });

  it('needs multiple pairs to narrow to one group when a single pair alone is ambiguous', () => {
    const relationships = [
      rel(0, IS_A, 'P'),
      rel(1, FINDING_SITE, 'X'),
      rel(1, MORPHOLOGY, 'Y'),
      rel(2, FINDING_SITE, 'X'),
      rel(2, DUE_TO, 'Z'),
    ];
    const ambiguous = findRoleGroupByAttributes(relationships, [{ typeId: FINDING_SITE, targetId: 'X' }]);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.statusCode).toBe(409);
      expect(ambiguous.error).toContain('groupIds: 1, 2');
    }

    const narrowed = findRoleGroupByAttributes(relationships, [
      { typeId: FINDING_SITE, targetId: 'X' },
      { typeId: MORPHOLOGY, targetId: 'Y' },
    ]);
    expect(narrowed.ok).toBe(true);
    if (narrowed.ok) {
      expect(narrowed.groupId).toBe(1);
    }
  });

  it('lets an explicit groupId hint disambiguate an otherwise-ambiguous match', () => {
    const relationships = [
      rel(1, FINDING_SITE, 'X'),
      rel(2, FINDING_SITE, 'X'),
    ];
    const result = findRoleGroupByAttributes(relationships, [{ typeId: FINDING_SITE, targetId: 'X' }], 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groupId).toBe(2);
    }
  });

  it('returns 404 when no group contains all of the given attributes', () => {
    const relationships = [rel(1, FINDING_SITE, 'X')];
    const result = findRoleGroupByAttributes(relationships, [{ typeId: MORPHOLOGY, targetId: 'Y' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(404);
    }
  });

  it('excludes groupId 0 by default even if the attributes match an ungrouped relationship', () => {
    const relationships = [rel(0, IS_A, 'P'), rel(1, FINDING_SITE, 'X')];
    const result = findRoleGroupByAttributes(relationships, [{ typeId: IS_A, targetId: 'P' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(404);
    }
  });

  it('allows matching groupId 0 when explicitly hinted', () => {
    const relationships = [rel(0, IS_A, 'P'), rel(0, DUE_TO, 'Q'), rel(1, FINDING_SITE, 'X')];
    const result = findRoleGroupByAttributes(relationships, [{ typeId: IS_A, targetId: 'P' }], 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groupId).toBe(0);
      expect(result.relationships).toHaveLength(2);
    }
  });

  it('ignores concreteValue relationships (no target concept) when building attribute pairs, but still includes them in the matched group', () => {
    const relationships = [
      rel(1, FINDING_SITE, 'X'),
      { groupId: 1, type: { conceptId: '732945000' }, concreteValue: { valueWithPrefix: '#5', dataType: 'INTEGER' } },
    ];
    const result = findRoleGroupByAttributes(relationships, [{ typeId: FINDING_SITE, targetId: 'X' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groupId).toBe(1);
      expect(result.relationships).toHaveLength(2);
    }
  });
});
