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
