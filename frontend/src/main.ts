import { SceneManager } from './scene/SceneManager';
import { CellRenderer } from './scene/CellRenderer';
import { SelectionHighlight } from './scene/SelectionHighlight';
import { PickingHelper } from './scene/PickingHelper';
import { WebSocketClient } from './WebSocketClient';
import { BACKEND, SnapshotCache } from './store/SnapshotCache';
import { AppState } from './store/AppState';
import { ControlPanel } from './ui/ControlPanel';
import { DetailPanel } from './ui/DetailPanel';
import { StatusIndicator } from './ui/StatusIndicator';
import { TimelineBar } from './ui/TimelineBar';
import type { TimelineBarState } from './ui/TimelineBar';
import { ColorbarOverlay } from './ui/ColorbarOverlay';
import type { CellRecord, ColorMode, StepSnapshot, SnapshotSummary, SimMeta } from './types';

// --- DOM structure ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="left-panel"></div>
  <div id="canvas-wrap">
    <canvas id="canvas"></canvas>
  </div>
  <div id="right-panel"></div>
  <div id="bottom-bar"></div>
`;

const canvas      = document.getElementById('canvas') as HTMLCanvasElement;
const canvasWrap  = document.getElementById('canvas-wrap')!;
const leftEl      = document.getElementById('left-panel')!;
const rightEl     = document.getElementById('right-panel')!;
const bottomEl    = document.getElementById('bottom-bar')!;

// --- Scene ---
const sceneManager = new SceneManager(canvas);
const cellRenderer = new CellRenderer(sceneManager.scene);
const highlight    = new SelectionHighlight(sceneManager.scene);

// --- UI ---
const status   = new StatusIndicator(leftEl);
const controls = new ControlPanel(leftEl, () => reapplyFilter());
const detail   = new DetailPanel(rightEl);
const timeline = new TimelineBar(bottomEl);
const colorbar = new ColorbarOverlay(canvasWrap);

// --- Picking ---
const picker = new PickingHelper(canvas, sceneManager.camera, cellRenderer, highlight);
picker.onPick(id => {
  if (id >= 0) {
    const cell = cellRenderer.getCellAt(id);
    if (cell) detail.showCell(cell);
  } else {
    detail.showEmpty();
  }
  AppState.setState({ selectedInstanceIndex: id });
});

// --- Current snapshot ---
let currentSnapshot: StepSnapshot | null = null;
let cameraOriented = false;
let displayInProgress = false;
let firstLoadComplete = false;
let loadSummariesInProgress = false;
let pendingCommits: SnapshotSummary[] = [];
let fetchController: AbortController | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let playFetchPromise: Promise<void> | null = null;

/** Fetch /api/meta and update AppState + ControlPanel. No-op if backend has no meta yet. */
async function fetchAndApplyMeta(): Promise<void> {
  if (AppState.simMeta !== null) return;
  try {
    const res = await fetch(`${BACKEND}/api/meta`);
    if (!res.ok) return; // 404 = no simulation connected yet
    const meta = await res.json() as SimMeta;
    AppState.setState({ simMeta: meta });
    controls.updateSimMeta(meta);
  } catch {
    // Network error (backend not running) — silently ignore
  }
}

/** Auto-orient camera once based on 2D vs 3D cell data. */
function orientCameraIfNeeded(snap: StepSnapshot): void {
  if (cameraOriented || snap.cells.length === 0) return;
  const is2D = snap.cells.every(c => Math.abs(c.hz) < 0.0001);
  if (is2D) {
    sceneManager.orientFor2D();
  } else {
    sceneManager.orientFor3D();
  }
  cameraOriented = true;
}

/** Compute maxLevel from a cell array — safe for empty arrays. */
function getMaxLevel(cells: CellRecord[]): number {
  return cells.length > 0 ? Math.max(...cells.map(c => c.level)) : 0;
}

/** Update or hide the colorbar based on the current color mode. */
function updateColorbar(cells: CellRecord[], mode: ColorMode): void {
  if (mode === 'level') {
    const maxLevel = cells.length > 0 ? Math.max(...cells.map(c => c.level)) : 1;
    colorbar.update(AppState.colormap, 0, maxLevel, 'level');
  } else if (mode === 'sim') {
    const [min, max] = cellRenderer.lastSimRange;
    const meta = AppState.simMeta;
    const name = meta?.unknownNames?.[AppState.simFieldIndex];
    const label = name ? `FIELD[${name}]` : `field[${AppState.simFieldIndex}]`;
    colorbar.update(AppState.colormap, min, max, label);
  } else {
    colorbar.hide();
  }
}

function buildTimelineState(): TimelineBarState {
  const summary = AppState.summaries[AppState.currentSummaryIndex];
  return {
    viewMode: AppState.viewMode,
    summaryCount: AppState.summaries.length,
    currentSummaryIndex: AppState.currentSummaryIndex,
    currentStepIndex: summary?.stepIndex ?? -1,
    currentTimestamp: summary?.timestamp ?? 0,
    hasPauseMode: AppState.hasPauseMode,
    autoAdvanceSim: AppState.autoAdvanceSim,
    isPaused: AppState.isPaused,
  };
}

function snapshotMatchesCurrentView(snap: StepSnapshot): boolean {
  if (AppState.colorMode !== 'sim') return true;
  return snap.simFieldIndex === AppState.simFieldIndex;
}

function clearLiveView(): void {
  currentSnapshot = null;
  cellRenderer.updateFromSnapshot(
    [],
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    0,
    AppState.simMeta,
  );
  colorbar.hide();
  highlight.hide();
  detail.showEmpty();
  status.setDisconnected();
}

function reapplyFilter(): void {
  if (AppState.colorMode === 'sim' && (!currentSnapshot || !snapshotMatchesCurrentView(currentSnapshot))) {
    syncLiveViewState();
  }
  if (!currentSnapshot) return;
  if (!snapshotMatchesCurrentView(currentSnapshot)) {
    return;
  }
  const cells = currentSnapshot.cells;
  cellRenderer.updateFromSnapshot(
    cells,
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    getMaxLevel(cells),
    AppState.simMeta,
  );
  updateColorbar(cells, AppState.colorMode);
  highlight.hide();
  detail.showEmpty();
}

function syncLiveViewState(): void {
  ws.send({
    type: 'set_view',
    colorMode: AppState.colorMode,
    simFieldIndex: AppState.simFieldIndex,
  });
}

function setViewMode(mode: 'live' | 'playing' | 'historical'): void {
  if (mode === 'live') {
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    fetchController?.abort();
    playFetchPromise = null;
    AppState.setState({ viewMode: 'live' });
    ws.send({ type: 'reach_live' });
    syncLiveViewState();
  } else if (mode === 'playing') {
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    // If coming from live, start at the last summary index
    const startIdx = AppState.viewMode === 'live'
      ? Math.max(0, AppState.summaries.length - 1)
      : AppState.currentSummaryIndex;
    AppState.setState({ viewMode: 'playing', currentSummaryIndex: startIdx });
    playTimer = setInterval(() => {
      if (playFetchPromise !== null) return; // previous tick still loading
      const next = AppState.currentSummaryIndex + 1;
      if (next >= AppState.summaries.length) {
        setViewMode('live');
        return;
      }
      AppState.setState({ currentSummaryIndex: next });
      const summary = AppState.summaries[next];
      if (!summary) return;
      playFetchPromise = navigateToStep(summary.stepIndex)
        .finally(() => { playFetchPromise = null; });
    }, 200);
  } else {
    // historical
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    fetchController?.abort();
    playFetchPromise = null;
    AppState.setState({ viewMode: 'historical' });
  }
}

function prefetchAdjacent(idx: number): void {
  const prev = AppState.summaries[idx - 1];
  const next = AppState.summaries[idx + 1];
  if (prev) void SnapshotCache.get(prev.stepIndex); // no signal — background only
  if (next) void SnapshotCache.get(next.stepIndex);
}

async function displayHistoricalSnapshot(snap: StepSnapshot): Promise<void> {
  currentSnapshot = snap;
  orientCameraIfNeeded(snap);
  if (AppState.simMeta === null) {
    await fetchAndApplyMeta();
  }
  const cells = snap.cells;
  cellRenderer.updateFromSnapshot(
    cells,
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    getMaxLevel(cells),
    AppState.simMeta,
  );
  updateColorbar(cells, AppState.colorMode);
  highlight.hide();
  detail.showEmpty();
}

async function navigateToStep(stepIndex: number): Promise<void> {
  fetchController?.abort();
  fetchController = new AbortController();
  const snap = await SnapshotCache.get(stepIndex, fetchController.signal);
  if (!snap) return; // aborted or 404 — display unchanged
  await displayHistoricalSnapshot(snap);
  prefetchAdjacent(AppState.currentSummaryIndex);
}

async function loadSummaries(): Promise<void> {
  // Concurrency guard: skip if a load is already in-flight
  if (loadSummariesInProgress) return;
  loadSummariesInProgress = true;

  // Capture the previously-displayed step index BEFORE overwriting summaries
  const prevStepIndex = AppState.currentSummaryIndex >= 0 && AppState.summaries.length > 0
    ? (AppState.summaries[AppState.currentSummaryIndex]?.stepIndex ?? -1)
    : -1;

  try {
    const res = await fetch(`${BACKEND}/api/snapshots`);
    if (!res.ok) return;
    const baseline: SnapshotSummary[] = await res.json() as SnapshotSummary[];

    // Atomically drain the pending buffer and mark load complete BEFORE merging.
    // Any step_committed arriving after this point goes directly to AppState.summaries.
    const captured = pendingCommits.splice(0);
    firstLoadComplete = true;

    // Dedup and sort
    const existing = new Set(baseline.map(s => s.stepIndex));
    for (const s of captured) {
      if (!existing.has(s.stepIndex)) { baseline.push(s); existing.add(s.stepIndex); }
    }
    baseline.sort((a, b) => a.stepIndex - b.stepIndex);

    AppState.setState({ summaries: baseline });

    // Correct currentSummaryIndex
    if (AppState.viewMode === 'live' || baseline.length === 0) {
      AppState.setState({ currentSummaryIndex: baseline.length - 1 });
      // In live mode, warm the scene with the latest REST snapshot so the
      // renderer shows something before the first WS snapshot_data arrives.
      if (baseline.length > 0 && !currentSnapshot) {
        void navigateToStep(baseline[baseline.length - 1]!.stepIndex);
      }
    } else {
      const idx = prevStepIndex >= 0
        ? baseline.findIndex(s => s.stepIndex === prevStepIndex)
        : -1;
      const corrected = idx >= 0 ? idx : baseline.length - 1;
      AppState.setState({ currentSummaryIndex: corrected });
      if (idx < 0 && baseline.length > 0) {
        void navigateToStep(baseline[corrected]!.stepIndex);
      }
    }
  } catch {
    // Network error — will retry on next status message
  } finally {
    loadSummariesInProgress = false;
  }
}

async function displaySnapshot(snap: StepSnapshot): Promise<void> {
  // Re-entrancy guard: if a previous displaySnapshot call is still awaiting
  // fetchAndApplyMeta(), do NOT send snapshot_consumed — the backend's
  // snapshotInFlight flag must stay set until the current render finishes.
  if (displayInProgress) return;
  if (!snapshotMatchesCurrentView(snap)) {
    // Send snapshot_consumed even on mismatch so the backend clears its
    // snapshotInFlight flag and can push the correct snapshot for the current view.
    ws.send({ type: 'snapshot_consumed', stepIndex: snap.stepIndex });
    syncLiveViewState();
    return;
  }
  try {
    displayInProgress = true;
    currentSnapshot = snap;
    orientCameraIfNeeded(snap);
    if (AppState.simMeta === null) {
      await fetchAndApplyMeta();
    }
    const cells = snap.cells;
    cellRenderer.updateFromSnapshot(
      cells,
      AppState.filter,
      AppState.colorMode,
      AppState.colormap,
      AppState.simFieldIndex,
      getMaxLevel(cells),
      AppState.simMeta,
    );
    updateColorbar(cells, AppState.colorMode);
    status.setLive(snap.stepIndex, snap.cellCount);
    ws.send({ type: 'snapshot_consumed', stepIndex: snap.stepIndex });
  } finally {
    displayInProgress = false;
  }
}

// --- WebSocket ---
const ws = new WebSocketClient('ws://localhost:7422');

ws.on('status', (msg) => {
  const statusMsg = msg as Record<string, unknown>;
  const trees = (statusMsg['trees'] as string[]) ?? [];
  controls.updateTreeList(trees);

  const hasPauseMode = (statusMsg['hasPauseMode'] as boolean) ?? false;
  const autoAdvanceSim = (statusMsg['autoAdvanceSim'] as boolean) ?? false;
  const isPaused = (statusMsg['paused'] as boolean) ?? false;

  AppState.setState({ registeredTrees: trees, isPaused, hasPauseMode, autoAdvanceSim });

  if (!firstLoadComplete) {
    void loadSummaries();
  }

  if (AppState.viewMode === 'live') {
    ws.send({ type: 'reach_live' });
    syncLiveViewState();
  }
});

ws.on('step_committed', (msg) => {
  const stepMsg = msg as Record<string, unknown>;
  const stepIndex = stepMsg['stepIndex'] as number;
  const timestamp = (stepMsg['timestamp'] as number) ?? 0;
  const cellCount = (stepMsg['cellCount'] as number) ?? 0;

  AppState.setState({
    totalSteps: AppState.totalSteps + 1,
    currentStep: stepIndex,
  });

  if (!firstLoadComplete) {
    pendingCommits.push({ stepIndex, timestamp, cellCount });
    return;
  }

  // Append to summaries
  const summaries = [...AppState.summaries, { stepIndex, timestamp, cellCount }];
  let csi = AppState.currentSummaryIndex;

  if (summaries.length > 200) {
    const evicted = summaries.length - 200;
    summaries.splice(0, evicted);
    if (AppState.viewMode === 'live') {
      csi = summaries.length - 1;
    } else {
      const wasEvicted = csi < evicted;
      csi = Math.max(0, csi - evicted);
      if (wasEvicted) {
        // Early return: single setState then navigate to re-sync display
        AppState.setState({ summaries, currentSummaryIndex: csi });
        void navigateToStep(summaries[0]!.stepIndex);
        return;
      }
      // Non-evicted: fall through to the single outer setState below
    }
  } else if (AppState.viewMode === 'live') {
    csi = summaries.length - 1;
  }

  AppState.setState({ summaries, currentSummaryIndex: csi });
});

ws.on('snapshot_data', (msg) => {
  void displaySnapshot(msg as StepSnapshot);
});

ws.on('simulation_reset', () => {
  if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
  fetchController?.abort();
  playFetchPromise = null;
  pendingCommits.splice(0);
  firstLoadComplete = false;

  AppState.setState({
    currentStep: -1,
    totalSteps: 0,
    summaries: [],
    currentSummaryIndex: -1,
    registeredTrees: [],
    simMeta: null,
    selectedCell: null,
    selectedInstanceIndex: -1,
    viewMode: 'live',
    hasPauseMode: false,
    autoAdvanceSim: false,
    isPaused: false,
  });
  controls.updateTreeList([]);
  controls.updateSimMeta(null);
  clearLiveView();
});

ws.on('close', () => {
  firstLoadComplete = false;
});

timeline.onPlay(() => setViewMode('playing'));
timeline.onPause(() => setViewMode('historical'));
timeline.onLive(() => setViewMode('live'));

timeline.onPrev(() => {
  if (AppState.summaries.length === 0) return;
  const idx = Math.max(0, AppState.currentSummaryIndex - 1);
  setViewMode('historical');
  AppState.setState({ currentSummaryIndex: idx });
  void navigateToStep(AppState.summaries[idx]!.stepIndex);
});

timeline.onNext(() => {
  if (AppState.summaries.length === 0) return;
  const idx = Math.min(AppState.summaries.length - 1, AppState.currentSummaryIndex + 1);
  setViewMode('historical');
  AppState.setState({ currentSummaryIndex: idx });
  void navigateToStep(AppState.summaries[idx]!.stepIndex);
});

timeline.onScrub((idx) => {
  if (!AppState.summaries[idx]) return;
  setViewMode('historical');
  AppState.setState({ currentSummaryIndex: idx });
  void navigateToStep(AppState.summaries[idx]!.stepIndex);
});

// Optimistic AppState updates so the timeline bar re-renders immediately
// without waiting for a backend status broadcast.
timeline.onPauseSim(() => {
  AppState.setState({ autoAdvanceSim: false });
  ws.send({ type: 'pause_sim' });
});
timeline.onResumeSim(() => {
  AppState.setState({ isPaused: false });
  ws.send({ type: 'resume_sim' });
});

// Reactive timeline bar update on any AppState change
AppState.onChange(() => timeline.update(buildTimelineState()));

// Initial render
timeline.update(buildTimelineState());

// Eagerly load summaries and meta at startup so historical navigation and
// the sim field picker are available before the first WS status message.
void loadSummaries();
void fetchAndApplyMeta();

// Expose a minimal debug handle for Playwright integration tests.
// Gives tests read-only access to renderer internals without modifying the
// production rendering path.
(window as unknown as Record<string, unknown>)['__STV_DEBUG__'] = {
  get instanceCount() { return cellRenderer.mesh.count; },
  get usingSimFallback() { return cellRenderer.usingSimFallback; },
  get simMeta() { return AppState.simMeta; },
};
