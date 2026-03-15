# Frontend Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable colormaps (via d3-scale-chromatic LUT registry), level slider with cumulative toggle, treeId color mode, and a ParaView-style colorbar overlay to the SpaceTreeVisualizer frontend.

**Architecture:** A new `ColormapRegistry.ts` module owns all colormap LUTs (built once at load time from d3 interpolators); `ColorMapper.ts` calls into it; `ColorbarOverlay.ts` draws a canvas gradient overlay on the Three.js canvas wrapper. All state flows through the existing `AppState` singleton.

**Tech Stack:** TypeScript (strict), Three.js r183, Vite 8, d3-scale-chromatic ^3.1.0. No test framework — verification uses `npx tsc --noEmit` and Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-03-15-frontend-overhaul-design.md`

---

## Chunk 1: Foundation — types, deps, ColormapRegistry

### Task 1: Install d3-scale-chromatic

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```bash
cd frontend && npm install d3-scale-chromatic && npm install --save-dev @types/d3-scale-chromatic
```

- [ ] **Step 2: Verify it installed**

```bash
cd frontend && node -e "import('d3-scale-chromatic').then(m => console.log(Object.keys(m).filter(k=>k.startsWith('interpolate')).slice(0,5)))"
```

Expected output: array including `interpolateTurbo`, `interpolateViridis`, etc.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add package.json package-lock.json && git commit -m "chore: add d3-scale-chromatic"
```

---

### Task 2: Update `types.ts`

**Files:**
- Modify: `frontend/src/types.ts`

The current `FilterSpec` uses `minLevel`/`maxLevel`. `ColorMode` has 5 values. Both need updating.

- [ ] **Step 1: Replace the relevant sections in `frontend/src/types.ts`**

Replace the `ColorMode` type line:
```ts
// Before:
export type ColorMode = 'level' | 'local' | 'enclave' | 'refinement' | 'sim';

// After:
export type ColorMode = 'level' | 'local' | 'enclave' | 'refinement' | 'sim' | 'treeId';
```

Add the new `ColormapName` type after the `ColorMode` line:
```ts
export type ColormapName =
  'turbo'   | 'viridis' | 'plasma' | 'magma' |
  'inferno' | 'rdbu'    | 'grayscale';
```

Replace the `FilterSpec` interface:
```ts
// Before:
export interface FilterSpec {
  minLevel: number;
  maxLevel: number;
  showLocal: boolean;
  showRemote: boolean;
}

// After:
export interface FilterSpec {
  level: number;            // selected AMR level
  levelCumulative: boolean; // true = show levels 0..level, false = show only level
  showLocal: boolean;
  showRemote: boolean;
}
```

- [ ] **Step 2: Type-check — expect errors in files that use the old FilterSpec**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: errors mentioning `minLevel`, `maxLevel` in `AppState.ts`, `ControlPanel.ts`, `CellRenderer.ts`. This is expected — we'll fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/types.ts && git commit -m "feat: add ColormapName type, treeId ColorMode, reshape FilterSpec"
```

---

### Task 3: Create `ColormapRegistry.ts`

**Files:**
- Create: `frontend/src/scene/ColormapRegistry.ts`

This module builds a 256-entry `number[]` LUT per colormap at module load time. All lookups at render time are O(1) array indexing — no string parsing.

- [ ] **Step 1: Create `frontend/src/scene/ColormapRegistry.ts`**

```ts
import {
  interpolateTurbo,
  interpolateViridis,
  interpolatePlasma,
  interpolateMagma,
  interpolateInferno,
  interpolateGreys,
  interpolateRdBu,
} from 'd3-scale-chromatic';
import type { ColormapName } from '../types';

/**
 * Parse d3's "rgb(r,g,b)" string → 0xRRGGBB integer.
 * Called only at module load time (256 × 7 times), never at render time.
 */
function parseRgb(rgb: string): number {
  // matches "rgb(123, 45, 67)" with optional spaces
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return 0x888888;
  return (parseInt(m[1]!, 10) << 16) | (parseInt(m[2]!, 10) << 8) | parseInt(m[3]!, 10);
}

