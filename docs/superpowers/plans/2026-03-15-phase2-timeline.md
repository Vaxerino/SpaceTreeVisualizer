# Phase 2 Timeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AE-style timeline playback, step scrubbing, and simulation pause/resume to the bottom bar.

**Architecture:** Bottom bar gains two control groups (timeline + simulation). Frontend AppState grows a `viewMode` state machine. A play timer + AbortController pair handles async navigation without race conditions. Backend SpaceTreeStore gains `pauseModeTrees`/`autoAdvanceSim` to send CONTINUE automatically when in live mode.

**Tech Stack:** TypeScript, Three.js, WebSocket, `fetch` with AbortSignal, `setInterval`, Playwright E2E tests.

**Spec:** `docs/superpowers/specs/2026-03-15-timeline-design.md`

---

## File Map

| File | Change |
|------|--------|
| `backend/src/SpaceTreeStore.ts` | Add 3 fields, 3 methods, update 4 methods |
| `backend/src/TCPServer.ts` | Pass `conn.pauseMode` to `registerTree` |
| `backend/src/WebSocketServer.ts` | Add 3 message handlers, replace `continue`, add 2 fields to status |
| `frontend/src/WebSocketClient.ts` | Emit `'close'` on socket close |
| `frontend/src/store/AppState.ts` | Replace `isLive` with `viewMode`; add 4 fields |
| `frontend/src/store/SnapshotCache.ts` | Add `signal?: AbortSignal` to `get()` |
| `frontend/src/ui/TimelineBar.ts` | Full rewrite as pure view component |
| `frontend/index.html` | Add timeline group/sim group CSS; increase `--bottom-h` |
| `frontend/src/main.ts` | Add 5 module vars, 6 functions, update 4 handlers, wire callbacks |
| `frontend/tests/e2e/app-smoke.spec.ts` | Add 2 timeline tests |

---

## Chunk 1: Backend

### Task 1: SpaceTreeStore — pause mode tracking

**Files:**
- Modify: `backend/src/SpaceTreeStore.ts`
- Modify: `backend/src/TCPServer.ts`

- [ ] **Step 1: Add two new fields after `private pausedTrees`** (line 51 in SpaceTreeStore.ts)

```ts
private pauseModeTrees: Set<string> = new Set();
private autoAdvanceSim: boolean = false;
```

- [ ] **Step 2: Add three new methods after `isPaused()` (after line 227)**

```ts
setAutoAdvanceSim(v: boolean): void {
  this.autoAdvanceSim = v;
}

isAutoAdvancing(): boolean {
  return this.autoAdvanceSim;
}

hasPauseModeTrees(): boolean {
  return this.pauseModeTrees.size > 0;
}
```

- [ ] **Step 3: Update `registerTree` signature to accept `pauseMode`**

Change:
```ts
registerTree(key: string): void {
  this.registeredTrees.add(key);
```
To:
```ts
registerTree(key: string, pauseMode = false): void {
  this.registeredTrees.add(key);
  if (pauseMode) this.pauseModeTrees.add(key);
```

- [ ] **Step 4: Update `unregisterTree` to also clear `pauseModeTrees`**

After `this.pausedTrees.delete(key);` (line 80), add:
```ts
this.pauseModeTrees.delete(key);
```

- [ ] **Step 5: Update `resetForNewRun` to clear pause mode state**

After `this.pausedTrees.clear();` (line 159), add:
```ts
this.pauseModeTrees.clear();
this.autoAdvanceSim = false;
```

- [ ] **Step 6: Update `onPauseAck` to auto-advance when flag is set**

After `this.pausedTrees.add(treeKey);` and the `console.log`, add:
```ts
if (this.pausedTrees.size === this.pauseModeTrees.size && this.autoAdvanceSim) {
  this.sendContinueToAllPaused();
}
```

Note: uses `pauseModeTrees` (not `registeredTrees`) because non-PAUSE_MODE trees never send PAUSE_ACK.

- [ ] **Step 7: Update TCPServer.ts call site**

In `backend/src/TCPServer.ts` line 105, change:
```ts
this.store.registerTree(conn.key);
```
To:
```ts
this.store.registerTree(conn.key, conn.pauseMode);
```

