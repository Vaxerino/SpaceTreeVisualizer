## MANDATORY: Use td for Task Management

You must run td usage --new-session at conversation start (or after /clear) to see current work.
Use td usage -q for subsequent reads.

---

## Project: SpaceTreeVisualizer

Real-time 3D browser debugger for Peano 4 / ExaHype 2 AMR simulations.
Streams the adaptive mesh from a running C++ simulation to a Three.js browser frontend.

**Full documentation:** `docs/` — read these before writing code.

| Doc | Contents |
|-----|----------|
| `docs/architecture.md` | System overview, component diagram, data flow, ports, Phase 1/2 scope |
| `docs/protocol.md` | Binary wire protocol: handshake, frame format, all payload layouts, bitmasks |
| `docs/peano4-exahype2-reference.md` | Peano4/ExaHype2 internals: ActionSet API, markers, data access, threading/MPI |
| `docs/ui-spec.md` | Frontend layout, color tokens, colormaps, interaction model |

---

## Architecture (summary)

```
[ExaHype2 simulation]
  SpaceTreeVisualizerActionSet (added via project.add_action_set_to_*)
    └─ C++ sender (Jinja2-generated) ──TCP :7421──▶ [Node.js backend]
                                                         ├─ WebSocket :7422 ──▶ [Three.js browser]
                                                         └─ REST /api/*   ──▶ [Three.js browser]
```

Three components, three processes:
- `spacetree_visualizer/` — Python `ActionSet` subclass + Jinja2 C++ templates
- `backend/` — Node.js/TypeScript, TCP + WebSocket + REST
- `frontend/` — Three.js + Vite + TypeScript, three-column layout

---

## Peano / ExaHype 2

**Source tree:** `/mnt/Megafast/Peano`

Key files for plugin development:
- `/mnt/Megafast/Peano/python/peano4/solversteps/ActionSet.py` — base class, operation name constants
- `/mnt/Megafast/Peano/python/peano4/plotter/BasePlotter.py` — canonical pattern for static hooks + Jinja2
- `/mnt/Megafast/Peano/python/exahype2/Project.py` — `add_action_set_to_timestepping/initialisation/create_grid`
- `/mnt/Megafast/Peano/python/exahype2/solvers/fv/FV.py` — solver data models, `_unknown_identifier()`, `_patch`
- `/mnt/Megafast/Peano/src/peano4/datamanagement/CellMarker.h` — cell flags, position, refinement state
- `/mnt/Megafast/Peano/src/tarch/plotter/VTUFileWriter.cpp` — `#ifdef USE_ZLIB` pattern to copy

User adds the action set in their simulation script:
```python
project.add_action_set_to_timestepping(
    SpaceTreeVisualizerActionSet(solver=my_solver, host="127.0.0.1", port=7421)
)
```

---

## Backend

**Stack:** Node.js 20, TypeScript, `ws`, `express`
**Entry:** `cd backend && npx ts-node src/server.ts`
**Ports:** TCP 7421 (C++ senders), HTTP+WS 7422 (browser)
**Test sender:** `python3 backend/test_sender.py [--cell-data]` (requires backend running; `--cell-data` sends sim data blobs)

**Restart required between simulation runs** — `SpaceTreeStore.committedSteps` persists in memory; rerunning the simulation without restarting the backend silently discards all data (step indices already committed).

**Commit timing** — `SpaceTreeStore` uses a 30ms grace-period timer after all-started trees send STEP_END. This is intentional: OpenMP trees connect lazily and the fastest tree can finish step 0 before others open TCP. Do not remove the timer.

Key files:
- `backend/src/frameTypes.ts` — protocol constants; must stay in sync with C++ templates
- `backend/src/domain.ts` — backend-only parser/store models, including `TreeConnection` and internal snapshots
- `backend/src/snapshotSerializer.ts` — converts backend snapshots into browser REST/WS DTOs
- `backend/src/SpaceTreeStore.ts` — step ring buffer (200 steps), commit logic
- `backend/src/ProtocolParser.ts` — stateful binary frame parser

---

## Frontend

**Stack:** Three.js r165+, Vite, TypeScript (no React)
**Entry:** `cd frontend && npm run dev` → http://localhost:5173
**Type-check:** `cd frontend && npx tsc --noEmit`

Key files:
- `packages/contracts/src/index.ts` — shared browser REST/WS DTOs and CellMarker flag constants
- `frontend/src/viewTypes.ts` — frontend-local render/UI types (`ColorMode`, `FilterSpec`, `Float32Array` sim payloads)
- `frontend/src/scene/CellRenderer.ts` — InstancedMesh, max 500K cells, 5% gap
- `frontend/src/scene/ColorMapper.ts` — routes color modes through ColormapRegistry LUTs; treeId uses golden-angle hue hashing
- `frontend/src/scene/ColormapRegistry.ts` — 256-entry pre-sampled LUTs for 7 d3 colormaps (turbo, viridis, plasma, magma, inferno, rdbu, grayscale)
- `frontend/src/ui/ColorbarOverlay.ts` — ParaView-style canvas overlay, shown for level/sim modes only
- `frontend/src/ui/DetailPanel.ts` — decoded CellMarker struct view

