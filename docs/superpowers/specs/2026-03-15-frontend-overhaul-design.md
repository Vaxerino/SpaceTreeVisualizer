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
  'turbo' | 'viridis' | 'plasma' | 'magma' |
  'inferno' | 'coolwarm' | 'rdbu' | 'grayscale';
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
  level: number;           // selected AMR level
  levelCumulative: boolean; // if true, show levels 0..level; if false, show only level
  showLocal: boolean;
  showRemote: boolean;
}
```

Default: `{ level: 4, levelCumulative: true, showLocal: true, showRemote: true }`.

---

## `ColormapRegistry.ts` (new file — `frontend/src/scene/`)

Pure module with no mutable state. Builds a 256-entry `number[]` LUT for each colormap at module load time by calling d3-scale-chromatic interpolators. All colormaps are uniform — no special cases.

```ts
import {
  interpolateTurbo, interpolateViridis, interpolatePlasma,
  interpolateMagma, interpolateInferno, interpolateGreys,
  interpolateRdBu, interpolateCool,
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
  coolwarm:  buildLUT(interpolateCool),
  rdbu:      buildLUT(interpolateRdBu),
  grayscale: buildLUT(interpolateGreys),
};

/** Sample a colormap at t ∈ [0,1], returns 0xRRGGBB. */
export function sample(name: ColormapName, t: number): number {
  return LUTS[name][Math.round(Math.max(0, Math.min(1, t)) * 255)]!;
}

export const COLORMAP_NAMES: ColormapName[] =
  ['turbo', 'viridis', 'plasma', 'magma', 'inferno', 'coolwarm', 'rdbu', 'grayscale'];

export const COLORMAP_LABELS: Record<ColormapName, string> = {
  turbo: 'Turbo', viridis: 'Viridis', plasma: 'Plasma', magma: 'Magma',
  inferno: 'Inferno', coolwarm: 'Coolwarm', rdbu: 'RdBu', grayscale: 'Grayscale',
};
```

Runtime lookup is O(1) — no string parsing per cell during render.

---

## `ColorMapper.ts` (modified)

- Remove hardcoded `TURBO_16` and `COOLWARM` arrays.
- Import `sample` from `ColormapRegistry`.
- `forCell()` gains a `colormap: ColormapName` parameter, used for all continuous modes.
- Add `'treeId'` case: golden-angle hue hashing — `hue = (cell.treeId * 137.508) % 360`. Ignores `colormap` (treeId coloring is always hue-based, not LUT-based).

```ts
case 'treeId': {
  const hue = (cell.treeId * 137.508) % 360;
  return this._color.setHSL(hue / 360, 0.65, 0.55);
}
```

All other continuous modes (`level`, `local`, `enclave`, `refinement`, `sim`) use `sample(colormap, t)` to get their hex value, where `t` is computed per mode as before.

---

## `CellRenderer.ts` (modified)

- `updateFromSnapshot()` gains `colormap: ColormapName` parameter, passed through to `ColorMapper.forCell()`.
- `passesFilter()` updated for new `FilterSpec` shape:
  - Cumulative off: `c.level === f.level`
  - Cumulative on: `c.level <= f.level`
  - `showLocal` / `showRemote` checks unchanged.

---

## `AppState.ts` (modified)

Add:

```ts
selectedColormap: ColormapName = 'turbo';
```

Default filter updated to `{ level: 4, levelCumulative: true, showLocal: true, showRemote: true }`.

---

## `ControlPanel.ts` (modified)

### Color Mode selector

Gains a `'treeId'` option: `<option value="treeId">SpaceTree ID</option>`.

### Colormap selector

New `<select>` rendered directly below the color mode selector, populated from `COLORMAP_NAMES`. Hidden (`display:none`) when `colorMode === 'treeId'` (hue hashing, no LUT applies). On change: `AppState.setState({ selectedColormap })` → `onFilterChange()`.

### Level filter (replaces min/max inputs)

```html
<label class="label">LEVEL FILTER</label>
<div class="level-slider-row">
  <input type="range" id="levelSlider" min="0" max="12" value="4">
  <span id="levelValue" class="mono">4</span>
</div>
<label class="checkbox-row">
  <input type="checkbox" id="levelCumulative" checked> cumulative (0–N)
</label>
```

Slider fires `input` event (live update while dragging). Value display updates in sync. Checkbox toggles `filterSpec.levelCumulative`.

---

## `ColorbarOverlay.ts` (new file — `frontend/src/ui/`)

A `<canvas>` element absolutely positioned over the Three.js canvas area, in the bottom-right corner.

**Appearance (ParaView-style):**
- 200px wide × 14px gradient strip
- Semi-transparent dark background: `rgba(20,20,20,0.75)`, 1px border `#2e2e2e`
- Min and max value labels above left/right ends of the bar (JetBrains Mono, 10px)
- Field label centered above the bar (uppercase, 9px, `#888`)
- Positioned: `bottom: 12px; right: 12px`

**Visibility:**
- Shown for `level` and `sim` modes.
- Hidden for `local`, `enclave`, `refinement`, `treeId` (categorical — no scalar range).

**Interface:**

```ts
class ColorbarOverlay {
  constructor(canvasContainer: HTMLElement) { ... }
  update(colormap: ColormapName, min: number, max: number, label: string): void
  hide(): void
}
```

The gradient is drawn on the canvas using `createLinearGradient` with stops sampled from the LUT at 0, 0.25, 0.5, 0.75, 1.0.

---

## `main.ts` (modified)

- Instantiate `ColorbarOverlay`, passing the canvas container element.
- In `reapplyFilter()` and `loadAndDisplay()`: pass `AppState.selectedColormap` to `cellRenderer.updateFromSnapshot()`.
- After each render update, call `colorbar.update(...)` or `colorbar.hide()` based on the active color mode:
  - `level`: `update(colormap, 0, maxLevel, 'level')`
  - `sim`: `update(colormap, simMin, simMax, 'field[N]')`
  - others: `hide()`

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

Unchanged: `DetailPanel`, `SelectionHighlight`, `PickingHelper`, `SceneManager`, `WebSocketClient`, `SnapshotCache`, `TimelineBar`.

---

## Dependencies

Add to `frontend/package.json`:

```
d3-scale-chromatic   ^3.1.0
@types/d3-scale-chromatic   ^3.0.0   (devDependency)
```

---

## Out of Scope

- Spatial level separation in cumulative mode (tracked as td-5bf7f3)
- Phase 2 timeline/pause controls
- Face + vertex rendering
- Multi-rank TreeSelector