- [ ] **Step 8: Type-check backend**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/SpaceTreeStore.ts backend/src/TCPServer.ts
git commit -m "feat(backend): add pauseModeTrees and autoAdvanceSim to SpaceTreeStore"
```

---

### Task 2: WebSocketServer — new handlers + status additions

**Files:**
- Modify: `backend/src/WebSocketServer.ts`

- [ ] **Step 1: Update `status` message in `subscribe_live` case to include new fields**

In the `subscribe_live` case (around line 78), change the `this.send` call to:
```ts
this.send(ws, {
  type: 'status',
  paused: this.store.isPaused(),
  hasPauseMode: this.store.hasPauseModeTrees(),
  autoAdvanceSim: this.store.isAutoAdvancing(),
  liveStep: this.store.getLiveStep(),
  totalSteps: this.store.getSummaries().length,
  trees: this.store.getRegisteredTrees(),
});
```

- [ ] **Step 2: Replace the `continue` handler and add three new handlers**

Replace the existing `continue` case (lines 135–138):
```ts
case 'reach_live':
  this.store.setAutoAdvanceSim(true);
  if (this.store.isPaused()) this.store.sendContinueToAllPaused();
  break;

case 'pause_sim':
  this.store.setAutoAdvanceSim(false);
  break;

case 'resume_sim':
  if (this.store.isPaused()) this.store.sendContinueToAllPaused();
  break;

case 'continue':
  if (this.store.isPaused()) this.store.sendContinueToAllPaused();
  break;
```

Note: The old `continue` handler sent `{ type: 'continue_ack' }` — remove that line. The `isPaused()` guard makes it a safe no-op for non-PAUSE_MODE runs. Backward compatibility with `test_sender.py` is preserved.

**Inter-chunk dependency:** this change removes the `continue_ack` response that the current `main.ts` `timeline.onContinue` callback relied on. Chunk 1 and Chunk 4 must be deployed together; do not apply one without the other.

- [ ] **Step 3: Type-check backend**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/WebSocketServer.ts
git commit -m "feat(backend): add reach_live/pause_sim/resume_sim WS handlers; add hasPauseMode to status"
```

---

## Chunk 2: Frontend State + Cache

### Task 3: AppState — viewMode + new fields

**Files:**
- Modify: `frontend/src/store/AppState.ts`

- [ ] **Step 1: Replace `isLive` with `viewMode` and add new fields**

Current top of `AppStateStore` class:
```ts
currentStep: number = -1;
isLive: boolean = true;
isPaused: boolean = false;
totalSteps: number = 0;
summaries: SnapshotSummary[] = [];
```

Replace with:
```ts
currentStep: number = -1;
viewMode: 'live' | 'playing' | 'historical' = 'live';
isPaused: boolean = false;
hasPauseMode: boolean = false;
autoAdvanceSim: boolean = false;
totalSteps: number = 0;
currentSummaryIndex: number = -1;
summaries: SnapshotSummary[] = [];
```

- [ ] **Step 2: Type-check frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: errors in `main.ts` referencing `timeline.setPaused` / `timeline.setInfo` / `timeline.onContinue` (those methods are removed in Task 5's TimelineBar rewrite). These are expected and will be fixed in Task 6 (main.ts). No errors should appear for AppState itself.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/AppState.ts
git commit -m "feat(frontend): replace isLive with viewMode state machine in AppState"
```

---

### Task 4: SnapshotCache — AbortSignal support

**Files:**
- Modify: `frontend/src/store/SnapshotCache.ts`

- [ ] **Step 1: Update `get()` to accept and thread an AbortSignal**

Replace the `get` method:
```ts
async get(stepIndex: number, signal?: AbortSignal): Promise<StepSnapshot | null> {
  if (this.cache.has(stepIndex)) {
    // Move to front of LRU order
    this.order = [stepIndex, ...this.order.filter(k => k !== stepIndex)];
    return this.cache.get(stepIndex)!;
  }

  try {
    const url = stepIndex >= 0
      ? `${BACKEND}/api/snapshots/${stepIndex}`
      : `${BACKEND}/api/snapshots/latest`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) return null;
    const snap: StepSnapshot = await resp.json();
    this.put(snap.stepIndex, snap);
    return snap;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    return null;
  }
}
```

Key changes: `{ signal }` passed to `fetch`; `AbortError` caught silently without evicting the cache entry.

- [ ] **Step 2: Type-check frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: same existing errors from Task 3 (main.ts). No new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/SnapshotCache.ts
git commit -m "feat(frontend): add AbortSignal support to SnapshotCache.get()"
```

