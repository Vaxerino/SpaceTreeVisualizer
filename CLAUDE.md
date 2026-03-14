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
**Test sender:** `python3 backend/test_sender.py` (requires backend running)

**Restart required between simulation runs** — `SpaceTreeStore.committedSteps` persists in memory; rerunning the simulation without restarting the backend silently discards all data (step indices already committed).

**Commit timing** — `SpaceTreeStore` uses a 30ms grace-period timer after all-started trees send STEP_END. This is intentional: OpenMP trees connect lazily and the fastest tree can finish step 0 before others open TCP. Do not remove the timer.

Key files:
- `backend/src/frameTypes.ts` — protocol constants; must stay in sync with C++ templates
- `backend/src/SpaceTreeStore.ts` — step ring buffer (200 steps), commit logic
- `backend/src/ProtocolParser.ts` — stateful binary frame parser

---

## Frontend

**Stack:** Three.js r165+, Vite, TypeScript (no React)
**Entry:** `cd frontend && npm run dev` → http://localhost:5173
**Type-check:** `cd frontend && npx tsc --noEmit`

Key files:
- `frontend/src/scene/CellRenderer.ts` — InstancedMesh, max 500K cells, 5% gap
- `frontend/src/scene/ColorMapper.ts` — Turbo (level), coolwarm (sim data), flag colors
- `frontend/src/ui/DetailPanel.ts` — decoded CellMarker struct view

### Three.js / WebGL gotchas
- **`mesh.frustumCulled = false`** on every `InstancedMesh` — base geometry sphere (origin, r=0.866) falls outside top-down 2D cameras; ALL instances silently skipped. Diagnose: `renderer.info.render.triangles === 0` after render.
- **CSS Grid canvas inflation** — `renderer.setSize(w, h, false)` sets `canvas.height` HTML attribute, inflating `1fr` grid rows. Require `min-height: 0; min-width: 0` on `#canvas`.
- **SwiftShader (Playwright/headless)** — silently fails GPU buffer allocations ≥2M instances (~152MB). Keep `MAX_INSTANCES ≤ 500K`.
- **2D camera** — `orientFor2D()` positions at z=1.2 (fills ~72% viewport); `controls.minDistance = 0.05` prevents camera passing through z=0 cell plane.

---

## Code Conventions

### C++ (generated)
- Use `#ifdef USE_ZLIB` guards around all zlib calls (matches Peano's existing pattern)
- POSIX sockets only — no new CMake dependencies
- `std::call_once` + `std::once_flag` for one-time static initialisation in `prepareTraversal`
- Per-tree data (batch buffers, socket fd) lives on the instance — no locking needed
- Only `STVConnection::_treeSockets` map needs a mutex (open/close only, not send)

### TypeScript (backend)
- Strict mode, no `any`
- `frameTypes.ts` is the single source of truth for protocol constants — do not inline magic numbers elsewhere
- `SpaceTreeStore` owns all mutable state; `TCPServer`/`WebSocketServer` only call its methods

### TypeScript (frontend)
- No React. Plain DOM manipulation + Three.js
- `AppState` is the single reactive singleton — update via `setState()`, never mutate directly
- `CellRenderer.updateFromSnapshot()` is the only entry point for scene updates
- Re-filter without re-fetch when filter/color mode changes (call `updateFromSnapshot` with `currentSnapshot.cells`)

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

---

## Current Phase

**Phase 1 + integration tests complete:** backend TCP+WS+REST, frontend scene + UI, `test_sender.py`, and `tests/exahype2-fv-euler/` integration test suite.

**Phase 1.5:** simulation data streaming (`send_cell_data=True`, raw patch doubles)

**Phase 2:** timeline/pause, face+vertex rendering, multi-rank TreeSelector
