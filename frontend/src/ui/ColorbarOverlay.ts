import type { ColormapName } from '../types';
import { sample } from '../scene/ColormapRegistry';

const BAR_WIDTH = 200;
const BAR_HEIGHT = 14;
const PADDING = { top: 18, right: 8, bottom: 16, left: 8 };
const CANVAS_WIDTH  = BAR_WIDTH  + PADDING.left + PADDING.right;
const CANVAS_HEIGHT = BAR_HEIGHT + PADDING.top  + PADDING.bottom;

/**
 * Draws a ParaView-style colorbar overlay over the Three.js canvas.
 * Positioned at bottom-right of the canvas wrapper.
 * Only visible for continuous color modes (level, sim).
 */
export class ColorbarOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvasWrapper: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width  = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    Object.assign(this.canvas.style, {
      position:        'absolute',
      bottom:          '12px',
      right:           '12px',
      pointerEvents:   'none',
      display:         'none',
      borderRadius:    '3px',
      border:          '1px solid #2e2e2e',
    });
    canvasWrapper.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Render the colorbar for a continuous mode. */
  update(colormap: ColormapName, min: number, max: number, label: string): void {
    const ctx = this.ctx;
    const x0 = PADDING.left;
    const y0 = PADDING.top;

    // Background
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = 'rgba(20,20,20,0.75)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Gradient bar — sample 5 stops from the LUT
    const grad = ctx.createLinearGradient(x0, 0, x0 + BAR_WIDTH, 0);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const hex = sample(colormap, t);
      const r = (hex >> 16) & 0xff;
      const g = (hex >>  8) & 0xff;
      const b =  hex        & 0xff;
      grad.addColorStop(t, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, BAR_WIDTH, BAR_HEIGHT);

    // Label (field name, centered above bar)
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), x0 + BAR_WIDTH / 2, 3);

    // Min / max value labels
    const fmt = (v: number) => {
      if (!isFinite(v)) return String(v);
      if (v === 0) return '0';
      return Math.abs(v) < 1e4 && Math.abs(v) >= 0.001
        ? v.toPrecision(4)
        : v.toExponential(2);
    };

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#4a9eff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmt(min), x0, y0 + BAR_HEIGHT + 2);

    ctx.textAlign = 'right';
    ctx.fillText(fmt(max), x0 + BAR_WIDTH, y0 + BAR_HEIGHT + 2);

    this.canvas.style.display = 'block';
  }

  hide(): void {
    this.canvas.style.display = 'none';
  }
}