/**
 * Build a 256-entry LUT from a d3 interpolator.
 * Index i maps to the color at t = i/255.
 */
function buildLUT(fn: (t: number) => string): number[] {
  return Array.from({ length: 256 }, (_, i) => parseRgb(fn(i / 255)));
}

const LUTS: Record<ColormapName, number[]> = {
  turbo:     buildLUT(interpolateTurbo),
  viridis:   buildLUT(interpolateViridis),
  plasma:    buildLUT(interpolatePlasma),
  magma:     buildLUT(interpolateMagma),
  inferno:   buildLUT(interpolateInferno),
  rdbu:      buildLUT(interpolateRdBu),
  grayscale: buildLUT(interpolateGreys),
};

/**
 * Sample a colormap at t ∈ [0,1]. Returns 0xRRGGBB.
 * t is clamped — safe to call with any number.
 */
export function sample(name: ColormapName, t: number): number {
  const idx = Math.round(Math.max(0, Math.min(1, t)) * 255);
  return LUTS[name][idx]!;
}

export const COLORMAP_NAMES: ColormapName[] = [
  'turbo', 'viridis', 'plasma', 'magma', 'inferno', 'rdbu', 'grayscale',
];

export const COLORMAP_LABELS: Record<ColormapName, string> = {
  turbo:     'Turbo',
  viridis:   'Viridis',
  plasma:    'Plasma',
  magma:     'Magma',
  inferno:   'Inferno',
  rdbu:      'RdBu',
  grayscale: 'Grayscale',
};
```

- [ ] **Step 2: Type-check ColormapRegistry in isolation**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i "ColormapRegistry"
```

Expected: no errors mentioning `ColormapRegistry.ts`.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/scene/ColormapRegistry.ts && git commit -m "feat: add ColormapRegistry with d3-based LUTs for all 7 colormaps"
```

---

## Chunk 2: Core rendering — ColorMapper, CellRenderer, AppState

### Task 4: Update `ColorMapper.ts`

**Files:**
- Modify: `frontend/src/scene/ColorMapper.ts`

Remove the hardcoded `TURBO_16`, `COOLWARM` arrays and `lerpColor`/`coolwarmColor` helpers. Import `sample` from the registry. Add `treeId` mode. Update `forCell()` signature.

- [ ] **Step 1: Replace `frontend/src/scene/ColorMapper.ts` entirely**

```ts
import type { CellRecord, ColorMode, ColormapName } from '../types';
import {
  CELL_FLAG_IS_LOCAL,
  CELL_FLAG_HAS_BEEN_ENCLAVE, CELL_FLAG_WILL_BE_ENCLAVE,
  CELL_FLAG_HAS_BEEN_REFINED, CELL_FLAG_WILL_BE_REFINED,
} from '../types';
import { sample } from './ColormapRegistry';
import * as THREE from 'three';

export class ColorMapper {
  private _color = new THREE.Color();

  /**
   * Return a Three.js Color for a cell given the current mode and options.
   *
   * @param colormap  Which LUT to use for continuous modes (ignored for treeId).
   * @param simMin    Min value for sim normalization.
   * @param simMax    Max value for sim normalization.
   * @param simFieldIndex  Which field in cell.simData to use.
   * @param maxLevel  Max AMR level in current snapshot (for level mode normalization).
   */
  forCell(
    cell: CellRecord,
    mode: ColorMode,
    colormap: ColormapName,
    simMin: number,
    simMax: number,
    simFieldIndex: number,
    maxLevel: number,
  ): THREE.Color {
    let hex: number;

    switch (mode) {
      case 'level': {
        const t = maxLevel > 0 ? cell.level / maxLevel : 0;
        hex = sample(colormap, t);
        break;
      }

      case 'local':
        hex = sample(colormap, (cell.flags & CELL_FLAG_IS_LOCAL) ? 1.0 : 0.0);
        break;

      case 'enclave': {
        let t = 0.5; // neither
        if (cell.flags & CELL_FLAG_HAS_BEEN_ENCLAVE) t = 1.0;
        else if (cell.flags & CELL_FLAG_WILL_BE_ENCLAVE) t = 0.75;
        hex = sample(colormap, t);
        break;
      }

      case 'refinement': {
        let t = 0.0; // neither refined
        if (cell.flags & CELL_FLAG_WILL_BE_REFINED) t = 1.0;
        else if (cell.flags & CELL_FLAG_HAS_BEEN_REFINED) t = 0.5;
        hex = sample(colormap, t);
        break;
      }

      case 'sim': {
        const val = cell.simData?.[simFieldIndex] ?? 0;
        const t = simMax !== simMin ? (val - simMin) / (simMax - simMin) : 0.5;
        hex = sample(colormap, t);
        break;
      }

      case 'treeId': {
        // Golden-angle hue hashing — gives well-separated hues for any set of integers.
        // Ignores the colormap parameter by design.
        const hue = (cell.treeId * 137.508) % 360;
        return this._color.setHSL(hue / 360, 0.65, 0.55);
      }

      default:
        hex = 0x888888;
    }

    return this._color.set(hex);
  }