---

### Task 5: WebSocketClient — emit close event

**Files:**
- Modify: `frontend/src/WebSocketClient.ts`

- [ ] **Step 1: Emit `'close'` when socket closes**

In `connect()`, update `this.ws.onclose`:
```ts
this.ws.onclose = () => {
  this.pendingSnapshots.clear();
  this.emit('close', {});
  console.log(`[ws] disconnected, reconnecting in ${this.reconnectDelay}ms`);
  setTimeout(() => this.connect(), this.reconnectDelay);
  this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/WebSocketClient.ts
git commit -m "feat(frontend): emit 'close' event from WebSocketClient on disconnect"
```

---

## Chunk 3: TimelineBar UI

### Task 6: TimelineBar — full rewrite as pure view component

**Files:**
- Rewrite: `frontend/src/ui/TimelineBar.ts`

- [ ] **Step 1: Rewrite TimelineBar.ts**

Replace entire file contents:

```ts
export interface TimelineBarState {
  viewMode: 'live' | 'playing' | 'historical';
  summaryCount: number;
  currentSummaryIndex: number;  // -1 when empty
  currentStepIndex: number;     // -1 when empty; shown as "step N"
  currentTimestamp: number;     // seconds; shown as "t=X.XXXs"
  hasPauseMode: boolean;        // from status.hasPauseMode — shows/hides sim group
  autoAdvanceSim: boolean;      // from status.autoAdvanceSim
  isPaused: boolean;            // from existing status.paused
}

type Callback = () => void;
type ScrubCallback = (idx: number) => void;

export class TimelineBar {
  private readonly el: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly playPauseBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private readonly stepInfo: HTMLSpanElement;
  private readonly liveBtn: HTMLButtonElement;
  private readonly simGroup: HTMLElement;
  private readonly simControlBtn: HTMLButtonElement;

  private onPlayCb: Callback | null = null;
  private onPauseCb: Callback | null = null;
  private onPrevCb: Callback | null = null;
  private onNextCb: Callback | null = null;
  private onScrubCb: ScrubCallback | null = null;
  private onLiveCb: Callback | null = null;
  private onPauseSimCb: Callback | null = null;
  private onResumeSimCb: Callback | null = null;

  private scrubDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentViewMode: 'live' | 'playing' | 'historical' = 'live';

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'timeline-bar';
    this.el.innerHTML = `
      <div class="timeline-group">
        <button id="prevBtn" class="btn icon-btn" title="Previous step">◀</button>
        <button id="playPauseBtn" class="btn icon-btn" title="Play/Pause">▶</button>
        <button id="nextBtn" class="btn icon-btn" title="Next step">▶</button>
        <input type="range" id="stepSlider" min="0" max="0" value="0" disabled>
        <span id="stepInfo" class="mono small muted">—</span>
        <button id="liveBtn" class="btn live-btn live-active">LIVE</button>
      </div>
      <div class="sim-group" style="display:none">
        <span class="timeline-divider">│</span>
        <button id="simControlBtn" class="btn">⏸ Pause Sim</button>
      </div>
    `;
    container.appendChild(this.el);

    this.prevBtn       = this.el.querySelector('#prevBtn') as HTMLButtonElement;
    this.playPauseBtn  = this.el.querySelector('#playPauseBtn') as HTMLButtonElement;
    this.nextBtn       = this.el.querySelector('#nextBtn') as HTMLButtonElement;
    this.slider        = this.el.querySelector('#stepSlider') as HTMLInputElement;
    this.stepInfo      = this.el.querySelector('#stepInfo') as HTMLSpanElement;
    this.liveBtn       = this.el.querySelector('#liveBtn') as HTMLButtonElement;
    this.simGroup      = this.el.querySelector('.sim-group') as HTMLElement;
    this.simControlBtn = this.el.querySelector('#simControlBtn') as HTMLButtonElement;

    this.prevBtn.addEventListener('click', () => this.onPrevCb?.());
    this.nextBtn.addEventListener('click', () => this.onNextCb?.());
    this.liveBtn.addEventListener('click', () => this.onLiveCb?.());

    this.playPauseBtn.addEventListener('click', () => {
      if (this.currentViewMode === 'playing') {
        this.onPauseCb?.();
      } else {
        this.onPlayCb?.();
      }
    });

    this.slider.addEventListener('input', () => {
      if (this.scrubDebounceTimer !== null) clearTimeout(this.scrubDebounceTimer);
      this.scrubDebounceTimer = setTimeout(() => {
        this.scrubDebounceTimer = null;
        this.onScrubCb?.(Number(this.slider.value));
      }, 50);
    });

    this.simControlBtn.addEventListener('click', () => {
      if (this.simControlBtn.dataset['action'] === 'pause') {
        this.onPauseSimCb?.();
      } else {
        this.onResumeSimCb?.();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.playPauseBtn.disabled) {
          if (this.currentViewMode === 'playing') {
            this.onPauseCb?.();
          } else {
            this.onPlayCb?.();
          }
        }
      }
      if (e.code === 'ArrowLeft') { e.preventDefault(); if (!this.prevBtn.disabled) this.onPrevCb?.(); }
      if (e.code === 'ArrowRight') { e.preventDefault(); if (!this.nextBtn.disabled) this.onNextCb?.(); }
    });
  }

  update(state: TimelineBarState): void {
    this.currentViewMode = state.viewMode;
    const empty = state.summaryCount === 0;

    // Play/pause button
    this.playPauseBtn.textContent = state.viewMode === 'playing' ? '⏸' : '▶';
    this.playPauseBtn.disabled = empty;

    // Prev/next buttons
    this.prevBtn.disabled = empty;
    this.nextBtn.disabled = empty;

    // Slider
    const maxIdx = Math.max(0, state.summaryCount - 1);
    this.slider.max = String(maxIdx);
    if (state.viewMode === 'live') {
      this.slider.value = String(maxIdx);
      this.slider.disabled = true;
    } else {
      this.slider.value = String(Math.max(0, state.currentSummaryIndex));
      this.slider.disabled = empty;
    }

    // Step info
    if (empty || state.currentStepIndex < 0) {
      this.stepInfo.textContent = '—';
    } else {
      this.stepInfo.textContent =
        `step ${state.currentStepIndex}  t=${state.currentTimestamp.toFixed(3)}s`;
    }

    // LIVE button
    this.liveBtn.classList.toggle('live-active', state.viewMode === 'live');

    // Sim group
    this.simGroup.style.display = state.hasPauseMode ? 'flex' : 'none';
    if (state.hasPauseMode) {
      if (state.autoAdvanceSim) {
        this.simControlBtn.textContent = '⏸ Pause Sim';
        this.simControlBtn.dataset['action'] = 'pause';
        this.simControlBtn.style.display = 'inline-block';
      } else if (state.isPaused) {
        this.simControlBtn.textContent = '▶ Resume Sim';
        this.simControlBtn.dataset['action'] = 'resume';
        this.simControlBtn.style.display = 'inline-block';
      } else {
        // Transient: CONTINUE was sent, waiting for next PAUSE_ACK
        this.simControlBtn.style.display = 'none';
      }
    }
  }

  onPlay(cb: Callback): void     { this.onPlayCb = cb; }
  onPause(cb: Callback): void    { this.onPauseCb = cb; }
  onPrev(cb: Callback): void     { this.onPrevCb = cb; }
  onNext(cb: Callback): void     { this.onNextCb = cb; }
  onScrub(cb: ScrubCallback): void { this.onScrubCb = cb; }
  onLive(cb: Callback): void     { this.onLiveCb = cb; }
  onPauseSim(cb: Callback): void { this.onPauseSimCb = cb; }
  onResumeSim(cb: Callback): void { this.onResumeSimCb = cb; }
}
```

