import { describe, it, expect } from 'vitest';
import { EntityEditHistory } from './EntityEditHistory.js';
import type { EntitySnapshot } from './EntityEditorMessages.js';

function snap(label: string): EntitySnapshot {
  return {
    entityType: 'class',
    iri: 'http://example.org/A',
    label,
    labels: { en: [label] },
    annotations: {},
    displayStyle: 'label',
    iriLabels: {},
    expressionEntityRefs: {},
  };
}

describe('EntityEditHistory – initial state', () => {
  it('starts with canUndo=false', () => {
    expect(new EntityEditHistory(snap('S0')).canUndo).toBe(false);
  });

  it('starts with canRedo=false', () => {
    expect(new EntityEditHistory(snap('S0')).canRedo).toBe(false);
  });

  it('undo returns undefined when no saves', () => {
    expect(new EntityEditHistory(snap('S0')).undo()).toBeUndefined();
  });

  it('redo returns undefined when no saves', () => {
    expect(new EntityEditHistory(snap('S0')).redo()).toBeUndefined();
  });
});

describe('EntityEditHistory – recordSave', () => {
  it('makes canUndo=true after first save', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    expect(h.canUndo).toBe(true);
  });

  it('keeps canRedo=false after save', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    expect(h.canRedo).toBe(false);
  });

  it('clears redoStack when saving after undo', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.recordSave(snap('S2'));
    expect(h.canRedo).toBe(false);
  });
});

describe('EntityEditHistory – undo', () => {
  it('returns the state before the last save', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    expect(h.undo()?.snapshot.label).toBe('S0');
  });

  it('makes canUndo=false after undoing past all saves', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.undo();
    expect(h.canUndo).toBe(false);
  });

  it('makes canRedo=true after undo', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.undo();
    expect(h.canRedo).toBe(true);
  });
});

describe('EntityEditHistory – redo', () => {
  it('restores the next forward snapshot', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.undo();
    expect(h.redo()?.snapshot.label).toBe('S1');
  });

  it('makes canRedo=false after redoing all forward states', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.undo();
    h.redo();
    expect(h.canRedo).toBe(false);
  });

  it('makes canUndo=true after redo', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.undo();
    h.redo();
    expect(h.canUndo).toBe(true);
  });
});

describe('EntityEditHistory – multi-step traversal', () => {
  it('steps backward through N checkpoints in order', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.recordSave(snap('S2'));
    h.recordSave(snap('S3'));
    expect(h.undo()?.snapshot.label).toBe('S2');
    expect(h.undo()?.snapshot.label).toBe('S1');
    expect(h.undo()?.snapshot.label).toBe('S0');
    expect(h.canUndo).toBe(false);
  });

  it('steps forward through N checkpoints in order after full undo', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.recordSave(snap('S2'));
    h.recordSave(snap('S3'));
    h.undo(); h.undo(); h.undo();
    expect(h.redo()?.snapshot.label).toBe('S1');
    expect(h.redo()?.snapshot.label).toBe('S2');
    expect(h.redo()?.snapshot.label).toBe('S3');
    expect(h.canRedo).toBe(false);
  });
});

describe('EntityEditHistory – maxSize enforcement', () => {
  it('drops oldest checkpoint when maxSize is reached', () => {
    const h = new EntityEditHistory(snap('S0'), 3);
    h.recordSave(snap('S1'));
    h.recordSave(snap('S2'));
    h.recordSave(snap('S3')); // undoStack=[S0,S1,S2], current=S3
    h.recordSave(snap('S4')); // shift S0 → undoStack=[S1,S2,S3], current=S4
    expect(h.undo()?.snapshot.label).toBe('S3');
    expect(h.undo()?.snapshot.label).toBe('S2');
    expect(h.undo()?.snapshot.label).toBe('S1');
    expect(h.canUndo).toBe(false); // S0 was dropped
  });

  it('never exceeds maxSize checkpoints', () => {
    const h = new EntityEditHistory(snap('S0'), 2);
    for (let i = 1; i <= 10; i++) { h.recordSave(snap(`S${i}`)); }
    // Can undo at most 2 times
    h.undo(); h.undo();
    expect(h.canUndo).toBe(false);
  });
});

describe('EntityEditHistory – clear', () => {
  it('resets canUndo and canRedo', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.clear(snap('S_new'));
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('undo returns undefined after clear', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.clear(snap('S_new'));
    expect(h.undo()).toBeUndefined();
  });

  it('new initial snapshot is used after clear', () => {
    const h = new EntityEditHistory(snap('S0'));
    h.recordSave(snap('S1'));
    h.clear(snap('fresh'));
    h.recordSave(snap('S2'));
    expect(h.undo()?.snapshot.label).toBe('fresh');
  });
});
