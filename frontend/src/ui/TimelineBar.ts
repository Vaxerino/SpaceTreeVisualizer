/**
 * Bottom bar. In Phase 1 (live mode only) it just shows a "LIVE" badge and
 * a Continue button (hidden unless backend is paused).
 *
 * Phase 2 will add the full step slider + play/pause.
 */
export class TimelineBar {
  private readonly el: HTMLElement;
  private readonly continueBtn: HTMLButtonElement;
  private onContinueCb: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'timeline-bar';
    this.el.innerHTML = `
      <span class="mono small muted" id="timelineInfo">LIVE</span>
      <button id="continueBtn" class="btn" style="display:none">Continue →</button>
    `;
    container.appendChild(this.el);

    this.continueBtn = this.el.querySelector('#continueBtn') as HTMLButtonElement;
    this.continueBtn.addEventListener('click', () => this.onContinueCb?.());
  }

  onContinue(cb: () => void): void {
    this.onContinueCb = cb;
  }

  setPaused(paused: boolean): void {
    this.continueBtn.style.display = paused ? 'inline-block' : 'none';
    const info = this.el.querySelector('#timelineInfo')!;
    info.textContent = paused ? '⏸ PAUSED — simulation waiting' : 'LIVE';
  }

  setInfo(text: string): void {
    const info = this.el.querySelector('#timelineInfo')!;
    info.textContent = text;
  }
}
