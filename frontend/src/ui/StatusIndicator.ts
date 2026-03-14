/**
 * Small status badge in the top of the left panel.
 * Shows "● LIVE" in green or "⏸ step N / M" or "✗ disconnected".
 */
export class StatusIndicator {
  private readonly el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'status-indicator';
    container.appendChild(this.el);
    this.setDisconnected();
  }

  setLive(step: number, cellCount: number): void {
    this.el.className = 'status-indicator live';
    this.el.textContent = `● LIVE  step ${step}  ${cellCount} cells`;
  }

  setPaused(step: number, total: number): void {
    this.el.className = 'status-indicator paused';
    this.el.textContent = `⏸ PAUSED  step ${step} / ${total}`;
  }

  setDisconnected(): void {
    this.el.className = 'status-indicator disconnected';
    this.el.textContent = `✗ disconnected`;
  }
}
