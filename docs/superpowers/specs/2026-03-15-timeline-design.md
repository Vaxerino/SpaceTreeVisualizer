# SpaceTreeVisualizer — Phase 2 Timeline Design

**Date:** 2026-03-15
**Branch:** timeline
**Status:** Approved

---

## Overview

Two independent control groups added to the bottom bar:

1. **Timeline controls** — AE-style visual playback through the committed step ring buffer
2. **Simulation controls** — pause/resume the running C++ simulation (PAUSE_MODE only)

They interact in one direction: **entering LIVE mode auto-resumes the simulation.**

No C++ template changes. No new REST endpoints (existing `GET /api/snapshots` is used).

---

## Types

```ts
// Defined in packages/contracts/src/index.ts
interface SnapshotSummary {
  stepIndex: number;   // simulation step index; non-contiguous after ring-buffer eviction
  timestamp: number;   // simulation time in seconds (float64)
  cellCount: number;
}
```

---

## Bottom Bar Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ◀  ▶/⏸  ▶  [──────────●──────]  step 42  t=0.250s  [LIVE]  │  ⏸ Pause Sim         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Timeline group (left, flex-grow)

| Control | Element | Behaviour |
|---------|---------|-----------|
| `◀` prev | `<button>` | Step back one index; enter `historical` |
| `▶/⏸` play-pause | `<button>` | `historical`→`playing`; `playing`→`historical`; `live`→`playing` from last index |
| `▶` next | `<button>` | Step forward one index; enter `historical` |
| Scrubber | `<input type="range">` | `min=0 max=summaries.length-1`; drag→`historical`; 50 ms debounce; `disabled=true` pinned to `summaries.length-1` when `viewMode==='live'` |
| Step info | `<span>` | `step N  t=X.XXXs`; shows `—` when summaries is empty |
| `[LIVE]` | `<button>` | Lit green in `live`; click → `live` |

When `summaries` is empty (`currentSummaryIndex === -1`): slider/◀/▶/⏸ disabled; `[LIVE]` remains active.

### Simulation group (right, fixed width, visible only when `hasPauseMode===true`)

| Condition | Button |
|-----------|--------|
| `autoAdvanceSim=true` | `⏸ Pause Sim` |
| `autoAdvanceSim=false` and `isPaused===true` | `▶ Resume Sim` |
| `autoAdvanceSim=false` and `isPaused===false` | _(nothing — transient: CONTINUE was sent, awaiting next PAUSE_ACK)_ |

`Continue →` is retired; `▶ Resume Sim` replaces it.

**`▶ Resume Sim` is a single-step advance.** It is only ever rendered when `autoAdvanceSim=false`. `resume_sim` does not change `autoAdvanceSim`, so the backend stays in hold mode and halts again at the next PAUSE_ACK — single-step is guaranteed by the rendering invariant.

---

## State Machines

### Playback viewMode (frontend)

```
       scrubs/◀/▶-step / ⏸-while-playing
 live ──────────────────────────────────────────► historical
  ▲                                                    │
  │  timer reaches last summary / LIVE button          │ ▶/⏸ (play-pause)
  │                                                    ▼
  └───────────────────────────────────────────────── playing  ◄── ▶/⏸ while live
                                                 (200 ms/step timer)
```

Full transition table:

| From | Trigger | To | `reach_live` sent? |
|------|---------|----|--------------------|
| any | LIVE button | `live` | yes |
| `live` | scrub / ◀ / ▶-step | `historical` | no |
| `live` | ▶/⏸ play-pause | `playing` (currentSummaryIndex = last) | no |
| `historical` | ▶/⏸ play-pause | `playing` (from currentSummaryIndex) | no |
| `historical` | scrub / ◀ / ▶-step | stays `historical` | no |
| `playing` | ▶/⏸ play-pause | `historical` | no |
| `playing` | scrub / ◀ / ▶-step | `historical` | no |
| `playing` | timer reaches last summary | `live` | yes |

