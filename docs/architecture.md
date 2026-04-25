# SpaceTreeVisualizer — System Architecture

## Purpose

SpaceTreeVisualizer is a real-time 3D browser-based debugger for Peano 4 / ExaHype 2 adaptive mesh refinement (AMR) simulations. It streams the AMR space tree from a running C++ simulation to a browser, where it is rendered as an interactive 3D scene of instanced boxes.

Primary use cases:
- Inspect the mesh structure during development (verify AMR triggers, enclave detection, partition boundaries)
- Pause the simulation per timestep and examine each cell's state
- Generate figures for publications
- Understand MPI domain decomposition visually

---

## Component Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ExaHype2 / Peano4 simulation process                                   │
│                                                                         │
│  Python setup script:                                                   │
│    project.add_action_set_to_timestepping(                              │
│      SpaceTreeVisualizerActionSet(solver=my_solver, port=7421)          │
│    )                                                                    │
│                                                                         │
│  Generated C++:                                                         │
│    STVConnection      — static, one per MPI rank                        │
│    SpaceTreeVisualizer­Sender — one per spacetree (per Peano thread)    │
│      ├── beginTraversal()      → FRAME_STEP_BEGIN                       │
│      ├── touchCellFirstTime()  → append to _cellBatch                  │
│      ├── endTraversal()        → flush _cellBatch as FRAME_CELL_BATCH   │
│      └── unprepareTraversal()  → FRAME_STEP_END (+ optional pause)      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  TCP :7421 (one connection per spacetree)
                               │  binary protocol (see protocol.md)
