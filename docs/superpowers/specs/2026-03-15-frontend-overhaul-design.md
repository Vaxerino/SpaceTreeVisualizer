# Frontend Overhaul Design

**Task:** td-e13a11
**Date:** 2026-03-15
**Status:** Approved

---

## Overview

Five improvements to the SpaceTreeVisualizer frontend:

1. Selectable colormaps per color mode (via d3-scale-chromatic LUT registry)
2. Level filter redesigned as single slider + cumulative toggle
3. `treeId` color mode (hue-hashed, one distinct color per tree)
4. Sim data correctly mapped through chosen colormap
5. Colorbar legend overlay on the canvas (ParaView-style)

Cell selection via raycasting is already implemented (`PickingHelper`, `SelectionHighlight`, `DetailPanel`). No changes needed there.

---

## Types (`types.ts`)

### `ColormapName`

New union type covering all supported colormaps:

```ts
export type ColormapName =
  'turbo'   | 'viridis' | 'plasma' | 'magma' |
  'inferno' | 'rdbu'    | 'grayscale';
```

### `ColorMode`

Add `'treeId'` to the existing union:

```ts
export type ColorMode = 'level' | 'local' | 'enclave' | 'refinement' | 'sim' | 'treeId';
```

### `FilterSpec`

Replace `minLevel`/`maxLevel` with a single-level + cumulative model:

```ts
export interface FilterSpec {
  level: number;            // selected AMR level
  levelCumulative: boolean; // if true, show levels 0..level; if false, show only level
  showLocal: boolean;
  showRemote: boolean;
}
```

Default: `{ level: 4, levelCumulative: true, showLocal: true, showRemote: true }`.

---

## `ColormapRegistry.ts` (new file — `frontend/src/scene/`)

Pure module with no mutable state. Builds a 256-entry `number[]` LUT for each colormap at module load time by calling d3-scale-chromatic interpolators. All entries use the same `buildLUT` pattern — no special cases at runtime.

```ts
import {
  interpolateTurbo, interpolateViridis, interpolatePlasma,
  interpolateMagma, interpolateInferno, interpolateGreys,
  interpolateRdBu,
} from 'd3-scale-chromatic';

function buildLUT(fn: (t: number) => string): number[] {
  // Calls fn(i/255) for i in 0..255, parses "rgb(r,g,b)" → 0xRRGGBB
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

/** Sample a colormap at t ∈ [0,1], returns 0xRRGGBB. */
export function sample(name: ColormapName, t: number): number {
  return LUTS[name][Math.round(Math.max(0, Math.min(1, t)) * 255)]!;
}

export const COLORMAP_NAMES: ColormapName[] =
  ['turbo', 'viridis', 'plasma', 'magma', 'inferno', 'rdbu', 'grayscale'];

export const COLORMAP_LABELS: Record<ColormapName, string> = {
  turbo: 'Turbo', viridis: 'Viridis', plasma: 'Plasma', magma: 'Magma',
  inferno: 'Inferno', rdbu: 'RdBu', grayscale: 'Grayscale',
};
```

Runtime lookup is O(1) — no string parsing per cell during render.

---

## `ColorMapper.ts` (modified)

- Remove the hardcoded `TURBO_16` and `COOLWARM` arrays and `lerpColor`/`coolwarmColor` helpers.
- Import `sample` from `ColormapRegistry`.
- `forCell()` signature gains a `colormap: ColormapName` parameter.

### Level mode — intentional behavior change

Previously, level was mapped via `TURBO_16[level % 16]` (16-color cycling, fixed to Turbo). After this change, level is mapped as `t = level / maxLevel` through the selected colormap LUT, where `maxLevel` is passed in by the caller. This removes the modulo cycling and enables any colormap — this is an intentional improvement.

### `'treeId'` case

Uses golden-angle hue hashing — ignores the `colormap` parameter entirely:

