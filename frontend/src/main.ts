import { SceneManager } from './scene/SceneManager';
import { CellRenderer } from './scene/CellRenderer';
import { SelectionHighlight } from './scene/SelectionHighlight';
import { PickingHelper } from './scene/PickingHelper';
import { ColorMapper } from './scene/ColorMapper';
import { WebSocketClient } from './WebSocketClient';
import { BACKEND } from './store/SnapshotCache';
import { AppState } from './store/AppState';
import { ControlPanel } from './ui/ControlPanel';
import { DetailPanel } from './ui/DetailPanel';
import { StatusIndicator } from './ui/StatusIndicator';
import { TimelineBar } from './ui/TimelineBar';
import { ColorbarOverlay } from './ui/ColorbarOverlay';
import type { CellRecord, ColorMode, StepSnapshot, SimMeta } from './types';

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
const simReferenceRanges: Map<number, [number, number]> = new Map();

/** Fetch /api/meta and update AppState + ControlPanel. No-op if backend has no meta yet. */
async function fetchAndApplyMeta(force = false): Promise<void> {
  if (!force && AppState.simMeta !== null) return;
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
  timeline.setInfo('LIVE');
}

function getSimReferenceRange(cells: CellRecord[]): [number, number] | null {
  if (AppState.colorMode !== 'sim') return null;
  const metaRange = AppState.simMeta?.initialFieldRanges?.[AppState.simFieldIndex];
  if (metaRange) {
    simReferenceRanges.set(AppState.simFieldIndex, metaRange);
    return metaRange;
  }
  const existing = simReferenceRanges.get(AppState.simFieldIndex);
  if (existing) return existing;

  const range = ColorMapper.simRange(cells, AppState.simFieldIndex, AppState.simMeta);
  simReferenceRanges.set(AppState.simFieldIndex, range);
  return range;
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
  const simRangeOverride = getSimReferenceRange(cells);
  cellRenderer.updateFromSnapshot(
    cells,
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    getMaxLevel(cells),
    AppState.simMeta,
    simRangeOverride,
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

async function displaySnapshot(snap: StepSnapshot): Promise<void> {
  if (!snapshotMatchesCurrentView(snap)) {
    ws.send({ type: 'snapshot_consumed', stepIndex: snap.stepIndex });
    syncLiveViewState();
    return;
  }
  currentSnapshot = snap;
  orientCameraIfNeeded(snap);
  if (AppState.simMeta === null) {
    await fetchAndApplyMeta();
  } else if (AppState.colorMode === 'sim' && AppState.simMeta.initialFieldRanges === null) {
    await fetchAndApplyMeta(true);
  }
  const cells = snap.cells;
  const simRangeOverride = getSimReferenceRange(cells);
  cellRenderer.updateFromSnapshot(
    cells,
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    getMaxLevel(cells),
    AppState.simMeta,
    simRangeOverride,
  );
  updateColorbar(cells, AppState.colorMode);
  status.setLive(snap.stepIndex, snap.cellCount);
  timeline.setInfo(`LIVE  step ${snap.stepIndex}  ${snap.cellCount} cells`);
  ws.send({ type: 'snapshot_consumed', stepIndex: snap.stepIndex });
}

// --- WebSocket ---
const ws = new WebSocketClient('ws://localhost:7422');

ws.on('status', (msg) => {
  const statusMsg = msg as Record<string, unknown>;
  const trees = (statusMsg['trees'] as string[]) ?? [];
  controls.updateTreeList(trees);
  AppState.setState({ registeredTrees: trees });

  const paused = statusMsg['paused'] as boolean;
  timeline.setPaused(paused);

  const liveStep = statusMsg['liveStep'] as number;
  if (liveStep >= 0) {
    syncLiveViewState();
  }
});

ws.on('step_committed', (msg) => {
  const stepIndex = (msg as Record<string, unknown>)['stepIndex'] as number;
  AppState.setState({
    totalSteps: AppState.totalSteps + 1,
    currentStep: stepIndex,
  });
});

ws.on('snapshot_data', (msg) => {
  void displaySnapshot(msg as StepSnapshot);
});

ws.on('simulation_reset', () => {
  AppState.setState({
    currentStep: -1,
    totalSteps: 0,
    registeredTrees: [],
    simMeta: null,
    selectedCell: null,
    selectedInstanceIndex: -1,
  });
  controls.updateTreeList([]);
  controls.updateSimMeta(null);
  simReferenceRanges.clear();
  clearLiveView();
});

timeline.onContinue(() => {
  ws.send({ type: 'continue' });
});

syncLiveViewState();

// Expose a minimal debug handle for Playwright integration tests.
// Gives tests read-only access to renderer internals without modifying the
// production rendering path.
(window as unknown as Record<string, unknown>)['__STV_DEBUG__'] = {
  get instanceCount() { return cellRenderer.mesh.count; },
  get usingSimFallback() { return cellRenderer.usingSimFallback; },
  get simMeta() { return AppState.simMeta; },
};