- [ ] **Step 2: Verify TypeScript compiles (errors expected in main.ts only)**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "main.ts"
```
Expected: no errors outside main.ts.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/ui/TimelineBar.ts
git commit -m "feat(frontend): rewrite TimelineBar as pure view component with update(state) interface"
```

---

### Task 7: CSS — timeline group styles

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Increase `--bottom-h` to accommodate richer controls**

Change:
```css
--bottom-h:  36px;
```
To:
```css
--bottom-h:  40px;
```

- [ ] **Step 2: Add new CSS rules for timeline groups**

Add these rules inside the `<style>` block, after the `.btn:hover` rule (end of existing styles):

```css
/* ---- Timeline groups ---- */
.timeline-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.sim-group {
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.timeline-divider {
  color: var(--border);
  font-size: 18px;
  line-height: 1;
}

.timeline-group input[type="range"] {
  flex: 1;
  min-width: 80px;
  accent-color: var(--accent);
}

.icon-btn {
  padding: 2px 6px !important;
  font-size: 11px !important;
  min-width: 24px;
}

.live-btn {
  font-size: 10px !important;
  letter-spacing: 0.05em;
  color: var(--muted) !important;
  border-color: var(--muted) !important;
}

.live-btn.live-active {
  color: #44cc66 !important;
  border-color: #44cc66 !important;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat(frontend): add timeline group CSS; increase bottom bar height to 40px"
```

