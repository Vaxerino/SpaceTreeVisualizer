import type { CellRecord, StepSnapshot, SnapshotSummary } from './types';

export type StepCommittedCallback = (snapshot: StepSnapshot) => void;

/**
 * In-memory store for all received grid data.
 *
 * Collects per-tree, per-step cell data. When all registered trees for a
 * given step have sent FRAME_STEP_END, the step is "committed": merged into
 * a StepSnapshot and pushed to the ring buffer.
 */
export class SpaceTreeStore {
  /** Ring buffer of committed snapshots, newest at the end. */
  private snapshots: StepSnapshot[] = [];
  private maxSnapshots: number;

  /** Registered tree keys (set on first STEP_BEGIN). */
  private registeredTrees: Set<string> = new Set();

  /** Per-step accumulator: step_index → {tree_key → cells[]} */
  private pending: Map<number, Map<string, CellRecord[]>> = new Map();
  private pendingTimestamps: Map<number, number> = new Map();
  /** Trees that have sent STEP_END for each step. */
  private pendingEnded: Map<number, Set<string>> = new Map();

  /** Trees that have sent PAUSE_ACK for the current step. */
  private pausedTrees: Set<string> = new Set();

  private onCommitCallbacks: StepCommittedCallback[] = [];

  /** Socket fd for sending CONTINUE to paused trees (set by TCPServer). */
  continueSenders: Map<string, () => void> = new Map();

  constructor(maxSnapshots = 200) {
    this.maxSnapshots = maxSnapshots;
  }

  /** Register a listener called whenever a step is committed. */
  onStepCommitted(cb: StepCommittedCallback): void {
    this.onCommitCallbacks.push(cb);
  }

  onStepBegin(treeKey: string, stepIndex: number, timestamp: number): void {
    this.registeredTrees.add(treeKey);
    if (!this.pending.has(stepIndex)) {
      this.pending.set(stepIndex, new Map());
      this.pendingTimestamps.set(stepIndex, timestamp);
      this.pendingEnded.set(stepIndex, new Set());
    }
    this.pending.get(stepIndex)!.set(treeKey, []);
  }

  addCells(treeKey: string, stepIndex: number, cells: CellRecord[]): void {
    const stepMap = this.pending.get(stepIndex);
    if (!stepMap) return;
    const existing = stepMap.get(treeKey) ?? [];
    stepMap.set(treeKey, existing.concat(cells));
  }

  onStepEnd(treeKey: string, stepIndex: number): void {
    const stepMap = this.pending.get(stepIndex);
    const ended = this.pendingEnded.get(stepIndex);
    if (!stepMap || !ended) return;

    ended.add(treeKey);

    // Step is complete when every tree that sent STEP_BEGIN has sent STEP_END.
    const beganKeys = [...stepMap.keys()];
    if (beganKeys.length > 0 && beganKeys.every(k => ended.has(k))) {
      this.commitStep(stepIndex);
    }
  }

  onPauseAck(treeKey: string): void {
    this.pausedTrees.add(treeKey);
    console.log(`[store] ${treeKey} paused (${this.pausedTrees.size}/${this.registeredTrees.size} trees paused)`);
  }

  sendContinueToAllPaused(): void {
    for (const key of this.pausedTrees) {
      const sender = this.continueSenders.get(key);
      if (sender) sender();
    }
    this.pausedTrees.clear();
  }

  isPaused(): boolean {
    return this.pausedTrees.size > 0;
  }

  private commitStep(stepIndex: number): void {
    const stepMap = this.pending.get(stepIndex)!;
    const timestamp = this.pendingTimestamps.get(stepIndex) ?? 0;

    const allCells: CellRecord[] = [];
    for (const cells of stepMap.values()) {
      allCells.push(...cells);
    }

    const snapshot: StepSnapshot = {
      stepIndex,
      timestamp,
      cells: allCells,
      faces: [],
      vertices: [],
      treeIds: [...stepMap.keys()],
      cellCount: allCells.length,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    this.pending.delete(stepIndex);
    this.pendingTimestamps.delete(stepIndex);
    this.pendingEnded.delete(stepIndex);

    console.log(`[store] step ${stepIndex} committed: ${allCells.length} cells from ${snapshot.treeIds.length} tree(s)`);

    for (const cb of this.onCommitCallbacks) {
      cb(snapshot);
    }
  }

  getLatestSnapshot(): StepSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  getSnapshot(stepIndex: number): StepSnapshot | undefined {
    return this.snapshots.find(s => s.stepIndex === stepIndex);
  }

  getSummaries(): SnapshotSummary[] {
    return this.snapshots.map(s => ({
      stepIndex: s.stepIndex,
      timestamp: s.timestamp,
      cellCount: s.cellCount,
    }));
  }

  getRegisteredTrees(): string[] {
    return [...this.registeredTrees];
  }

  getLiveStep(): number {
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1].stepIndex
      : -1;
  }
}
