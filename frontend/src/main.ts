import { SceneManager } from './scene/SceneManager';
import { CellRenderer } from './scene/CellRenderer';
import { SelectionHighlight } from './scene/SelectionHighlight';
import { PickingHelper } from './scene/PickingHelper';
import { WebSocketClient } from './WebSocketClient';
import { SnapshotCache } from './store/SnapshotCache';
import { AppState } from './store/AppState';
import { ControlPanel } from './ui/ControlPanel';
import { DetailPanel } from './ui/DetailPanel';
import { StatusIndicator } from './ui/StatusIndicator';
import { TimelineBar } from './ui/TimelineBar';
import { ColorbarOverlay } from './ui/ColorbarOverlay';
import type { CellRecord, ColorMode, StepSnapshot } from './types';

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
    colorbar.update(AppState.colormap, min, max, `field[${AppState.simFieldIndex}]`);
  } else {
    colorbar.hide();
  }
}

function reapplyFilter(): void {
  if (!currentSnapshot) return;
  const cells = currentSnapshot.cells;
  cellRenderer.updateFromSnapshot(
    cells,
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    getMaxLevel(cells),
  );
  updateColorbar(cells, AppState.colorMode);
  highlight.hide();
  detail.showEmpty();
}

async function loadAndDisplay(stepIndex: number): Promise<void> {
  const snap = await SnapshotCache.get(stepIndex);
  if (!snap) return;
  currentSnapshot = snap;
  orientCameraIfNeeded(snap);
  const cells = snap.cells;
  cellRenderer.updateFromSnapshot(
    cells,
    AppState.filter,
    AppState.colorMode,
    AppState.colormap,
    AppState.simFieldIndex,
    getMaxLevel(cells),
  );
  updateColorbar(cells, AppState.colorMode);
  status.setLive(snap.stepIndex, snap.cellCount);
  timeline.setInfo(`LIVE  step ${snap.stepIndex}  ${snap.cellCount} cells`);
}

// --- WebSocket ---
const ws = new WebSocketClient('ws://localhost:7422');

ws.on('status', (msg) => {
  const trees = (msg['trees'] as string[]) ?? [];
  controls.updateTreeList(trees);
  AppState.setState({ registeredTrees: trees });

  const paused = msg['paused'] as boolean;
  timeline.setPaused(paused);

  const liveStep = msg['liveStep'] as number;
  if (liveStep >= 0) {
    void loadAndDisplay(liveStep);
  }
});

ws.on('step_committed', (msg) => {
  const stepIndex = msg['stepIndex'] as number;
  if (AppState.isLive) {
    void loadAndDisplay(stepIndex);
  }
  AppState.setState({
    totalSteps: AppState.totalSteps + 1,
    currentStep: stepIndex,
  });
});

timeline.onContinue(() => {
  ws.send({ type: 'continue' });
});

// Attempt to load latest snapshot on startup
void loadAndDisplay(-1);
