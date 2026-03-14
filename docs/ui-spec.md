# SpaceTreeVisualizer — Frontend UI Specification

## Design Philosophy

The UI is a developer tool, not a visualization product. The aesthetic is informed by ParaView, VS Code, and GPU debuggers — dark, flat, information-dense, with no decoration. Every pixel either shows data or provides a control. No gradients, no glow effects, no rounded card shadows.

The user is a simulation scientist or HPC developer. They know what AMR levels are. The UI shows raw values (hex flags, float coordinates) alongside human-readable decoded names. It never hides complexity behind smooth interpolated abstractions.

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ left panel (240px) │       canvas (flex)       │ right panel (260px) │
│                    │                            │                     │
│  status indicator  │   Three.js WebGLRenderer   │  SELECTED CELL      │
│  ─────────────     │                            │  ─────────────      │
│  COLOR MODE        │   OrbitControls            │  centre (float32×3) │
│  <select>          │   InstancedMesh cells      │  x  0.170000        │
│                    │   EdgesGeometry highlight  │  y  0.500000        │
│  LEVEL FILTER      │                            │  z  0.830000        │
│  min [0]  max [12] │                            │  ─────────────      │
│                    │                            │  size h (float32×3) │
│  VISIBILITY        │                            │  ...                │
│  ☑ local           │                            │                     │
│  ☑ remote          │                            │  FLAGS  0x0004      │
│                    │                            │  isLocal         ✓  │
│  TREES             │                            │  willBeRefined   ✗  │
│  0:0               │                            │  ...                │
│  0:1               │                            │                     │
├────────────────────┴────────────────────────────┴─────────────────────┤
│  bottom bar (36px)   LIVE  step 12  3847 cells       [Continue →]     │
└─────────────────────────────────────────────────────────────────────┘
```

Grid layout:
```css
#app {
  display: grid;
  grid-template-columns: 240px 1fr 260px;
  grid-template-rows: 1fr 36px;
  grid-template-areas:
    "left canvas right"
    "bottom bottom bottom";
  height: 100vh;
}
```

---

## Color Tokens

```css
:root {
  --bg:       #141414;   /* page / canvas background */
  --panel-bg: #1e1e1e;   /* panel fill */
  --border:   #2e2e2e;   /* panel borders, dividers */
  --text:     #c8c8c8;   /* primary text */
  --muted:    #666666;   /* secondary text, placeholders */
  --accent:   #4a9eff;   /* single blue accent: focus rings, links, Continue button */
  --label:    #888888;   /* uppercase section labels */
}
```

One accent color only. Do not introduce additional semantic colors (red for error, orange for warning). Status states are communicated via the status indicator text.

---

## Typography

| Use | Font | Size | Weight |
|-----|------|------|--------|
| Section labels (`COLOUR MODE`, `LEVEL FILTER`) | system-ui | 10px | 500 |
| Data values (coordinates, hex flags) | JetBrains Mono | 11–12px | 400 |
| UI labels (checkbox text, select options) | JetBrains Mono | 12px | 400 |
| Bottom bar text | JetBrains Mono | 11px | 400 |
| Button labels | JetBrains Mono | 12px | 400 |

All numeric values displayed in monospace. Section headers in uppercase with `letter-spacing: 0.08em`.

---

## Left Panel — Controls

### Status Indicator

Top of the left panel. Monospace badge showing connection state.

| State | CSS class | Text format | Color |
|-------|-----------|-------------|-------|
| Live | `.live` | `● LIVE  step 12  3847 cells` | `#44cc66` |
| Paused | `.paused` | `⏸ PAUSED — simulation waiting` | `#ffaa33` |
| Disconnected | `.disconnected` | `✗ disconnected` | `var(--muted)` |

Background: `#2a2a2a`. No border. Border-radius `3px`.

### Color Mode

Plain `<select>`:
```
Level (depth)
Local / Remote
Enclave
Will Refine
Sim Field [0]
Sim Field [1]
...
```

"Sim Field [N]" options are added dynamically when the backend reports `hasCellData` and the number of unknowns. In Phase 1 the sim field options are not shown.

### Level Filter