---

## Chunk 4: main.ts Orchestration

### Task 8: main.ts — new functions and updated handlers

**Files:**
- Modify: `frontend/src/main.ts`

This task has many steps. Do them all before running tsc.

- [ ] **Step 1: Update imports**

Add `SnapshotSummary` to the types import line:
```ts
import type { CellRecord, ColorMode, StepSnapshot, SnapshotSummary, SimMeta } from './types';
```

Add `TimelineBarState` to the TimelineBar import:
```ts
import { TimelineBar } from './ui/TimelineBar';
import type { TimelineBarState } from './ui/TimelineBar';
```

- [ ] **Step 2: Add module-level state variables**

After the `let displayInProgress = false;` line, add:
```ts
let firstLoadComplete = false;
let loadSummariesInProgress = false;
let pendingCommits: SnapshotSummary[] = [];
let fetchController: AbortController | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let playFetchPromise: Promise<void> | null = null;
```

- [ ] **Step 3: Add `buildTimelineState()` helper**

After the `updateColorbar` function:
```ts
function buildTimelineState(): TimelineBarState {
  const summary = AppState.summaries[AppState.currentSummaryIndex];
  return {
    viewMode: AppState.viewMode,
    summaryCount: AppState.summaries.length,
    currentSummaryIndex: AppState.currentSummaryIndex,
    currentStepIndex: summary?.stepIndex ?? -1,
    currentTimestamp: summary?.timestamp ?? 0,
    hasPauseMode: AppState.hasPauseMode,
    autoAdvanceSim: AppState.autoAdvanceSim,
    isPaused: AppState.isPaused,
  };
}
```

- [ ] **Step 4: Add `setViewMode()` function**

```ts
function setViewMode(mode: 'live' | 'playing' | 'historical'): void {
  if (mode === 'live') {
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    fetchController?.abort();
    playFetchPromise = null;
    AppState.setState({ viewMode: 'live' });
    ws.send({ type: 'reach_live' });
    syncLiveViewState();
  } else if (mode === 'playing') {
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    // If coming from live, start at the last summary index
    const startIdx = AppState.viewMode === 'live'
      ? Math.max(0, AppState.summaries.length - 1)
      : AppState.currentSummaryIndex;
    AppState.setState({ viewMode: 'playing', currentSummaryIndex: startIdx });
    playTimer = setInterval(() => {
      if (playFetchPromise !== null) return; // previous tick still loading
      const next = AppState.currentSummaryIndex + 1;
      if (next >= AppState.summaries.length) {
        setViewMode('live');
        return;
      }
      AppState.setState({ currentSummaryIndex: next });
      const summary = AppState.summaries[next];
      if (!summary) return;
      playFetchPromise = navigateToStep(summary.stepIndex)
        .finally(() => { playFetchPromise = null; });
    }, 200);
  } else {
    // historical
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
    fetchController?.abort();
    playFetchPromise = null;
    AppState.setState({ viewMode: 'historical' });
  }
}
```