### Three.js / WebGL gotchas
- **`mesh.frustumCulled = false`** on every `InstancedMesh` — base geometry sphere (origin, r=0.866) falls outside top-down 2D cameras; ALL instances silently skipped. Diagnose: `renderer.info.render.triangles === 0` after render.
- **CSS Grid canvas inflation** — `renderer.setSize(w, h, false)` sets `canvas.height` HTML attribute, inflating `1fr` grid rows. `min-height: 0; min-width: 0` must be on the grid child (`#canvas-wrap`).
- **Canvas overlay positioning** — absolutely-positioned overlays need `position: relative` on the direct parent. Append overlays to `#canvas-wrap`, not `#app`.
- **`BoxGeometry` zeroes instance colors** — Three.js r183 `color_vertex.glsl` multiplies the geometry `color` attribute by `instanceColor`. `BoxGeometry` has no `color` attribute so WebGL supplies `(0,0,0)`, silently zeroing all instance colors. Fix: `geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3).fill(1), 3))` after creating the geometry.
- **SwiftShader (Playwright/headless)** — silently fails GPU buffer allocations ≥2M instances (~152MB). Keep `MAX_INSTANCES ≤ 500K`.
- **2D camera** — `orientFor2D()` positions at z=1.2 (fills ~72% viewport); `controls.minDistance = 0.05` prevents camera passing through z=0 cell plane.

---

## Code Conventions

### C++ (generated)
- Use `#ifdef USE_ZLIB` guards around all zlib calls (matches Peano's existing pattern)
- Peano's dimensions macro is always uppercase: `#if DIMENSIONS == 3` (never `Dimensions`)
- ExaHyPE2 cell data objects (e.g. `FVSolverQ`) use a `NoData` constructor that sets `_data = nullptr` for non-leaf / load-balanced cells. `touchCellFirstTime` fires for ALL cells — always null-check `.data()` before reading. `appendCellData` sends `data_len=0` as a safe sentinel for null data.
- POSIX sockets only — no new CMake dependencies
- `std::call_once` + `std::once_flag` for one-time static initialisation in `prepareTraversal`
- Per-tree data (batch buffers, socket fd) lives on the instance — no locking needed
- Only `STVConnection::_treeSockets` map needs a mutex (open/close only, not send)

### TypeScript (backend)
- Strict mode, no `any`
- `frameTypes.ts` is the single source of truth for TCP protocol constants — do not inline magic numbers elsewhere
- Browser-facing REST/WS contracts live in `packages/contracts`; backend-only parser/store state stays in `backend/src/domain.ts`
- Public snapshot serialization goes through `backend/src/snapshotSerializer.ts`; keep REST and WebSocket DTO shapes aligned there
- `SpaceTreeStore` owns all mutable state; `TCPServer`/`WebSocketServer` only call its methods
- Never use `Float64Array`/TypedArray in types exposed via REST — `res.json()` serializes them as `{"0":1,...}` not `[1,...]`. Use `number[]`.
- Never construct `Float64Array(buf, byteOffset, n)` from a TCP chunk subarray — byteOffset may not be 8-byte aligned (crash). Read doubles with `payload.readDoubleLE(offset + i*8)` in a loop.

### TypeScript (frontend)
- No React. Plain DOM manipulation + Three.js
- Import browser API DTOs and CellMarker flag constants from `@spacetreevisualizer/contracts`; keep render/UI-only types in `viewTypes.ts`
- `WebSocketClient.ts` is the JSON/binary normalization boundary. Other frontend modules should consume normalized `StepSnapshot`/message types, not raw `Record<string, unknown>`.
- `AppState` is the single reactive singleton — update via `setState()`, never mutate directly
- `CellRenderer.updateFromSnapshot()` is the only entry point for scene updates
- Re-filter without re-fetch when filter/color mode changes (call `updateFromSnapshot` with `currentSnapshot.cells`)
- **d3-scale-chromatic format:** `interpolateTurbo/Greys/RdBu` return `"rgb(r,g,b)"` but `interpolateViridis/Plasma/Magma/Inferno` return `"#RRGGBB"` — handle both when parsing.
- **JS `%` negative values:** `(-1) % 360 === -1` in JS. For hue math use `((n % 360) + 360) % 360`.
- **Canvas text clipping:** `textBaseline = 'top'` means Y is text top. Budget `font-size` px below the draw Y — 8px bottom padding is insufficient for a 10px font.

### UI
- Dark theme: `#141414` bg, `#1e1e1e` panels, `#2e2e2e` borders, `#4a9eff` accent
- JetBrains Mono for all data values; system-ui for labels
- No gradients, no glow, no neon. Selection = white `EdgesGeometry` wireframe
- Plain HTML controls (`<select>`, `<input>`) — no custom widget libraries

---

## Integration Tests

**Location:** `tests/exahype2-fv-euler/`
**Build:** `bash -l -c "module load mpi && PEANO_CMAKE_BUILD_DIR=/mnt/Megafast/Peano/build python3 point-explosion.py -d 2 -m Release -md 4"`
- Requires login shell (`bash -l`) for MPI module — plain `bash -c` misses MPI in PATH
- `point-explosion.py` runs `make distclean`, deleting the `ExaHyPE` binary. Never rely on a previously built binary after running this script.

**Run:** `cd tests/exahype2-fv-euler && bash -l -c "module load mpi 2>/dev/null; ./ExaHyPE"`

**Playwright:** `npx playwright install chromium` (no sudo). Skip `--with-deps` (requires root).

---

## Current Phase

**Phase 1 + integration tests complete:** backend TCP+WS+REST, frontend scene + UI, `test_sender.py`, and `tests/exahype2-fv-euler/` integration test suite.

**Phase 1.5 complete:** sim data streaming — C++ patch doubles sent (HAS_CELL_DATA), backend parses to `number[]`, frontend field picker wired.

**Phase 1.5+ complete (td-e13a11):** frontend overhaul — selectable colormaps (d3-scale-chromatic LUT registry), level slider + cumulative toggle, treeId color mode, ParaView-style colorbar overlay.

**Phase 2:** timeline/pause, face+vertex rendering, multi-rank TreeSelector