Two `<input type="number">` fields side by side: min (default 0) and max (default 12). On change, `CellRenderer.updateFromSnapshot` is called without re-fetching the snapshot (client-side filter).

### Visibility

Two checkboxes:
- `☑ local cells` — show cells where `IS_LOCAL` flag is set
- `☑ remote cells` — show cells where `IS_LOCAL` flag is not set

### Tree List

Monospace list of connected tree identifiers in `rank:treeId` format. Updated on each `tree_registered` WebSocket message. Shows `—` when no trees connected.

---

## Center — 3D Canvas

### Renderer

`THREE.WebGLRenderer` fills the canvas element (`width: 100%; height: 100%`). Clear color: `#141414`. Anti-aliasing enabled. Pixel ratio: `window.devicePixelRatio`.

### Camera

`THREE.PerspectiveCamera(fov=60)`. Default position: `(1.5, 1.5, 2.5)`, target: `(0.5, 0.5, 0.5)` (assumes domain `[0,1]^3`). OrbitControls with damping (`dampingFactor=0.1`).

### Lights

- `AmbientLight(0xffffff, 0.6)` — flat base illumination
- `DirectionalLight(0xffffff, 0.8)` at `(2, 3, 2)` — gentle shading to distinguish faces

No shadows (performance).

### Cell Rendering

`THREE.InstancedMesh` with `BoxGeometry(1,1,1)` and `MeshLambertMaterial({ vertexColors: true })`. Per-instance matrix encodes: translate to cell centre, scale to `h × 0.95`. The 5% gap makes cell boundaries visible without needing a wireframe overlay.

For 2D simulations (`dims=2`): z-scale is set to `0.001` so cells appear flat.

Max instances: 2,000,000. For larger grids the level filter should be used.

### Selection Highlight

`THREE.LineSegments` from `EdgesGeometry(BoxGeometry(1,1,1))`. Color `0xffffff`. `depthTest: false`, `renderOrder: 1` (always on top). Matrix copied from the selected instance via `mesh.getMatrixAt(id, matrix)`. Hidden when nothing is selected.

No animated outlines, no pulsing, no glow.

### Colormaps

**Level (Turbo, 16 colors):**

| Level | Hex     | Level | Hex     |
|-------|---------|-------|---------|
| 0     | 0x30123b | 8    | 0xfba209 |
| 1     | 0x4454c4 | 9    | 0xf15a08 |
| 2     | 0x3d87fb | 10   | 0xd83806 |
| 3     | 0x35b779 | 11   | 0xb21304 |
| 4     | 0x6ece58 | 12   | 0x900c03 |
| 5     | 0xa0da39 | 13   | 0x6e0802 |
| 6     | 0xd0e11c | 14   | 0x520601 |
| 7     | 0xfbe418 | 15   | 0x3b0400 |

Level wraps at 16 (`level % 16`).

**Local / Remote:**
- Local (`IS_LOCAL` set): `0x4a9eff` (accent blue)
- Remote: `0xcc4444`

**Enclave:**
- `HAS_BEEN_ENCLAVE`: `0xff9900`
- `WILL_BE_ENCLAVE`: `0xffcc44`
- Neither: `0x666666`

**Will Refine:**
- `WILL_BE_REFINED`: `0x44ff88`
- `HAS_BEEN_REFINED` only: `0x228844`
- Neither: `0x444444`

**Sim Field (Coolwarm, 9 stops, linearly interpolated):**

| t    | Hex     |
|------|---------|
| 0.0  | 0x3b4cc0 |
| 0.125| 0x6788ee |
| 0.25 | 0x9abbff |
| 0.375| 0xc9d8ef |
| 0.5  | 0xdddddd |
| 0.625| 0xf5c4ad |
| 0.75 | 0xf7a889 |
| 0.875| 0xe8735a |
| 1.0  | 0xce2826 |

`t = (value - min) / (max - min)`, clamped to [0, 1]. Min/max computed from the current snapshot's cells.

---

## Right Panel — Detail View

Shows decoded fields for the currently selected cell. Appears only after a cell is clicked; until then shows "click a cell" in muted text.

### Layout