- [ ] **Step 5: Add `prefetchAdjacent()` function**

```ts
function prefetchAdjacent(idx: number): void {
  const prev = AppState.summaries[idx - 1];
  const next = AppState.summaries[idx + 1];
  if (prev) void SnapshotCache.get(prev.stepIndex); // no signal — background only
  if (next) void SnapshotCache.get(next.stepIndex);
}
```

- [ ] **Step 6: Add `displayHistoricalSnapshot()` function**

```ts
function displayHistoricalSnapshot(snap: StepSnapshot): void {
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
    AppState.simMeta,
  );
  updateColorbar(cells, AppState.colorMode);
  highlight.hide();
  detail.showEmpty();
}
```

- [ ] **Step 7: Add `navigateToStep()` function**

```ts
async function navigateToStep(stepIndex: number): Promise<void> {
  fetchController?.abort();
  fetchController = new AbortController();
  const snap = await SnapshotCache.get(stepIndex, fetchController.signal);
  if (!snap) return; // aborted or 404 — display unchanged
  displayHistoricalSnapshot(snap);
  prefetchAdjacent(AppState.currentSummaryIndex);
}
```

- [ ] **Step 8: Add `loadSummaries()` function**

```ts
async function loadSummaries(): Promise<void> {
  // Concurrency guard: skip if a load is already in-flight
  if (loadSummariesInProgress) return;
  loadSummariesInProgress = true;

  // Capture the previously-displayed step index BEFORE overwriting summaries
  const prevStepIndex = AppState.currentSummaryIndex >= 0 && AppState.summaries.length > 0
    ? (AppState.summaries[AppState.currentSummaryIndex]?.stepIndex ?? -1)
    : -1;

  try {
    const res = await fetch(`${BACKEND}/api/snapshots`);
    if (!res.ok) return;
    const baseline: SnapshotSummary[] = await res.json() as SnapshotSummary[];

    // Atomically drain the pending buffer and mark load complete BEFORE merging.
    // Any step_committed arriving after this point goes directly to AppState.summaries.
    const captured = pendingCommits.splice(0);
    firstLoadComplete = true;

    // Dedup and sort
    const existing = new Set(baseline.map(s => s.stepIndex));
    for (const s of captured) {
      if (!existing.has(s.stepIndex)) { baseline.push(s); existing.add(s.stepIndex); }
    }
    baseline.sort((a, b) => a.stepIndex - b.stepIndex);

    AppState.setState({ summaries: baseline });

    // Correct currentSummaryIndex
    if (AppState.viewMode === 'live' || baseline.length === 0) {
      AppState.setState({ currentSummaryIndex: baseline.length - 1 });
    } else {
      const idx = prevStepIndex >= 0
        ? baseline.findIndex(s => s.stepIndex === prevStepIndex)
        : -1;
      const corrected = idx >= 0 ? idx : baseline.length - 1;
      AppState.setState({ currentSummaryIndex: corrected });
      if (idx < 0 && baseline.length > 0) {
        void navigateToStep(baseline[corrected]!.stepIndex);
      }
    }
  } catch {
    // Network error — will retry on next status message
  } finally {
    loadSummariesInProgress = false;
  }
}
```

- [ ] **Step 9: Update `clearLiveView()` — remove `timeline.setInfo` call**

In `clearLiveView`, remove the line:
```ts
timeline.setInfo('LIVE');
```
(AppState.onChange will handle timeline updates reactively.)

- [ ] **Step 10: Update `displaySnapshot()` — remove timeline.setInfo and status.setLive**

In `displaySnapshot`, remove:
```ts
status.setLive(snap.stepIndex, snap.cellCount);
timeline.setInfo(`LIVE  step ${snap.stepIndex}  ${snap.cellCount} cells`);
```
The status indicator call can stay if desired, but timeline update is now reactive.

Actually keep the status indicator: only remove the `timeline.setInfo` line. The `status.setLive` is a separate UI element, keep it.

- [ ] **Step 11: Update `ws.on('status')` handler**