┌──────────────────────────────▼──────────────────────────────────────────┐
│  Node.js backend process                                                │
│                                                                         │
│  TCPServer           — accepts C++ connections, reads handshake         │
│  ProtocolParser      — stateful frame parser per connection             │
│  SpaceTreeStore      — merges per-tree data, commits steps to ring buf  │
│  WebSocketServer     — serves browser clients                           │
│  RestApiRouter       — GET /api/snapshots[/:step]                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  WebSocket :7422  (JSON messages)
                               │  REST HTTP :7422  (/api/*)
┌──────────────────────────────▼──────────────────────────────────────────┐
│  Browser (Three.js frontend)                                            │
│                                                                         │
│  WebSocketClient     — auto-reconnecting WS, dispatches by type        │
│  SnapshotCache       — LRU fetch cache (50 steps)                      │
│  SceneManager        — Three.js renderer, camera, OrbitControls        │
│  CellRenderer        — InstancedMesh, up to 2M cells                   │
│  SelectionHighlight  — EdgesGeometry wireframe on selected cell         │
│  PickingHelper       — Raycaster → instanceId → DetailPanel            │
│  ControlPanel        — color mode, level filter, tree list              │
│  DetailPanel         — decoded CellRecord struct view                  │
│  TimelineBar         — status, Continue button (pause mode)            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### During a simulation step

1. Peano begins a grid traversal. `prepareTraversal()` (static, called once per rank) opens a TCP connection to the backend if one doesn't exist yet, using `std::call_once`.

2. For each spacetree on this rank, a `SpaceTreeVisualizerSender` instance is created (Peano creates one observer per spacetree per sweep). `beginTraversal()` sends `FRAME_STEP_BEGIN` with the current step index and timestamp.

3. As the space-filling curve traverses the tree, `touchCellFirstTime()` is called once per local cell. It packs a `CellRecord` (geometry + flags + optional simulation data) into a `std::vector<uint8_t> _cellBatch`.

4. When `_cellBatch` exceeds the compression threshold (default 4 KiB), or at `endTraversal()`, the batch is optionally zlib-compressed and sent as `FRAME_CELL_BATCH`.

5. `endTraversal()` flushes the final partial batch and sends `FRAME_STEP_END`.

6. `unprepareTraversal()` (static, called after all trees on this rank have finished) optionally blocks waiting for a `FRAME_CONTINUE` byte from the backend — the pause-mode timeline mechanism.

### Backend step commit

The backend tracks which trees have sent `STEP_BEGIN` and `STEP_END` for each step index. When all trees that began a step have ended it, `SpaceTreeStore.commitStep()` merges all per-tree cell arrays into a `StepSnapshot`, pushes it to the ring buffer (max 200), and broadcasts `{type:"step_committed"}` to all live WebSocket subscribers.

### Browser rendering

On receiving `step_committed`, the browser fetches the snapshot from `GET /api/snapshots/:step`. It calls `CellRenderer.updateFromSnapshot()` which iterates all cells, applies the level/flag filter, and for each passing cell sets one instance in the `InstancedMesh` (position, scale, color). The Three.js animation loop renders at display framerate independently of data arrival.

---

## Threading and MPI

**Threading:** Peano runs multiple spacetrees in parallel (one `std::thread` per tree). Each `SpaceTreeVisualizerSender` instance belongs to exactly one thread. Each instance holds its own `_cellBatch` buffer. The only shared state is `STVConnection::_treeSockets` (the map from treeId to socket fd), which is protected by a mutex — but only during socket open/close, not during send. POSIX `write()` to distinct file descriptors requires no synchronization.

**MPI:** Each MPI rank has its own `STVConnection` singleton. All ranks connect to the same backend. Each connection is identified in the handshake by `(rank, treeId)`. The backend merges data from all connections (potentially from multiple ranks) into a single step snapshot keyed by step index. Step commit fires when all trees — across all ranks — have sent `STEP_END` for a given step.

For multi-rank setups the simulation and backend must be able to reach each other over the network. The host and port are specified in the Python setup script; all ranks use the same host/port. The backend is typically run on the login node or a dedicated visualization node.

---

## Ports and Configuration

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 7421 | TCP | C++ → backend | binary cell/face/vertex stream |
| 7422 | HTTP + WebSocket | backend ↔ browser | REST snapshots + live events |
| 5173 | HTTP | dev only | Vite frontend dev server |

Environment variables for the backend:
```
STV_TCP_PORT   default 7421
STV_HTTP_PORT  default 7422
```

---

## File Structure

```
SpaceTreeVisualizer/
├── docs/
│   ├── architecture.md          ← this file
│   ├── protocol.md              ← wire protocol specification
│   ├── peano4-exahype2-reference.md  ← Peano4/ExaHype2 internals
│   └── ui-spec.md               ← frontend UI specification
│
├── spacetree_visualizer/                ← pip-installable Python package
│   ├── __init__.py
│   ├── SpaceTreeVisualizerActionSet.py   ← ActionSet subclass
│   ├── _templates/
│   │   ├── STVConnection.h.jinja2
│   │   ├── STVConnection.cpp.jinja2
│   │   ├── SpaceTreeVisualizerSender.h.jinja2
│   │   └── SpaceTreeVisualizerSender.cpp.jinja2
│   └── pyproject.toml
│
├── backend/
│   ├── src/
│   │   ├── server.ts            ← entry point: starts TCP + HTTP/WS
│   │   ├── TCPServer.ts         ← accepts C++ connections
│   │   ├── ProtocolParser.ts    ← stateful binary frame parser
│   │   ├── WebSocketServer.ts   ← browser WebSocket handler
│   │   ├── SpaceTreeStore.ts    ← in-memory step ring buffer
│   │   ├── RestApiRouter.ts     ← Express REST routes
│   │   ├── domain.ts            ← backend parser/store models
│   │   ├── snapshotSerializer.ts← backend model → browser DTO conversion
│   │   └── frameTypes.ts        ← protocol constants + bitmasks
│   ├── test_sender.py           ← integration test / C++ simulator
│   ├── package.json
│   └── tsconfig.json
│
├── packages/
│   └── contracts/               ← shared browser REST/WS DTOs + CellMarker flags
│
└── frontend/
    ├── src/
    │   ├── main.ts              ← entry point, wires everything together
    │   ├── viewTypes.ts         ← frontend render/UI-local types
    │   ├── WebSocketClient.ts   ← auto-reconnecting WS
    │   ├── scene/
    │   │   ├── SceneManager.ts       ← renderer, camera, OrbitControls
    │   │   ├── CellRenderer.ts       ← InstancedMesh rendering
    │   │   ├── SelectionHighlight.ts ← EdgesGeometry wireframe
    │   │   ├── ColorMapper.ts        ← level/flag/sim → hex color
    │   │   └── PickingHelper.ts      ← click → instanceId
    │   ├── ui/
    │   │   ├── ControlPanel.ts       ← left panel
    │   │   ├── DetailPanel.ts        ← right panel (struct view)
    │   │   ├── TimelineBar.ts        ← bottom bar
    │   │   └── StatusIndicator.ts    ← connection badge
    │   └── store/
    │       ├── AppState.ts           ← reactive singleton state
    │       └── SnapshotCache.ts      ← LRU REST fetch cache
    ├── index.html
    ├── package.json
    └── tsconfig.json
```

---

## Phase 1 vs Phase 2 Scope

**Phase 1 (implemented):**
- Cell geometry streaming (position, size, level, CellMarker flags)
- Single rank, arbitrary number of threads
- Live mode only (always display latest step)
- Click-to-inspect (decoded struct in right panel)
- Level filter, local/remote visibility toggles
- Color modes: level (Turbo colormap), local/remote, enclave, refinement state

**Phase 1.5 (next):**
- Simulation data streaming (`send_cell_data=True`): raw solver patch doubles sent after each geometry record; rendered as coolwarm colormap with min/max colorbar

**Phase 2:**
- Timeline/playback: ring buffer navigation, step slider, play/pause, pause-mode Continue button
- Face and vertex rendering (`FaceRenderer`, `VertexRenderer`)
- Multi-rank TreeSelector: per-`rank:treeId` visibility toggles
- Binary WebSocket messages (ArrayBuffer) for large snapshots
- Top-down orthographic 2D view toggle
- LOD: skip cells above configurable level when total count exceeds threshold