**Entering `playing` sends no message.** `autoAdvanceSim` is unchanged. If entered from `live` (autoAdvanceSim=true), the simulation keeps running. If entered from `historical` (autoAdvanceSim=false), the simulation stays paused. When auto-play eventually reaches the last summary and transitions to `live`, `reach_live` sets `autoAdvanceSim=true` and sends CONTINUE if the sim is currently held.

**`step_committed` during `playing`:** the new summary is appended to `AppState.summaries` (length grows). The timer checks `next >= AppState.summaries.length` on each tick; if new steps arrive before it wraps, playback continues into the newly arrived steps rather than transitioning to `live`. This is intentional — the timer follows live steps in `playing` mode the same way LIVE mode would.

**Initial connect and reconnect:** on every WebSocket `status` message, if `viewMode === 'live'` → send `{type:"reach_live"}` to sync `autoAdvanceSim=true`. On WS disconnect, set `firstLoadComplete = false` so reconnect triggers a fresh summaries load. This ensures `autoAdvanceSim` is correctly synced after reconnect regardless of what state the backend reset to.

### Simulation `autoAdvanceSim` (backend `SpaceTreeStore`)

`autoAdvanceSim: boolean`, default `false`. `isPaused(): boolean` (existing) = `pausedTrees.size > 0`.

| Value | Behaviour |
|-------|-----------|
| `true` | When `pausedTrees.size === pauseModeTrees.size` → `sendContinueToAllPaused()` immediately |
| `false` | Hold at PAUSE_ACK until explicit browser command |

| Browser message | Backend effect |
|-----------------|----------------|
| `reach_live` | `setAutoAdvanceSim(true)`; if `isPaused()` → `sendContinueToAllPaused()` |
| `pause_sim` | `setAutoAdvanceSim(false)` |
| `resume_sim` | if `isPaused()` → `sendContinueToAllPaused()` (autoAdvanceSim unchanged) |
| `continue` | old handler **replaced** (old case removed); identical logic to `resume_sim` |

Adding the `isPaused()` guard to `continue` is safe: in non-PAUSE_MODE runs there are no paused trees, so both old and new behaviour are no-ops.

**After `resetForNewRun()`:** `broadcastReset` already fires, causing the frontend to receive a `simulation_reset` message. On the next `status` message (after trees reconnect) the frontend re-syncs `hasPauseMode` and `autoAdvanceSim`.

---

## Summaries — Slider Data Source

`GET /api/snapshots` is an **existing endpoint** in `RestApiRouter.ts` that returns `SnapshotSummary[]`. No changes to `RestApiRouter.ts` are required.

### Population and race condition handling

On each WS `status` message where `!firstLoadComplete`: fetch `GET /api/snapshots`. Buffer concurrent `step_committed` events in `pendingCommits: SnapshotSummary[]`. On fetch response:

1. Build baseline from REST response.
2. **Atomically capture and clear the buffer:** `const captured = pendingCommits.splice(0)`.
3. **Set `firstLoadComplete = true`** — after this point, all new `step_committed` events go directly to `summaries` via the normal append path.
4. Merge: append any `captured` entry whose `stepIndex` is not already in the baseline (dedup).
5. Sort merged array ascending by `stepIndex`.
6. `AppState.setState({summaries: merged})`.

Using `splice(0)` atomically drains the buffer in a single JS microtask. Setting `firstLoadComplete=true` before merging ensures no event is lost: any `step_committed` arriving after step 3 goes directly to `summaries` and is never in `pendingCommits`.

On WS disconnect: reset `firstLoadComplete = false` so reconnect re-loads summaries. After `loadSummaries` completes on reconnect, correct `currentSummaryIndex`:
- `live` mode: `currentSummaryIndex = summaries.length - 1`.
- `historical`/`playing`: find the previously displayed `stepIndex` in the new `summaries` array. If found, use that index. If not found (step evicted or from a previous run), set `currentSummaryIndex = summaries.length - 1` and call `navigateToStep(summaries[last].stepIndex)` to sync the display.

### Ring-buffer eviction and index correction

After appending a new entry, if `summaries.length > 200`:

