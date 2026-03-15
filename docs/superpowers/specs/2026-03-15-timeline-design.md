# SpaceTreeVisualizer — Phase 2 Timeline Design

**Date:** 2026-03-15
**Branch:** timeline
**Status:** Approved

---

## Overview

Add a full AE-style timeline to the bottom bar with two independent control groups:

1. **Timeline controls** — visual playback through the committed step ring buffer (independent of the running simulation)
2. **Simulation controls** — pause/resume the C++ simulation (PAUSE_MODE only)

The two groups interact in one direction: **when playback enters LIVE mode, the simulation is automatically resumed.**

No C++ template changes required. No new REST endpoints.

---

## Bottom Bar Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│  ◀  ▶/⏸  ▶  [──────────────●──────────────]  step 42  t=0.250s  [LIVE]  │  ⏸ Pause Sim     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Timeline group (left, flex-grow)

| Control | Element | Behaviour |
|---------|---------|-----------|
| `◀` prev | `<button>` | Step back one entry in summaries; enter `historical` |
| `▶/⏸` play-pause | `<button>` | Toggle `playing` ↔ `historical` |
| `▶` next | `<button>` | Step forward one entry in summaries; enter `historical` |
| Scrubber | `<input type="range">` | `min=0 max=summaries.length-1`; drag enters `historical`; debounced 50 ms |
| Step info | `<span>` | `step 42  t=0.250s` — actual sim step index + sim timestamp from summary |
| `LIVE` button | `<button>` | Lit green when `viewMode==='live'`; click → enter `live` |

### Simulation group (right, fixed width, shown only when `hasPauseMode===true`)

| Sim state | Control shown |
|-----------|---------------|
| `autoAdvanceSim=true` (running) | `⏸ Pause Sim` |
| `autoAdvanceSim=false`, trees paused | `▶ Resume Sim` |
| No PAUSE_MODE trees connected | _(hidden)_ |

`Continue →` is retired. `▶ Resume Sim` replaces it entirely.

---

## State Machines

### Playback viewMode (frontend)

```
          user scrubs/prev/next/⏸
 live ──────────────────────────────► historical
  ▲                                       │
  │  auto-play reaches last summary       │ ▶ button
  │  OR LIVE button clicked               ▼
  └──────────────────────────────────── playing
                                   (200 ms/step timer)
```

| Mode | Description |
|------|-------------|
| `live` | Always shows latest committed step; `step_committed` auto-updates display |
| `playing` | 200 ms timer advances `currentSummaryIndex`; reaching end → `live` |
| `historical` | Locked to `currentSummaryIndex`; display frozen |

On entering `live` (any path): send `{type:"reach_live"}` over WebSocket.

### Simulation autoAdvanceSim (backend)

| Value | Behaviour |
|-------|-----------|
| `true` | When all trees send PAUSE_ACK, immediately call `sendContinueToAllPaused()` |
| `false` | Hold at PAUSE_ACK until explicit browser command |

| Trigger | Effect |
|---------|--------|
| `{type:"reach_live"}` from browser | `setAutoAdvanceSim(true)`; if currently held, send CONTINUE immediately |
| `{type:"pause_sim"}` from browser | `setAutoAdvanceSim(false)` |
| `{type:"resume_sim"}` from browser | One-shot `sendContinueToAllPaused()` (does not change `autoAdvanceSim`) |

`{type:"continue"}` retained as alias for `resume_sim` (backward compat with `test_sender.py`).

**In historical mode** `autoAdvanceSim` stays `false` — the simulation naturally holds between steps while the user scrubs, with no extra flag needed.

---

## Summaries — Slider Data Source

`AppState.summaries: SnapshotSummary[]` maps slider positions (0-based index) to actual step data.

### Population

- **On WS connect** (inside `status` handler): fetch `GET /api/snapshots` → set `AppState.summaries`.
- **On `step_committed`**: append `{stepIndex, timestamp, cellCount}` inline (no refetch). If `summaries.length > 200`, drop from the front (mirrors backend ring buffer eviction).

### Slider mapping

Slider value = index into `summaries` array, **not** the simulation step index. Step indices can be non-contiguous after ring buffer eviction.

```ts
const summary = AppState.summaries[sliderValue];
navigateToStep(summary.stepIndex);
```

In LIVE mode the slider thumb is pinned to `summaries.length - 1` and not interactive.

---

## Performance

### Debounce slider input (50 ms)

Rapid drag fires one `navigateToStep` call per settled position, not one per pixel.

### AbortController for in-flight fetches

`navigateToStep` stores the current `AbortController` in a module-level ref. Each call aborts the previous before starting a new `fetch()`. `SnapshotCache.get()` gains an optional `signal?: AbortSignal` parameter threaded to `fetch()`.

```ts
let fetchController: AbortController | null = null;

async function navigateToStep(stepIndex: number): Promise<void> {
  fetchController?.abort();
  fetchController = new AbortController();
  const snap = await SnapshotCache.get(stepIndex, fetchController.signal);
  if (!snap) return; // aborted or 404
  displayHistoricalSnapshot(snap);
}
```

### Play timer: skip tick if fetch in flight

