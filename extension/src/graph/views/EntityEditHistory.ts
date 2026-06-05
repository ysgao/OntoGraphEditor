import type { EntitySnapshot, PositionHints } from './EntityEditorMessages';

export interface HistoryEntry {
  snapshot: EntitySnapshot;
  restoreHints?: PositionHints;
}

export class EntityEditHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private current: EntitySnapshot;
  private readonly maxSize: number;

  constructor(initial: EntitySnapshot, maxSize = 50) {
    this.current = initial;
    this.maxSize = maxSize;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get currentSnapshot(): EntitySnapshot { return this.current; }

  recordSave(newSnapshot: EntitySnapshot, restoreHints?: PositionHints): void {
    if (this.undoStack.length >= this.maxSize) { this.undoStack.shift(); }
    this.undoStack.push({ snapshot: this.current, restoreHints });
    this.current = newSnapshot;
    this.redoStack.length = 0;
  }

  undo(): HistoryEntry | undefined {
    if (this.undoStack.length === 0) { return undefined; }
    this.redoStack.push({ snapshot: this.current });
    const entry = this.undoStack.pop()!;
    this.current = entry.snapshot;
    return entry;
  }

  redo(): HistoryEntry | undefined {
    if (this.redoStack.length === 0) { return undefined; }
    this.undoStack.push({ snapshot: this.current });
    const entry = this.redoStack.pop()!;
    this.current = entry.snapshot;
    return entry;
  }

  /** Replace current snapshot without touching the undo/redo stacks (used after auto-save). */
  updateCurrentSnapshot(snapshot: EntitySnapshot): void {
    this.current = snapshot;
  }

  clear(newInitial: EntitySnapshot): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.current = newInitial;
  }
}