1. `evicted = summaries.length - 200` (always 1 in practice).
2. `summaries.splice(0, evicted)`.
3. Index correction:
   - `live` mode: `currentSummaryIndex = summaries.length - 1` (stay at new last).
   - `historical` or `playing`: `currentSummaryIndex = Math.max(0, currentSummaryIndex - evicted)`.
     - If the displayed step was evicted (old index was in `0..evicted-1`): the new index is 0. **Call `navigateToStep(summaries[0].stepIndex)`** to update the rendered scene to match the new slider position. Without this call the slider and the displayed cells would show different steps. In `playing` mode the timer resumes forward from index 0.
4. Update slider `max` and `value`.

### Slider mapping

Slider value = 0-based index into `summaries` (not simulation step index).

```ts
const summary = AppState.summaries[sliderValue];
if (summary) navigateToStep(summary.stepIndex);
```

---

## Performance

### AbortController — one fetch active at a time

`navigateToStep` aborts its predecessor before starting a new fetch. Only one fetch can complete and call `displayHistoricalSnapshot`, preventing out-of-order overwrites. This provides equivalent flow control to the live `snapshot_consumed` mechanism.

```ts
let fetchController: AbortController | null = null;

async function navigateToStep(stepIndex: number): Promise<void> {
  fetchController?.abort();
  fetchController = new AbortController();
  const snap = await SnapshotCache.get(stepIndex, fetchController.signal);
  if (!snap) return; // aborted or 404 — display unchanged
  displayHistoricalSnapshot(snap);
  prefetchAdjacent(AppState.currentSummaryIndex);
}
```

`SnapshotCache.get(signal?)`: on `AbortError` (`err.name === 'AbortError'`) returns `null` silently; does not evict the cache entry.

### Play timer — independent promise tracking

`playFetchPromise` is **only ever set by the play timer**, never by manual `navigateToStep` calls (from ◀/▶ buttons). Manual calls use the shared `fetchController` abort ref only. This means `setViewMode('historical')` can safely set `playFetchPromise = null` without risking collision with a manual-navigation promise.

```ts
let playFetchPromise: Promise<void> | null = null;

playTimer = setInterval(() => {
  if (playFetchPromise !== null) return; // previous tick still loading — skip
  const next = AppState.currentSummaryIndex + 1;
  if (next >= AppState.summaries.length) {
    setViewMode('live');
    return;
  }
  AppState.setState({ currentSummaryIndex: next });
  playFetchPromise = navigateToStep(AppState.summaries[next]!.stepIndex)
    .finally(() => { playFetchPromise = null; });
}, 200);
```

`setViewMode('historical')`: `clearInterval(playTimer)`, `playFetchPromise = null`, `fetchController?.abort()`. The aborted promise's `.finally()` will also set `playFetchPromise = null` — harmless double-null.

### Speculative prefetch

```ts
function prefetchAdjacent(idx: number): void {
  const prev = AppState.summaries[idx - 1];
  const next = AppState.summaries[idx + 1];
  if (prev) void SnapshotCache.get(prev.stepIndex); // no signal — background only
  if (next) void SnapshotCache.get(next.stepIndex);
}
```

### Existing mitigations

- `SnapshotCache` LRU (50 slots) — ±25 steps without refetch
- Live snapshots via WebSocket push — no REST in LIVE mode
- Binary WebSocket path for sim data (unchanged)

---

## File-by-File Changes

### Backend

#### `SpaceTreeStore.ts`

New:

| Addition | Description |
|----------|-------------|
| `private autoAdvanceSim: boolean = false` | auto-continue flag |
| `private pauseModeTrees: Set<string> = new Set()` | trees that declared PAUSE_MODE at handshake |
| `setAutoAdvanceSim(v: boolean): void` | setter |
| `isAutoAdvancing(): boolean` | returns `this.autoAdvanceSim` |
| `hasPauseModeTrees(): boolean` | returns `this.pauseModeTrees.size > 0` |

`registeredTrees: Set<string>` is an existing field.

Changed:

- `registerTree(key: string, pauseMode: boolean)`: extend signature. `pauseMode` comes from the handshake FLAGS bit 1 (`0x0002`), already parsed by `TCPServer`/`ProtocolParser` into `TreeConnection.pauseMode` — no C++ change needed. If `pauseMode` → `pauseModeTrees.add(key)`.
- `unregisterTree(key)`: also `pauseModeTrees.delete(key)`. Note: the existing `unregisterTree` already calls `this.pausedTrees.delete(key)`, so the `pausedTrees` invariant is maintained.
- `resetForNewRun()`: add `pauseModeTrees.clear(); autoAdvanceSim = false;`.
- `onPauseAck(treeKey)`: after `pausedTrees.add(treeKey)`, check `pausedTrees.size === pauseModeTrees.size && autoAdvanceSim` → `sendContinueToAllPaused()`. Uses `pauseModeTrees` (not `registeredTrees`) because non-PAUSE_MODE trees never send PAUSE_ACK.

#### `WebSocketServer.ts`

Message handlers (`handleMessage` switch):

| `type` | Action |
|--------|--------|
| `reach_live` (new) | `store.setAutoAdvanceSim(true)`; if `store.isPaused()` → `store.sendContinueToAllPaused()` |
| `pause_sim` (new) | `store.setAutoAdvanceSim(false)` |
| `resume_sim` (new) | if `store.isPaused()` → `store.sendContinueToAllPaused()` |
| `continue` (existing — replace, not supplement) | same logic as `resume_sim`; old unconditional handler removed |

`status` broadcast additions: `hasPauseMode: store.hasPauseModeTrees()`, `autoAdvanceSim: store.isAutoAdvancing()`. Existing `paused: store.isPaused()` is unchanged and maps to `isPaused` in `TimelineBarState`.

### Frontend

#### `AppState.ts`

- Replace `isLive: boolean` with `viewMode: 'live' | 'playing' | 'historical'` (default `'live'`)
- Add `currentSummaryIndex: number = -1`
- `summaries: SnapshotSummary[]` already declared; stays `[]` until `loadSummaries` completes

#### `SnapshotCache.ts`

- `get(stepIndex: number, signal?: AbortSignal): Promise<StepSnapshot | null>`
- Thread `signal` into `fetch(url, { signal })`
- Detect `AbortError` by `err.name === 'AbortError'`; return `null` silently; do not evict cache entry

#### `TimelineBar.ts`

Full rewrite. Pure view component: no internal state, no timers.

```ts
interface TimelineBarState {
  viewMode: 'live' | 'playing' | 'historical';
  summaryCount: number;
  currentSummaryIndex: number;  // -1 when empty
  currentStepIndex: number;     // -1 when empty; shown as "step N"
  currentTimestamp: number;     // seconds; shown as "t=X.XXXs"
  hasPauseMode: boolean;        // from status.hasPauseMode — shows/hides sim group
  autoAdvanceSim: boolean;      // from status.autoAdvanceSim
  isPaused: boolean;            // from existing status.paused
}
```

Callbacks: `onPlay()`, `onPause()`, `onPrev()`, `onNext()`, `onScrub(idx: number)`, `onLive()`, `onPauseSim()`, `onResumeSim()`.

Keyboard on `document`:

```ts
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') { e.preventDefault(); /* toggle play/pause */ }
  if (e.code === 'ArrowLeft') { e.preventDefault(); /* prev */ }
  if (e.code === 'ArrowRight') { e.preventDefault(); /* next */ }
});
```

#### `main.ts`

New module-level state:

```ts
let firstLoadComplete = false;
let pendingCommits: SnapshotSummary[] = [];
let fetchController: AbortController | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let playFetchPromise: Promise<void> | null = null;
```

New functions:

- `loadSummaries()`: fetch + merge as described in Summaries section.
- `navigateToStep(stepIndex)`: abort-controller fetch; on success `displayHistoricalSnapshot`; `prefetchAdjacent`.
- `displayHistoricalSnapshot(snap)`: like `displaySnapshot` but:
  - No `ws.send({type:'snapshot_consumed'})` — historical fetches are not live-push pipeline events.
  - No `displayInProgress` flag — flow control is provided by the `fetchController` abort mechanism instead.
  - No `syncLiveViewState()` call — `syncLiveViewState` (existing helper) sends `{type:'set_view', colorMode, simFieldIndex}` to instruct the backend which field to include in live snapshot pushes. Calling it from a historical fetch would incorrectly retrigger the live push pipeline for a one-time historical lookup.
- `prefetchAdjacent(idx)`: background warm-up.
- `setViewMode(mode)`:
  - `→ live`: `clearInterval(playTimer); playTimer=null; fetchController?.abort(); playFetchPromise=null; AppState.setState({viewMode:'live'}); ws.send({type:'reach_live'}); syncLiveViewState()` — `syncLiveViewState` re-sends `{type:'set_view', colorMode, simFieldIndex}` to resync the backend's live push preferences after the user may have changed color mode or sim field while in historical/playing mode.
  - `→ playing`: `clearInterval(playTimer); playTimer=null; AppState.setState({viewMode:'playing'}); /* start setInterval */`.
  - `→ historical`: `clearInterval(playTimer); playTimer=null; fetchController?.abort(); playFetchPromise=null; AppState.setState({viewMode:'historical'})`.

Changes to existing handlers:

- `ws.on('open'/'reconnect')`: set `firstLoadComplete = false`.
- `ws.on('status')`: if `!firstLoadComplete` → `loadSummaries()`; if `viewMode==='live'` → `ws.send({type:'reach_live'})`. Read `hasPauseMode`, `autoAdvanceSim`, `paused` into AppState.
- `ws.on('step_committed')`: if `!firstLoadComplete` → `pendingCommits.push(...)`. Else → append, apply eviction+correction, update timeline bar. If `viewMode==='live'` → existing snapshot push path unchanged.
- Wire `TimelineBar` callbacks. For navigation callbacks, **`currentSummaryIndex` must be updated before calling `navigateToStep`** (so `prefetchAdjacent` inside `navigateToStep` uses the correct index):
  - `onPrev`: `const idx = Math.max(0, AppState.currentSummaryIndex - 1); setViewMode('historical'); AppState.setState({currentSummaryIndex: idx}); void navigateToStep(AppState.summaries[idx]!.stepIndex)`.
  - `onNext`: same but `Math.min(summaries.length-1, currentSummaryIndex + 1)`.
  - `onScrub(idx)`: `setViewMode('historical'); AppState.setState({currentSummaryIndex: idx}); void navigateToStep(AppState.summaries[idx]!.stepIndex)`.
  - `onPlay/onPause/onLive`: call `setViewMode(...)` only.
  - `onPauseSim/onResumeSim`: `ws.send(...)` only.
- Also: on every `step_committed` in `live` mode, update `slider.value = summaries.length - 1` and `slider.max = summaries.length - 1` (not just on eviction).

---

## WebSocket Message Contract Additions

### Outbound (browser → backend)

| `type` | When sent |
|--------|-----------|
| `reach_live` | On every `status` message when `viewMode==='live'`; on entering `live` (any path) |
| `pause_sim` | Pause Sim button click |
| `resume_sim` | Resume Sim button click |

### Inbound additions

`status` message gains two new fields; existing `paused` field is unchanged:

| Field | Type | Source |
|-------|------|--------|
| `hasPauseMode` | `boolean` | `store.hasPauseModeTrees()` |
| `autoAdvanceSim` | `boolean` | `store.isAutoAdvancing()` |

---

## What This Does Not Change

- `RestApiRouter.ts` — `GET /api/snapshots` already exists and is used as-is
- Binary WebSocket snapshot delivery for sim data
- `test_sender.py` — `continue` handler logic is equivalent (guarded no-op for non-PAUSE_MODE)
- C++ Jinja2 templates
- `ProtocolParser.ts`, `TCPServer.ts`
- All existing color modes, filters, picking, detail panel
