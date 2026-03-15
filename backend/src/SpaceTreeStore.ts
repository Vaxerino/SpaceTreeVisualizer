import type { CellRecord, StepSnapshot, SnapshotSummary, SimMeta } from './types';

export type StepCommittedCallback = (snapshot: StepSnapshot) => void;
export type StoreResetCallback = () => void;

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
  private maxSimSnapshots: number;

  /** Simulation patch metadata (set from the first connecting tree's handshake). */
  private simMeta: SimMeta | null = null;

  /** Tree keys registered at TCP handshake time. */
  private registeredTrees: Set<string> = new Set();
  /** Stable set of trees expected to participate in each committed step after startup. */
  private expectedTrees: Set<string> | null = null;
  /** Step indices that have already been committed (prevents duplicate commits). */
  private committedSteps: Set<number> = new Set();

  /**
   * Pending commit timers, keyed by step index.
   *
   * When all trees that have sent STEP_BEGIN(N) have also sent STEP_END(N),
   * a 30 ms timer is started instead of committing immediately. This grace
   * period lets late-connecting trees (lazy TCP open in beginTraversal) send
   * their own STEP_BEGIN(N) before we close the step.  If a new STEP_BEGIN(N)
   * arrives during the window, the timer is cancelled and rescheduled once
   * that tree also sends STEP_END(N).
   */
  private pendingCommitTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

  /** Per-step accumulator: step_index → {tree_key → cells[]} */
  private pending: Map<number, Map<string, CellRecord[]>> = new Map();
  private pendingTimestamps: Map<number, number> = new Map();
  /** Trees that have sent STEP_END for each step. */
  private pendingEnded: Map<number, Set<string>> = new Map();
  /** Steps whose grace period has elapsed and are ready to commit in order. */
  private readySteps: Set<number> = new Set();
  private nextCommitStep: number | null = null;

  /** Trees that have sent PAUSE_ACK for the current step. */
  private pausedTrees: Set<string> = new Set();
  private pauseModeTrees: Set<string> = new Set();
  private autoAdvanceSim: boolean = false;

  private onCommitCallbacks: StepCommittedCallback[] = [];
  private onResetCallbacks: StoreResetCallback[] = [];

  /** Socket fd for sending CONTINUE to paused trees (set by TCPServer). */
  continueSenders: Map<string, () => void> = new Map();

  constructor(maxSnapshots = 200, maxSimSnapshots = 10) {
    this.maxSnapshots = maxSnapshots;
    this.maxSimSnapshots = maxSimSnapshots;
  }

  /** Register a tree at TCP handshake time (before any STEP_BEGIN). */
  registerTree(key: string, pauseMode = false): void {
    this.registeredTrees.add(key);
    if (pauseMode) this.pauseModeTrees.add(key);
    // NOTE: if a new-run tree connects before resetForNewRun fires (a race window
    // exists when continueSenders is non-empty between the old run ending and the
    // new run detection), it will be added to expectedTrees and may block commits
    // indefinitely. TCPServer's continueSenders.size===0 guard is the primary
    // defense against this; the reset path clears expectedTrees on new-run detection.
    if (this.expectedTrees !== null) {
      this.expectedTrees.add(key);
    }
  }

  unregisterTree(key: string): void {
    const removedRegistered = this.registeredTrees.delete(key);
    const removedExpected = this.expectedTrees?.delete(key) ?? false;
    this.pausedTrees.delete(key);
    this.pauseModeTrees.delete(key);
    if (!removedRegistered && !removedExpected) return;

    for (const [stepIndex, stepMap] of this.pending.entries()) {
      const ended = this.pendingEnded.get(stepIndex);
      stepMap.delete(key);
      ended?.delete(key);
      if (stepMap.size === 0) {
        this.pending.delete(stepIndex);
        this.pendingTimestamps.delete(stepIndex);
        this.pendingEnded.delete(stepIndex);
        this.readySteps.delete(stepIndex);
        const timer = this.pendingCommitTimers.get(stepIndex);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.pendingCommitTimers.delete(stepIndex);
        }
        continue;
      }

      if (ended && this.stepHasAllExpectedTrees(stepIndex, stepMap, ended)) {
        this.scheduleReadyCheck(stepIndex);
      }
    }

    if (this.nextCommitStep !== null && !this.pending.has(this.nextCommitStep) && !this.readySteps.has(this.nextCommitStep)) {
      const candidateIndices = [...this.pending.keys(), ...this.readySteps.values()].filter(i => !this.committedSteps.has(i));
      this.nextCommitStep = candidateIndices.length > 0 ? Math.min(...candidateIndices) : null;
    }
    this.flushReadySteps();
  }

  /** Record patch metadata from a connecting tree's handshake. First writer wins. */
  setSimMeta(patchSize: number, nUnknowns: number, nAux: number): void {
    if (this.simMeta === null) {
      this.simMeta = { patchSize, nUnknowns, nAux, unknownNames: null };
    }
  }

  /** Set unknown names from a METADATA_NAMES frame (may arrive after setSimMeta). */
  setUnknownNames(names: string[]): void {
    if (this.simMeta !== null) {
      this.simMeta = { ...this.simMeta, unknownNames: names };
    }
  }

  getSimMeta(): SimMeta | null {
    return this.simMeta;
  }

  /** Register a listener called whenever a step is committed. */
  onStepCommitted(cb: StepCommittedCallback): void {
    this.onCommitCallbacks.push(cb);
  }

  onReset(cb: StoreResetCallback): void {
    this.onResetCallbacks.push(cb);
  }

  hasRetainedRunState(): boolean {
    return this.snapshots.length > 0
      || this.pending.size > 0
      || this.committedSteps.size > 0
      || this.registeredTrees.size > 0
      || this.simMeta !== null;
  }

  resetForNewRun(): void {
    for (const timer of this.pendingCommitTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingCommitTimers.clear();
    this.snapshots = [];
    this.pending.clear();
    this.pendingTimestamps.clear();
    this.pendingEnded.clear();
    this.readySteps.clear();
    this.nextCommitStep = null;
    this.committedSteps.clear();
    this.pausedTrees.clear();
    this.pauseModeTrees.clear();
    this.autoAdvanceSim = false;
    this.registeredTrees.clear();
    this.expectedTrees = null;
    this.simMeta = null;

    console.log('[store] reset retained state for new simulation run');
    for (const cb of this.onResetCallbacks) {
      cb();
    }
  }

  onStepBegin(treeKey: string, stepIndex: number, timestamp: number): void {
    this.registeredTrees.add(treeKey);
    // Ignore STEP_BEGIN for steps we already committed (late-arriving trees in step 0).
    if (this.committedSteps.has(stepIndex)) return;
    if (this.nextCommitStep === null || stepIndex < this.nextCommitStep) {
      this.nextCommitStep = stepIndex;
    }
    if (!this.pending.has(stepIndex)) {
      this.pending.set(stepIndex, new Map());
      this.pendingTimestamps.set(stepIndex, timestamp);
      this.pendingEnded.set(stepIndex, new Set());
    }
    this.pending.get(stepIndex)!.set(treeKey, []);

    // A new tree is joining step N — cancel any pending commit timer so we
    // don't commit before this tree has had a chance to send STEP_END.
    const timer = this.pendingCommitTimers.get(stepIndex);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingCommitTimers.delete(stepIndex);
    }
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

    if (!this.stepHasAllExpectedTrees(stepIndex, stepMap, ended)) return;

    this.scheduleReadyCheck(stepIndex);
  }

  onPauseAck(treeKey: string): void {
    this.pausedTrees.add(treeKey);
    console.log(`[store] ${treeKey} paused (${this.pausedTrees.size}/${this.registeredTrees.size} trees paused)`);
    if (this.pauseModeTrees.size > 0 && this.pausedTrees.size === this.pauseModeTrees.size && this.autoAdvanceSim) {
      this.sendContinueToAllPaused();
    }
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

  setAutoAdvanceSim(v: boolean): void {
    this.autoAdvanceSim = v;
  }

  isAutoAdvancing(): boolean {
    return this.autoAdvanceSim;
  }

  hasPauseModeTrees(): boolean {
    return this.pauseModeTrees.size > 0;
  }

  private flushReadySteps(): void {
    if (this.nextCommitStep === null) return;

    while (this.nextCommitStep !== null) {
      const stepIndex = this.nextCommitStep;
      if (!this.readySteps.has(stepIndex)) break;
      this.readySteps.delete(stepIndex);
      this.commitStep(stepIndex);

      const pendingIndices = [...this.pending.keys()];
      const readyIndices = [...this.readySteps.values()];
      const candidateIndices = [...pendingIndices, ...readyIndices].filter(i => !this.committedSteps.has(i));
      this.nextCommitStep = candidateIndices.length > 0
        ? Math.min(...candidateIndices)
        : null;
    }
  }

  private scheduleReadyCheck(stepIndex: number): void {
    // Preserve the 30 ms grace window for late STEP_BEGIN arrivals on startup.
    if (this.pendingCommitTimers.has(stepIndex)) return;
    const timer = setTimeout(() => {
      this.pendingCommitTimers.delete(stepIndex);
      const sm = this.pending.get(stepIndex);
      const en = this.pendingEnded.get(stepIndex);
      if (!sm || !en) return;
      if (this.stepHasAllExpectedTrees(stepIndex, sm, en)) {
        this.readySteps.add(stepIndex);
        this.flushReadySteps();
      }
    }, 30);
    this.pendingCommitTimers.set(stepIndex, timer);
  }

  private commitStep(stepIndex: number): void {
    // Guard: don't double-commit (timer + a direct call could race).
    if (this.committedSteps.has(stepIndex)) return;
    this.committedSteps.add(stepIndex);

    // Cancel any pending timer for this step (shouldn't still exist, but be safe).
    const timer = this.pendingCommitTimers.get(stepIndex);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingCommitTimers.delete(stepIndex);
    }
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
      // Check once at commit time rather than on every prune cycle (O(1) amortised).
      hasSimData: allCells.length > 0 && allCells[0]!.simData !== undefined,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    this.pruneHistoricalSimData();

    this.pending.delete(stepIndex);
    this.pendingTimestamps.delete(stepIndex);
    this.pendingEnded.delete(stepIndex);

    console.log(`[store] step ${stepIndex} committed: ${allCells.length} cells from ${snapshot.treeIds.length} tree(s)`);
    if (this.expectedTrees === null) {
      this.expectedTrees = new Set(this.registeredTrees);
    }

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

  private pruneHistoricalSimData(): void {
    let snapshotsWithSim = 0;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const snapshot = this.snapshots[i]!;
      if (!snapshot.hasSimData) continue;

      snapshotsWithSim++;
      if (snapshotsWithSim <= this.maxSimSnapshots) continue;

      for (const cell of snapshot.cells) {
        if (cell.simData) {
          cell.simDataLength = cell.simData.length;
          delete cell.simData;
        }
      }
      delete snapshot.simFieldIndex;
      snapshot.hasSimData = false;
    }
  }

  private stepHasAllExpectedTrees(
    stepIndex: number,
    stepMap: Map<string, CellRecord[]>,
    ended: Set<string>,
  ): boolean {
    const expected = this.expectedTreesForStep(stepIndex);
    if (expected.size === 0) return false;
    for (const treeKey of expected) {
      if (!stepMap.has(treeKey) || !ended.has(treeKey)) {
        return false;
      }
    }
    return true;
  }

  private expectedTreesForStep(stepIndex: number): Set<string> {
    // Preserve the original late-connect grace for the first committed step.
    if (this.expectedTrees === null && this.committedSteps.size === 0) {
      const current = this.pending.get(stepIndex);
      return current ? new Set(current.keys()) : new Set();
    }
    return this.expectedTrees ?? this.registeredTrees;
  }

}