```ts
let fetchInProgress = false;

playTimer = setInterval(() => {
  if (fetchInProgress) return; // don't stack
  const next = AppState.currentSummaryIndex + 1;
  if (next >= AppState.summaries.length) {
    setViewMode('live');
  } else {
    AppState.setState({ currentSummaryIndex: next });
    fetchInProgress = true;
    navigateToStep(AppState.summaries[next]!.stepIndex)
      .finally(() => { fetchInProgress = false; });
  }
}, 200);
```

### Speculative prefetch of adjacent steps

After `navigateToStep(idx)` completes successfully, fire background fetches for `idx-1` and `idx+1` (no abort signal — low priority warm-up). Makes ◀/▶ button presses feel instant.

```ts
function prefetchAdjacent(idx: number): void {
  const prev = AppState.summaries[idx - 1];
  const next = AppState.summaries[idx + 1];
  if (prev) void SnapshotCache.get(prev.stepIndex); // background, no abort
  if (next) void SnapshotCache.get(next.stepIndex);
}
```

### Existing mitigations

- `SnapshotCache` LRU (50 slots) — covers ±25 steps without refetch
- Live snapshots arrive via WebSocket push — never hit REST during LIVE mode
- Binary WebSocket path already used for sim data frames

---

## File-by-File Changes

### Backend

#### `SpaceTreeStore.ts`
- Add `private autoAdvanceSim: boolean = false`
- Add `setAutoAdvanceSim(v: boolean): void`
- Add `isAutoAdvancing(): boolean`
- Add `hasPauseModeTrees(): boolean` — returns true if any registered tree has `pauseMode=true` (requires storing this flag per tree at `registerTree` time)
- Modify `onPauseAck(treeKey)`: after recording the ACK, if `allTreesPaused() && autoAdvanceSim` → call `sendContinueToAllPaused()`
- `registerTree(key, pauseMode)`: extend signature to store pause mode flag

#### `WebSocketServer.ts`
- Handle `reach_live`: `store.setAutoAdvanceSim(true)`; if `store.isPaused()` → `store.sendContinueToAllPaused()`
- Handle `pause_sim`: `store.setAutoAdvanceSim(false)`
- Handle `resume_sim`: `store.sendContinueToAllPaused()` (same as existing `continue`)
- Keep `continue` as alias
- Add `hasPauseMode: store.hasPauseModeTrees()` to `status` broadcast

### Frontend

#### `AppState.ts`
- Replace `isLive: boolean` with `viewMode: 'live' | 'playing' | 'historical'`
- Add `currentSummaryIndex: number = -1`
- Keep `summaries: SnapshotSummary[]` (was already declared)

#### `SnapshotCache.ts`
- Add `signal?: AbortSignal` to `get(stepIndex, signal?)`
- Thread `signal` to `fetch()` call
- On `AbortError`, return `null` silently

#### `TimelineBar.ts`
- Full rewrite: two groups separated by a vertical rule
- Timeline group: renders ◀, ▶/⏸, ▶, range input, step info span, LIVE button
- Sim group: renders ⏸ Pause Sim or ▶ Resume Sim conditionally
- Stateless view: accepts update data via `update(state: TimelineState)`, exposes typed callbacks
- Keyboard listeners on `document`: Space (play/pause), `ArrowLeft` (prev), `ArrowRight` (next) — guarded against `<input>` / `<select>` focus

#### `main.ts`
- `loadSummaries()`: called inside `status` WS handler on first connect
- `navigateToStep(stepIndex)`: abort-controller fetch, calls `displayHistoricalSnapshot`, triggers prefetch
- `displayHistoricalSnapshot(snap)`: like `displaySnapshot` but does not send `snapshot_consumed` (not a live push) and sets `viewMode='historical'`
- `setViewMode(mode)`: handles all transitions:
  - `→ live`: clear play timer, pin slider, send `reach_live`, resume WS live push path
  - `→ playing`: start `setInterval(200)`, send `leave_live` if was live (implicit — `reach_live` will be re-sent on next arrival at end)
  - `→ historical`: clear play timer, lock display at `currentSummaryIndex`
- `on('step_committed')`: append to `AppState.summaries`; trim front if > 200; in LIVE mode update display as before
- `on('status')`: read `hasPauseMode`, call `loadSummaries()` on first connect
- Keyboard handler on `document.keydown`: Space → `setViewMode(playing/historical)`; `ArrowLeft` / `ArrowRight` → navigate ±1 summary index; guard with `e.target instanceof HTMLInputElement || HTMLSelectElement`

---

## WebSocket Message Contract Additions

### Outbound (browser → backend)

| `type` | When sent |
|--------|-----------|
| `reach_live` | On entering `live` mode (auto-play end, LIVE button) |
| `pause_sim` | Pause Sim button click |
| `resume_sim` | Resume Sim button click |

### Inbound additions (backend → browser)

`status` message gains two new fields:

| Field | Type | Meaning |
|-------|------|---------|
| `hasPauseMode` | `boolean` | Whether any connected tree has PAUSE_MODE set |
| `autoAdvanceSim` | `boolean` | Current auto-advance state |

---

## What This Does Not Change

- Binary WebSocket snapshot delivery for sim data (unchanged)
- REST snapshot serialization (unchanged)
- `test_sender.py` compatibility (`continue` alias preserved)
- C++ Jinja2 templates (unchanged)
- `ProtocolParser.ts`, `TCPServer.ts` (unchanged)
- All existing color modes, filters, picking, detail panel (unchanged)