```ts
case 'treeId': {
  const hue = (cell.treeId * 137.508) % 360;
  return this._color.setHSL(hue / 360, 0.65, 0.55);
}
```

### `'sim'` case — absent data fallback

When `cell.simData` is undefined or the requested field index is out of range, use `val = 0` (maps to the minimum color of the scale). This matches the existing `?? 0` behavior. Absent-data cells will appear identical to minimum-value cells, which is acceptable — a distinct sentinel color is out of scope.

### Updated `forCell()` signature

```ts
forCell(
  cell: CellRecord,
  mode: ColorMode,
  colormap: ColormapName,
  simMin: number,
  simMax: number,
  simFieldIndex: number,
  maxLevel: number,
): THREE.Color
```

---

## `CellRenderer.ts` (modified)

### `updateFromSnapshot()` signature

Full updated signature:

```ts
updateFromSnapshot(
  cells: CellRecord[],
  filter: FilterSpec,
  colorMode: ColorMode,
  colormap: ColormapName,
  simFieldIndex: number,
  maxLevel: number,
): void
```

`maxLevel` is passed in from `main.ts` (computed from `cells`). `colormap` and `maxLevel` are forwarded to `ColorMapper.forCell()`.

### `lastSimRange` property

`CellRenderer` exposes a public `lastSimRange: [number, number] = [0, 1]` property, set during each call to `updateFromSnapshot()` when `colorMode === 'sim'`. `main.ts` reads this property after calling `updateFromSnapshot()` to supply the colorbar min/max. This avoids duplicating the `simRange()` calculation in `main.ts`.

### `passesFilter()` updated

```ts
private passesFilter(c: CellRecord, f: FilterSpec): boolean {
  const levelOk = f.levelCumulative ? c.level <= f.level : c.level === f.level;
  if (!levelOk) return false;
  const isLocal = (c.flags & CELL_FLAG_IS_LOCAL) !== 0;
  if (isLocal && !f.showLocal) return false;
  if (!isLocal && !f.showRemote) return false;
  return true;
}
```

---

## `AppState.ts` (modified)

### Fields to remove

- `filter.minLevel` — replaced by `filter.level`
- `filter.maxLevel` — replaced by `filter.levelCumulative`

### Fields to add

- `colormap: ColormapName = 'turbo'`

### Updated default filter

```ts
filter: FilterSpec = { level: 4, levelCumulative: true, showLocal: true, showRemote: true };
```

### Retained fields

`simFieldIndex: number = 0` is retained unchanged.

---

## `ControlPanel.ts` (modified)

### Color Mode selector

Gains a `'treeId'` option: `<option value="treeId">SpaceTree ID</option>`.

### Colormap selector

New `<select>` rendered directly below the color mode selector, populated from `COLORMAP_NAMES`/`COLORMAP_LABELS`. Hidden (`style.display = 'none'`) when `colorMode === 'treeId'`. On change: `AppState.setState({ colormap })` → `onFilterChange()`.

### Level filter — full replacement

The **entire** level-filter section of `ControlPanel.render()` is replaced. The existing `levelMin`/`levelMax` inputs, `applyLevels` handler, and all related query selectors are removed. Replacement:

```html
<div class="panel-section">
  <label class="label">LEVEL FILTER</label>
  <div class="level-slider-row">
    <input type="range" id="levelSlider" min="0" max="12" value="4">
    <span id="levelValue" class="mono">4</span>
  </div>
  <label class="checkbox-row">
    <input type="checkbox" id="levelCumulative" checked> cumulative (0–N)
  </label>
</div>
```

The slider fires on `input` (live, while dragging). The `levelValue` span updates in sync. The checkbox toggles `filterSpec.levelCumulative`. On any change: `AppState.setState({ filter: { ...AppState.filter, level, levelCumulative } })` → `onFilterChange()`.

---

## `ColorbarOverlay.ts` (new file — `frontend/src/ui/`)

A `<canvas>` element absolutely positioned over the canvas wrapper div (see layout change below).