HTML table with two columns: field name (left, muted monospace) and value (right, primary text monospace). Section headers between groups styled with `font-size: 9px; letter-spacing: 0.08em; color: var(--label); text-transform: uppercase; padding-top: 8px`.

### Sections

**CENTRE (float32×3)**
Six decimal places. `x`, `y`, `z` rows.

**SIZE H (float32×3)**
Six decimal places. `hx`, `hy`, `hz` rows.

**LEVEL (int16)**
Integer. Single row.

**FLAGS (uint16)**
Row header shows `FLAGS  0x0A2F` (hex, uppercase, 4 digits). Below: one row per named flag showing `✓` or `✗`.

Named flags shown (in order):
- `isLocal`
- `isParentLocal`
- `hasBeenRefined`
- `willBeRefined`
- `insideDomain`
- `willBeEnclave`
- `hasBeenEnclave`

**REL POS (int8×3)**
`x`, `y`, `z` rows. These are the relative position within the father cell (0 or 1 per axis).

**SOURCE**
`rank` and `treeId` rows.

**SIM DATA** (only when `hasCellData`)
Up to 8 rows showing `field[0]` through `field[7]`, values in scientific notation (`toExponential(4)`). If more than 8 fields, remaining are omitted with a `…` row.

---

## Bottom Bar — Timeline

Single 36px row across the full width.

**Phase 1 (live mode only):**

```
[ LIVE  step 12  3847 cells ]          [ Continue → ]
```

- Left: monospace status text
- Right: `Continue →` button, hidden unless backend reports `paused: true`

`Continue →` button: `background: #2a2a2a`, `border: 1px solid var(--border)`, `color: var(--accent)`. Hover: `background: #333; border-color: var(--accent)`.

**Phase 2 (timeline):**

```
[ ◀◀ ] [ ▶/⏸ ] [ ──────────●────── ] [ step 8 / 42 ]  [ Continue → ]
```

- `◀◀` previous step button
- `▶/⏸` play/pause (auto-advance every 200ms)
- Range input slider spanning steps 0..N
- Step counter `step N / M` in monospace
- Continue button (pause mode)

---

## WebSocket Message Contract (browser side)

### Inbound (server → browser)

| `type` | Fields | Effect |
|--------|--------|--------|
| `status` | `paused`, `liveStep`, `totalSteps`, `trees` | Update StatusIndicator, TreeList, timeline state |
| `step_committed` | `stepIndex`, `timestamp`, `cellCount`, `treeIds` | If live mode: fetch snapshot, re-render |
| `snapshot_data` | `stepIndex`, `cells`, `faces`, `vertices` | Direct snapshot delivery (Phase 2) |
| `tree_registered` | `rank`, `treeId`, `dims`, `hasCellData` | Add to tree list, update color mode options |
| `continue_ack` | — | Enable Continue button if still paused |

### Outbound (browser → server)

| `type` | Fields | When |
|--------|--------|------|
| `subscribe_live` | — | On WebSocket open |
| `get_snapshot` | `stepIndex` | On timeline step change |
| `get_latest` | — | On initial load |
| `continue` | — | On Continue button click |

---

## Interaction Model

| Action | Result |
|--------|--------|
| Click on a cell | White wireframe highlight appears; right panel shows decoded struct |
| Click on background | Highlight disappears; right panel shows "click a cell" |
| Change color mode | Cells re-colored immediately (no re-fetch) |
| Change level filter | Cells re-filtered immediately (no re-fetch) |
| Change visibility toggles | Cells re-filtered immediately (no re-fetch) |
| Scroll wheel | Zoom (OrbitControls) |
| Left drag | Orbit (OrbitControls) |
| Right drag | Pan (OrbitControls) |
| New `step_committed` event | If live: fetch snapshot, re-render cells, update status |
| Backend disconnects | StatusIndicator → disconnected; auto-reconnect every 2s |

---

## What the UI Does Not Do

- No tooltips or hover states on cells (hover picking is expensive on InstancedMesh)
- No cell outline on hover (adds per-frame raycasting)
- No animated transitions when cells appear/disappear
- No simulation-specific labels or field names beyond `field[N]` (the UI has no domain knowledge)
- No undo / history within a step
- No context menus
- No drag-to-select (box selection)
