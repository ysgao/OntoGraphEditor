import { describe, expect, it, vi } from 'vitest';
import { emitNotification, matchesNotification, onNotification, waitForNotification } from './notificationBus';

describe('matchesNotification', () => {
  const match = { entityType: 'Classification', projectKey: 'WRPAS', taskKey: 'WRPAS-98', branchPath: 'MAIN/WRPAS/WRPAS-98' };

  it('rejects a different entityType', () => {
    expect(matchesNotification({ entityType: 'Validation', task: 'WRPAS-98' }, match)).toBe(false);
  });

  it('matches on task+project when a task is present', () => {
    expect(matchesNotification({ entityType: 'Classification', project: 'WRPAS', task: 'WRPAS-98' }, match)).toBe(true);
  });

  it('rejects a task-scoped notification for a different task', () => {
    expect(matchesNotification({ entityType: 'Classification', project: 'WRPAS', task: 'WRPAS-99' }, match)).toBe(false);
  });

  it('falls back to project when no task is present', () => {
    const projectMatch = { ...match, taskKey: '' };
    expect(matchesNotification({ entityType: 'Classification', project: 'WRPAS' }, projectMatch)).toBe(true);
  });

  it('falls back to branchPath when neither task nor project is present', () => {
    const branchMatch = { ...match, taskKey: '', projectKey: '' };
    expect(matchesNotification({ entityType: 'Classification', branchPath: 'MAIN/WRPAS/WRPAS-98' }, branchMatch)).toBe(true);
  });

  it('matches any entityType when omitted from the match', () => {
    const wildcard = { projectKey: 'WRPAS', taskKey: 'WRPAS-98', branchPath: 'MAIN/WRPAS/WRPAS-98' };
    expect(matchesNotification({ entityType: 'Rebase', project: 'WRPAS', task: 'WRPAS-98' }, wildcard)).toBe(true);
    expect(matchesNotification({ entityType: 'Promotion', project: 'WRPAS', task: 'WRPAS-98' }, wildcard)).toBe(true);
  });
});

describe('onNotification / emitNotification', () => {
  it('delivers to all subscribed listeners', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = onNotification(a);
    const unsubB = onNotification(b);
    emitNotification({ entityType: 'Classification' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onNotification(listener);
    unsubscribe();
    emitNotification({ entityType: 'Classification' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores non-object payloads', () => {
    const listener = vi.fn();
    const unsubscribe = onNotification(listener);
    emitNotification('not an object');
    emitNotification(null);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('waitForNotification', () => {
  const match = { entityType: 'Classification', projectKey: 'WRPAS', taskKey: 'WRPAS-98', branchPath: 'MAIN/WRPAS/WRPAS-98' };

  it('resolves with the matching payload once emitted', async () => {
    const handle = waitForNotification(match);
    const payload = { entityType: 'Classification', project: 'WRPAS', task: 'WRPAS-98' };
    emitNotification(payload);
    await expect(handle.promise).resolves.toEqual(payload);
  });

  it('does not resolve for a non-matching notification', async () => {
    const handle = waitForNotification(match);
    let resolved = false;
    handle.promise.then(() => { resolved = true; });
    emitNotification({ entityType: 'Validation', project: 'WRPAS', task: 'WRPAS-98' });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    handle.cancel();
  });

  it('cancel() unsubscribes without resolving', async () => {
    const handle = waitForNotification(match);
    handle.cancel();
    emitNotification({ entityType: 'Classification', project: 'WRPAS', task: 'WRPAS-98' });
    let resolved = false;
    handle.promise.then(() => { resolved = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  it('cancel() after resolution is a harmless no-op', async () => {
    const handle = waitForNotification(match);
    emitNotification({ entityType: 'Classification', project: 'WRPAS', task: 'WRPAS-98' });
    await handle.promise;
    expect(() => handle.cancel()).not.toThrow();
  });
});