**Appearance (ParaView-style):**
- 200px wide × 14px gradient strip
- Semi-transparent dark background: `rgba(20,20,20,0.75)`, 1px border `#2e2e2e`
- Min and max value labels flanking the bar (JetBrains Mono, 10px, `#4a9eff`)
- Field label centered above (uppercase, 9px, `#888`)
- Position: `bottom: 12px; right: 12px; position: absolute`

**Visibility:**
- Shown for `level` and `sim` modes.
- Hidden (`canvas.style.display = 'none'`) for `local`, `enclave`, `refinement`, `treeId`.

**Interface:**

```ts
class ColorbarOverlay {
  constructor(canvasWrapper: HTMLElement) { ... }
  update(colormap: ColormapName, min: number, max: number, label: string): void
  hide(): void
}
```

The gradient is drawn using `ctx.createLinearGradient` with 5 stops at t = 0, 0.25, 0.5, 0.75, 1.0 sampled from `ColormapRegistry.sample()`.

---

## Layout change — canvas wrapper div (`main.ts` + `index.html`)

`ColorbarOverlay` requires `position: absolute` inside a `position: relative` container. The `<canvas id="canvas">` is currently a direct CSS Grid child of `#app` — appending an absolutely-positioned overlay to `#app` would position it relative to `<body>`, not the canvas cell.

**Fix:** Wrap the canvas in a div in `main.ts`:

```ts
// In main.ts, replace:
app.innerHTML = `
  <div id="left-panel"></div>
  <canvas id="canvas"></canvas>
  ...
`;

// With:
app.innerHTML = `
  <div id="left-panel"></div>
  <div id="canvas-wrap">
    <canvas id="canvas"></canvas>
  </div>
  ...
`;
```

Add to `index.html` styles:

```css
#canvas-wrap {
  grid-area: canvas;
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;  /* required so #canvas height:100% resolves correctly */
}
#canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

`SceneManager` receives `document.getElementById('canvas')` as before — no change to the Three.js setup.

---

## `main.ts` (modified)

- Wrap canvas in `#canvas-wrap` as described above.
- Instantiate `ColorbarOverlay`, passing `document.getElementById('canvas-wrap')`.
- Pass `AppState.colormap` and `maxLevel` to `cellRenderer.updateFromSnapshot()`.
- `maxLevel` is computed from `currentSnapshot.cells` with an empty-array guard:
  `const maxLevel = cells.length > 0 ? Math.max(...cells.map(c => c.level)) : 0;`
  (Using `Math.max(0, ...emptyArray)` returns `-Infinity` in JavaScript — the explicit guard is required.)
- After each `updateFromSnapshot()`, update or hide the colorbar:

```ts
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
```

---

## Files Changed

| File | Type |
|------|------|
| `frontend/src/types.ts` | Modified |
| `frontend/src/store/AppState.ts` | Modified |
| `frontend/src/scene/ColormapRegistry.ts` | **New** |
| `frontend/src/scene/ColorMapper.ts` | Modified |
| `frontend/src/scene/CellRenderer.ts` | Modified |
| `frontend/src/ui/ControlPanel.ts` | Modified |
| `frontend/src/ui/ColorbarOverlay.ts` | **New** |
| `frontend/src/main.ts` | Modified |
| `frontend/index.html` | Modified (canvas-wrap CSS) |

Unchanged: `DetailPanel`, `SelectionHighlight`, `PickingHelper`, `SceneManager`, `WebSocketClient`, `SnapshotCache`, `TimelineBar`.

---

## Dependencies

Add to `frontend/package.json`:

```
d3-scale-chromatic        ^3.1.0
@types/d3-scale-chromatic ^3.0.0   (devDependency)
```

---

## Out of Scope

- Spatial level separation in cumulative mode (tracked as td-5bf7f3)
- Phase 2 timeline/pause controls
- Face + vertex rendering
- Multi-rank TreeSelector