  /** Compute min/max of a sim field across all cells. */
  static simRange(cells: CellRecord[], fieldIndex: number): [number, number] {
    let min = Infinity, max = -Infinity;
    for (const c of cells) {
      const v = c.simData?.[fieldIndex];
      if (v !== undefined) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min === max) max = min + 1;
    return [min, max];
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i "ColorMapper"
```

Expected: no errors in `ColorMapper.ts`. Errors may still exist in `CellRenderer.ts` (next task).

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/scene/ColorMapper.ts && git commit -m "feat: update ColorMapper to use ColormapRegistry, add treeId mode"
```

---

### Task 5: Update `CellRenderer.ts`

**Files:**
- Modify: `frontend/src/scene/CellRenderer.ts`

Update `updateFromSnapshot()` signature, add `lastSimRange` property, update `passesFilter()` for new `FilterSpec`.

- [ ] **Step 1: Replace `frontend/src/scene/CellRenderer.ts` entirely**

```ts
import * as THREE from 'three';
import type { CellRecord, FilterSpec, ColorMode, ColormapName } from '../types';
import { CELL_FLAG_IS_LOCAL } from '../types';
import { ColorMapper } from './ColorMapper';

// Pre-allocated instance count. 500K × ~76 bytes ≈ 38 MB GPU — fits comfortably
// on any modern GPU. Do NOT raise to 2M+: large allocations silently fail in
// some WebGL implementations (SwiftShader, some mobile drivers).
const MAX_INSTANCES = 500_000;
const CELL_GAP = 0.95; // scale factor to leave a small visible gap

/**
 * Renders AMR cells as instanced axis-aligned boxes.
 *
 * Uses THREE.InstancedMesh for performance. Per-instance position/scale is set
 * via setMatrixAt; per-instance color via setColorAt.
 */
export class CellRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly mapper = new ColorMapper();
  private currentCells: CellRecord[] = [];

  /** Set after every updateFromSnapshot call in 'sim' mode; [0,1] otherwise. */
  lastSimRange: [number, number] = [0, 1];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Disable frustum culling: the base geometry's bounding sphere is a unit cube
    // at the origin, which may lie outside the camera frustum for a 2D top-down
    // camera. All instances are within [0,1]³ so culling has no benefit here.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Replace the currently rendered cells with a new snapshot. */
  updateFromSnapshot(
    cells: CellRecord[],
    filter: FilterSpec,
    colorMode: ColorMode,
    colormap: ColormapName,
    simFieldIndex: number,
    maxLevel: number,
  ): void {
    const [simMin, simMax] = colorMode === 'sim'
      ? ColorMapper.simRange(cells, simFieldIndex)
      : [0, 1];
    this.lastSimRange = [simMin, simMax];

    let count = 0;
    const filtered: CellRecord[] = [];

    for (const c of cells) {
      if (!this.passesFilter(c, filter)) continue;
      if (count >= MAX_INSTANCES) break;

      this.dummy.position.set(c.cx, c.cy, c.cz);
      // For 2D cells (hz ≈ 0), use a very thin z extent so they're still pickable
      const scaleZ = c.hz > 0.0001 ? c.hz * CELL_GAP : 0.001;
      this.dummy.scale.set(c.hx * CELL_GAP, c.hy * CELL_GAP, scaleZ);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);

      const color = this.mapper.forCell(c, colorMode, colormap, simMin, simMax, simFieldIndex, maxLevel);
      this.mesh.setColorAt(count, color);

      filtered.push(c);
      count++;
    }

    this.currentCells = filtered;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Get the CellRecord for a given instance index (set by last updateFromSnapshot). */
  getCellAt(instanceId: number): CellRecord | null {
    return this.currentCells[instanceId] ?? null;
  }

  getCells(): CellRecord[] {
    return this.currentCells;
  }

  private passesFilter(c: CellRecord, f: FilterSpec): boolean {
    const levelOk = f.levelCumulative ? c.level <= f.level : c.level === f.level;
    if (!levelOk) return false;
    const isLocal = (c.flags & CELL_FLAG_IS_LOCAL) !== 0;
    if (isLocal && !f.showLocal) return false;
    if (!isLocal && !f.showRemote) return false;
    return true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "CellRenderer|ColorMapper"
```

Expected: no errors in these files.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/scene/CellRenderer.ts && git commit -m "feat: update CellRenderer with new signature, lastSimRange, cumulative level filter"
```

---

### Task 6: Update `AppState.ts`

**Files:**
- Modify: `frontend/src/store/AppState.ts`

Remove `minLevel`/`maxLevel` from the default filter. Add `selectedColormap`. Keep `simFieldIndex`.

- [ ] **Step 1: Update `frontend/src/store/AppState.ts`**

Replace the class body fields (preserve `onChange`/`setState`/`notify` methods unchanged):

```ts
import type { CellRecord, ColorMode, ColormapName, FilterSpec, SnapshotSummary } from '../types';

type Listener = () => void;

class AppStateStore {
  currentStep: number = -1;
  isLive: boolean = true;
  isPaused: boolean = false;
  totalSteps: number = 0;
  summaries: SnapshotSummary[] = [];
  registeredTrees: string[] = [];

  colorMode: ColorMode = 'level';
  colormap: ColormapName = 'turbo';
  filter: FilterSpec = { level: 4, levelCumulative: true, showLocal: true, showRemote: true };
  simFieldIndex: number = 0;

  selectedCell: CellRecord | null = null;
  selectedInstanceIndex: number = -1;

  private listeners: Listener[] = [];

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  setState(patch: Partial<AppStateStore>): void {
    Object.assign(this, patch);
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const AppState = new AppStateStore();
```

Note: the field is named `colormap` (not `selectedColormap`) — simpler and consistent with `colorMode`.

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "AppState"
```

Expected: no errors in `AppState.ts`. Errors may appear in `ControlPanel.ts` and `main.ts` (next tasks).

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/store/AppState.ts && git commit -m "feat: update AppState with colormap field, new FilterSpec defaults"
```

---

## Chunk 3: UI — ControlPanel, ColorbarOverlay, main.ts, index.html

### Task 7: Update `ControlPanel.ts`

**Files:**
- Modify: `frontend/src/ui/ControlPanel.ts`

Replace level min/max inputs with slider + cumulative checkbox. Add colormap selector (hidden for treeId). Add treeId to color mode options.

- [ ] **Step 1: Replace `frontend/src/ui/ControlPanel.ts` entirely**

```ts
import { AppState } from '../store/AppState';
import type { ColorMode, ColormapName, FilterSpec } from '../types';
import { COLORMAP_NAMES, COLORMAP_LABELS } from '../scene/ColormapRegistry';

/**
 * Left panel: color mode selector, colormap selector, level range filter,
 * local/remote toggles, tree list. All changes update AppState and call
 * the provided refresh callback.
 */
export class ControlPanel {
  private readonly el: HTMLElement;

  constructor(container: HTMLElement, private readonly onFilterChange: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'control-panel';
    container.appendChild(this.el);
    this.render();
  }

  private render(): void {
    const colormapOptions = COLORMAP_NAMES
      .map(n => `<option value="${n}">${COLORMAP_LABELS[n]}</option>`)
      .join('');

    this.el.innerHTML = `
      <div class="panel-section">
        <label class="label">COLOR MODE</label>
        <select id="colorMode">
          <option value="level">Level (depth)</option>
          <option value="local">Local / Remote</option>
          <option value="enclave">Enclave</option>
          <option value="refinement">Will Refine</option>
          <option value="sim">Sim Field</option>
          <option value="treeId">SpaceTree ID</option>
        </select>

        <div id="colormapRow" style="margin-top:4px">
          <label class="label">COLORMAP</label>
          <select id="colormap">${colormapOptions}</select>
        </div>

        <div id="simFieldRow" class="range-row" style="display:none;margin-top:4px">
          <span class="mono">field</span>
          <input type="number" id="simFieldIndex" min="0" max="99" value="0" class="num-input">
        </div>
      </div>

      <div class="panel-section">
        <label class="label">LEVEL FILTER</label>
        <div class="level-slider-row">
          <input type="range" id="levelSlider" min="0" max="12" value="${AppState.filter.level}" style="flex:1">
          <span id="levelValue" class="mono" style="min-width:2ch;text-align:right">${AppState.filter.level}</span>
        </div>
        <label class="checkbox-row" style="margin-top:4px">
          <input type="checkbox" id="levelCumulative" ${AppState.filter.levelCumulative ? 'checked' : ''}> cumulative (0–N)
        </label>
      </div>

      <div class="panel-section">
        <label class="label">VISIBILITY</label>
        <label class="checkbox-row">
          <input type="checkbox" id="showLocal" checked> local cells
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="showRemote" checked> remote cells
        </label>
      </div>

      <div class="panel-section" id="treeListSection">
        <label class="label">TREES</label>
        <div id="treeList" class="mono small">—</div>
      </div>
    `;

    const colormapRow = this.el.querySelector('#colormapRow') as HTMLElement;
    const simFieldRow = this.el.querySelector('#simFieldRow') as HTMLElement;
    const simFieldInput = this.el.querySelector('#simFieldIndex') as HTMLInputElement;

    // Sync select and visibility to current AppState on initial render
    const colorModeEl = this.el.querySelector('#colorMode') as HTMLSelectElement;
    colorModeEl.value = AppState.colorMode;
    colormapRow.style.display = AppState.colorMode === 'treeId' ? 'none' : '';
    simFieldRow.style.display = AppState.colorMode === 'sim' ? '' : 'none';

    // Color mode
    this.el.querySelector('#colorMode')!.addEventListener('change', e => {
      const mode = (e.target as HTMLSelectElement).value as ColorMode;
      AppState.setState({ colorMode: mode });
      colormapRow.style.display = mode === 'treeId' ? 'none' : '';
      simFieldRow.style.display = mode === 'sim' ? '' : 'none';
      this.onFilterChange();
    });

    // Colormap
    this.el.querySelector('#colormap')!.addEventListener('change', e => {
      const name = (e.target as HTMLSelectElement).value as ColormapName;
      AppState.setState({ colormap: name });
      this.onFilterChange();
    });

    // Sim field index
    simFieldInput.addEventListener('change', () => {
      AppState.setState({ simFieldIndex: parseInt(simFieldInput.value, 10) });
      this.onFilterChange();
    });

    // Level slider
    const levelSlider = this.el.querySelector('#levelSlider') as HTMLInputElement;
    const levelValue = this.el.querySelector('#levelValue') as HTMLSpanElement;
    const applyLevel = () => {
      const level = parseInt(levelSlider.value, 10);
      levelValue.textContent = String(level);
      AppState.setState({ filter: { ...AppState.filter, level } });
      this.onFilterChange();
    };
    levelSlider.addEventListener('input', applyLevel);

    // Cumulative toggle
    const levelCumulative = this.el.querySelector('#levelCumulative') as HTMLInputElement;
    levelCumulative.addEventListener('change', () => {
      AppState.setState({ filter: { ...AppState.filter, levelCumulative: levelCumulative.checked } });
      this.onFilterChange();
    });

    // Visibility
    this.el.querySelector('#showLocal')!.addEventListener('change', e => {
      AppState.setState({ filter: { ...AppState.filter, showLocal: (e.target as HTMLInputElement).checked } });
      this.onFilterChange();
    });
    this.el.querySelector('#showRemote')!.addEventListener('change', e => {
      AppState.setState({ filter: { ...AppState.filter, showRemote: (e.target as HTMLInputElement).checked } });
      this.onFilterChange();
    });
  }

  updateTreeList(trees: string[]): void {
    const el = this.el.querySelector('#treeList');
    if (el) el.textContent = trees.length > 0 ? trees.join('\n') : '—';
  }
}
```

- [ ] **Step 2: Add `.level-slider-row` CSS to `index.html`**

Inside the `<style>` block in `index.html`, after the `.range-row` rule, add:

```css
.level-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.level-slider-row input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "ControlPanel"
```

Expected: no errors in `ControlPanel.ts`.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/ui/ControlPanel.ts index.html && git commit -m "feat: update ControlPanel — colormap select, level slider, cumulative toggle, treeId mode"
```

---

### Task 8: Create `ColorbarOverlay.ts`

**Files:**
- Create: `frontend/src/ui/ColorbarOverlay.ts`

A `<canvas>` element positioned absolutely in the bottom-right of the Three.js canvas wrapper. Draws a gradient strip + min/max labels. Hidden for categorical modes.

- [ ] **Step 1: Create `frontend/src/ui/ColorbarOverlay.ts`**

```ts
import type { ColormapName } from '../types';
import { sample } from '../scene/ColormapRegistry';

const BAR_WIDTH = 200;
const BAR_HEIGHT = 14;
const PADDING = { top: 18, right: 8, bottom: 8, left: 8 };
const CANVAS_WIDTH  = BAR_WIDTH  + PADDING.left + PADDING.right;
const CANVAS_HEIGHT = BAR_HEIGHT + PADDING.top  + PADDING.bottom;

/**
 * Draws a ParaView-style colorbar overlay over the Three.js canvas.
 * Positioned at bottom-right of the canvas wrapper.
 * Only visible for continuous color modes (level, sim).
 */
export class ColorbarOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvasWrapper: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width  = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    Object.assign(this.canvas.style, {
      position:        'absolute',
      bottom:          '12px',
      right:           '12px',
      pointerEvents:   'none',
      display:         'none',
      borderRadius:    '3px',
      border:          '1px solid #2e2e2e',
    });
    canvasWrapper.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Render the colorbar for a continuous mode. */
  update(colormap: ColormapName, min: number, max: number, label: string): void {
    const ctx = this.ctx;
    const x0 = PADDING.left;
    const y0 = PADDING.top;

    // Background
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = 'rgba(20,20,20,0.75)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Gradient bar — sample 5 stops from the LUT
    const grad = ctx.createLinearGradient(x0, 0, x0 + BAR_WIDTH, 0);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const hex = sample(colormap, t);
      const r = (hex >> 16) & 0xff;
      const g = (hex >>  8) & 0xff;
      const b =  hex        & 0xff;
      grad.addColorStop(t, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, BAR_WIDTH, BAR_HEIGHT);

    // Label (field name, centered above bar)
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), x0 + BAR_WIDTH / 2, 3);

    // Min / max value labels
    const fmt = (v: number) => Math.abs(v) < 1e4 && Math.abs(v) >= 0.001
      ? v.toPrecision(4)
      : v.toExponential(2);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#4a9eff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmt(min), x0, y0 + BAR_HEIGHT + 2);

    ctx.textAlign = 'right';
    ctx.fillText(fmt(max), x0 + BAR_WIDTH, y0 + BAR_HEIGHT + 2);

    this.canvas.style.display = 'block';
  }

  hide(): void {
    this.canvas.style.display = 'none';
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "ColorbarOverlay"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/ui/ColorbarOverlay.ts && git commit -m "feat: add ColorbarOverlay canvas component (ParaView-style)"
```

---

### Task 9: Update `main.ts` and `index.html`

**Files:**
- Modify: `frontend/src/main.ts`
- Modify: `frontend/index.html`

Wire up `ColorbarOverlay`, wrap canvas in `#canvas-wrap`, pass new params to `updateFromSnapshot`.

> **Note:** `AppState` uses `colormap` (not `selectedColormap`). The plan is the source of truth here — ignore any `selectedColormap` references if reading the spec directly.

- [ ] **Step 1: Update CSS in `index.html`**

In the `<style>` block, replace the existing `#canvas` rule with:

```css
#canvas-wrap {
  grid-area: canvas;
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

#canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

Also update the `#app` grid template — replace the `"left canvas right"` grid-area so `canvas-wrap` takes the `canvas` slot (no change needed — `#canvas-wrap` uses `grid-area: canvas` so it inherits the existing template).

- [ ] **Step 2: Replace `frontend/src/main.ts` entirely**

```ts
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
```

- [ ] **Step 3: Full type-check — expect zero errors**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no output (exit code 0). If errors appear, fix them before proceeding.

- [ ] **Step 4: Install Playwright if not already present**

```bash
cd frontend && npm install --save-dev playwright && npx playwright install chromium --with-deps
```

Expected: exits 0 and prints "chromium ... downloaded".

- [ ] **Step 5: Start dev server and do a visual smoke test with Playwright**

Start the backend and frontend in separate terminals (or background):

```bash
# Terminal 1
cd backend && npx ts-node src/server.ts &
# Terminal 2
cd frontend && npm run dev &
# Wait a moment for servers to start
sleep 3
```

Then run a Playwright smoke test to verify the UI loads without JS errors:

```bash
cd frontend && npx playwright test --reporter=line 2>/dev/null || \
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  console.log('JS errors:', errors.length === 0 ? 'NONE' : errors.join('\n'));
  // Verify colormap select exists
  const colormapSel = await page.\$('#colormap');
  console.log('Colormap select found:', colormapSel !== null);
  // Verify level slider exists
  const slider = await page.\$('#levelSlider');
  console.log('Level slider found:', slider !== null);
  await browser.close();
})();
"
```

Expected:
- `JS errors: NONE`
- `Colormap select found: true`
- `Level slider found: true`

- [ ] **Step 6: Send test data and verify colorbar appears**

In a separate terminal, run the test sender with cell data:

```bash
cd backend && python3 test_sender.py --cell-data
```

Back in Playwright:

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3000); // wait for snapshot to load
  // Switch to 'level' mode (already default) — colorbar should be visible
  const colorbarVisible = await page.evaluate(() => {
    const canvases = document.querySelectorAll('#canvas-wrap canvas');
    // The overlay canvas is the second one (Three.js is first)
    for (const c of canvases) {
      const el = c as HTMLCanvasElement;
      if (el.id !== 'canvas' && el.style.display !== 'none') return true;
    }
    return false;
  });
  console.log('Colorbar visible in level mode:', colorbarVisible);
  // Switch to treeId mode — colorbar should hide
  await page.select('#colorMode', 'treeId');
  await page.waitForTimeout(500);
  const colorbarHidden = await page.evaluate(() => {
    const canvases = document.querySelectorAll('#canvas-wrap canvas');
    for (const c of canvases) {
      const el = c as HTMLCanvasElement;
      if (el.id !== 'canvas') return el.style.display === 'none';
    }
    return false;
  });
  console.log('Colorbar hidden in treeId mode:', colorbarHidden);
  await browser.close();
})();
"
```

Expected:
- `Colorbar visible in level mode: true`
- `Colorbar hidden in treeId mode: true`

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/main.ts index.html && git commit -m "feat: wire ColorbarOverlay, canvas-wrap, new updateFromSnapshot params"
```

---

### Task 10: Mark task complete and start td review workflow

- [ ] **Step 1: Run final type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 2: Mark td task as implemented and submit for review**

```bash
td start td-e13a11 && td log "Implemented all 5 features: colormaps via d3 LUT registry, level slider + cumulative toggle, treeId hue mode, colorbar overlay" && td handoff td-e13a11
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `cd frontend && npx tsc --noEmit` | Type-check without building |
| `cd frontend && npm run dev` | Start Vite dev server (localhost:5173) |
| `cd backend && npx ts-node src/server.ts` | Start backend (TCP 7421, WS 7422) |
| `cd backend && python3 test_sender.py --cell-data` | Send test snapshot with sim data |
| `cd backend && python3 test_sender.py` | Send test snapshot without sim data |