Replace the entire existing handler (lines ~203–216):
```ts
ws.on('status', (msg) => {
  const statusMsg = msg as Record<string, unknown>;
  const trees = (statusMsg['trees'] as string[]) ?? [];
  controls.updateTreeList(trees);

  const hasPauseMode = (statusMsg['hasPauseMode'] as boolean) ?? false;
  const autoAdvanceSim = (statusMsg['autoAdvanceSim'] as boolean) ?? false;
  const isPaused = (statusMsg['paused'] as boolean) ?? false;

  AppState.setState({ registeredTrees: trees, isPaused, hasPauseMode, autoAdvanceSim });

  if (!firstLoadComplete) {
    void loadSummaries();
  }

  if (AppState.viewMode === 'live') {
    ws.send({ type: 'reach_live' });
    syncLiveViewState();
  }
});
```

- [ ] **Step 12: Update `ws.on('step_committed')` handler**

Replace the entire existing handler:
```ts
ws.on('step_committed', (msg) => {
  const stepMsg = msg as Record<string, unknown>;
  const stepIndex = stepMsg['stepIndex'] as number;
  const timestamp = (stepMsg['timestamp'] as number) ?? 0;
  const cellCount = (stepMsg['cellCount'] as number) ?? 0;

  AppState.setState({
    totalSteps: AppState.totalSteps + 1,
    currentStep: stepIndex,
  });

  if (!firstLoadComplete) {
    pendingCommits.push({ stepIndex, timestamp, cellCount });
    return;
  }

  // Append to summaries
  const summaries = [...AppState.summaries, { stepIndex, timestamp, cellCount }];
  let csi = AppState.currentSummaryIndex;

  if (summaries.length > 200) {
    const evicted = summaries.length - 200;
    summaries.splice(0, evicted);
    if (AppState.viewMode === 'live') {
      csi = summaries.length - 1;
    } else {
      const wasEvicted = csi < evicted;
      csi = Math.max(0, csi - evicted);
      if (wasEvicted) {
        // Early return: single setState then navigate to re-sync display
        AppState.setState({ summaries, currentSummaryIndex: csi });
        void navigateToStep(summaries[0]!.stepIndex);
        return;
      }
      // Non-evicted: fall through to the single outer setState below
    }
  } else if (AppState.viewMode === 'live') {
    csi = summaries.length - 1;
  }

  AppState.setState({ summaries, currentSummaryIndex: csi });
});
```

- [ ] **Step 13: Update `ws.on('simulation_reset')` handler**

After the existing `AppState.setState` call, add resets:
```ts
ws.on('simulation_reset', () => {
  if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
  fetchController?.abort();
  playFetchPromise = null;
  pendingCommits.splice(0);
  firstLoadComplete = false;

  AppState.setState({
    currentStep: -1,
    totalSteps: 0,
    summaries: [],
    currentSummaryIndex: -1,
    registeredTrees: [],
    simMeta: null,
    selectedCell: null,
    selectedInstanceIndex: -1,
    viewMode: 'live',
    hasPauseMode: false,
    autoAdvanceSim: false,
    isPaused: false,
  });
  controls.updateTreeList([]);
  controls.updateSimMeta(null);
  clearLiveView();
});
```

- [ ] **Step 14: Add `ws.on('close')` handler**

After the simulation_reset handler:
```ts
ws.on('close', () => {
  firstLoadComplete = false;
});
```

- [ ] **Step 15: Wire `TimelineBar` callbacks**

Replace the existing `timeline.onContinue(...)` block (lines 244–246) and the `syncLiveViewState()` call (line 248) with:

```ts
timeline.onPlay(() => setViewMode('playing'));
timeline.onPause(() => setViewMode('historical'));
timeline.onLive(() => setViewMode('live'));

timeline.onPrev(() => {
  if (AppState.summaries.length === 0) return;
  const idx = Math.max(0, AppState.currentSummaryIndex - 1);
  setViewMode('historical');
  AppState.setState({ currentSummaryIndex: idx });
  void navigateToStep(AppState.summaries[idx]!.stepIndex);
});

timeline.onNext(() => {
  if (AppState.summaries.length === 0) return;
  const idx = Math.min(AppState.summaries.length - 1, AppState.currentSummaryIndex + 1);
  setViewMode('historical');
  AppState.setState({ currentSummaryIndex: idx });
  void navigateToStep(AppState.summaries[idx]!.stepIndex);
});

timeline.onScrub((idx) => {
  if (!AppState.summaries[idx]) return;
  setViewMode('historical');
  AppState.setState({ currentSummaryIndex: idx });
  void navigateToStep(AppState.summaries[idx]!.stepIndex);
});

// Optimistic AppState updates so the timeline bar re-renders immediately
// without waiting for a backend status broadcast.
timeline.onPauseSim(() => {
  AppState.setState({ autoAdvanceSim: false });
  ws.send({ type: 'pause_sim' });
});
timeline.onResumeSim(() => {
  AppState.setState({ isPaused: false });
  ws.send({ type: 'resume_sim' });
});

// Reactive timeline bar update on any AppState change
AppState.onChange(() => timeline.update(buildTimelineState()));

// Initial render
timeline.update(buildTimelineState());
```

- [ ] **Step 16: Type-check frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: **no errors**. All main.ts errors from earlier tasks are now resolved.

- [ ] **Step 17: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat(frontend): implement timeline orchestration in main.ts (loadSummaries, navigateToStep, setViewMode, play timer)"
```

---

## Chunk 5: Tests

### Task 9: E2E tests for timeline bar

**Files:**
- Modify: `frontend/tests/e2e/app-smoke.spec.ts`

- [ ] **Step 1: Add helper and two tests at the end of the file**

```ts
// ---------------------------------------------------------------------------
// Timeline bar tests
// ---------------------------------------------------------------------------

test('timeline bar renders with LIVE button active', async ({ page }) => {
  await page.goto('/');

  // Timeline bar is visible
  await expect(page.locator('.timeline-bar')).toBeVisible();

  // LIVE button exists and has live-active class (initial state)
  const liveBtn = page.locator('#liveBtn');
  await expect(liveBtn).toBeVisible();
  await expect(liveBtn).toHaveClass(/live-active/);

  // Playback controls exist
  await expect(page.locator('#prevBtn')).toBeVisible();
  await expect(page.locator('#playPauseBtn')).toBeVisible();
  await expect(page.locator('#nextBtn')).toBeVisible();
  await expect(page.locator('#stepSlider')).toBeVisible();
});

test('timeline controls are disabled when no summaries are loaded', async ({ page }) => {
  await page.goto('/');

  // With no WS connection there are no summaries — controls should be disabled
  await expect(page.locator('#prevBtn')).toBeDisabled();
  await expect(page.locator('#playPauseBtn')).toBeDisabled();
  await expect(page.locator('#nextBtn')).toBeDisabled();
  await expect(page.locator('#stepSlider')).toBeDisabled();

  // Step info shows "—"
  await expect(page.locator('#stepInfo')).toHaveText('—');
});
```

- [ ] **Step 2: Run existing + new tests to make sure they pass**

```bash
cd frontend && npx playwright test
```
Expected: all tests pass (no regressions; new tests pass for initial state assertions).

If the Playwright browser is not installed:
```bash
npx playwright install chromium
```

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/e2e/app-smoke.spec.ts
git commit -m "test(frontend): add timeline bar visibility and disabled-state E2E tests"
```

---

## Verification

After all tasks complete, run full verification:

```bash
# Backend type check
cd backend && npx tsc --noEmit

# Frontend type check
cd frontend && npx tsc --noEmit

# Frontend E2E tests (requires dev server; playwright will auto-start it per config)
cd frontend && npx playwright test

# Manual smoke test with test_sender.py
# Terminal 1: cd backend && npx ts-node src/server.ts
# Terminal 2: cd frontend && npm run dev
# Terminal 3: python3 backend/test_sender.py
# Then open http://localhost:5173 and verify:
#   - Bottom bar shows ◀ ▶ ▶ [slider] step N t=X.XXXs [LIVE]
#   - ◀/▶ buttons navigate historical steps; slider follows
#   - Play button auto-advances at 200ms/step; LIVE button at end is green
#   - LIVE button click returns to live mode
#   - Keyboard arrows navigate; Space toggles play/pause
```
