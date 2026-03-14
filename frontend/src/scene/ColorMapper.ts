import type { CellRecord, ColorMode } from '../types';
import {
  CELL_FLAG_IS_LOCAL,
  CELL_FLAG_HAS_BEEN_ENCLAVE, CELL_FLAG_WILL_BE_ENCLAVE,
  CELL_FLAG_HAS_BEEN_REFINED, CELL_FLAG_WILL_BE_REFINED,
} from '../types';
import * as THREE from 'three';

/**
 * Turbo colormap (16 sampled levels).
 * Maps level 0 = deep blue, higher levels = warmer colors.
 */
const TURBO_16: number[] = [
  0x30123b, 0x4454c4, 0x3d87fb, 0x35b779,
  0x6ece58, 0xa0da39, 0xd0e11c, 0xfbe418,
  0xfba209, 0xf15a08, 0xd83806, 0xb21304,
  0x900c03, 0x6e0802, 0x520601, 0x3b0400,
];

/** Coolwarm colormap for simulation data (mapped from [0..1] range). */
const COOLWARM: number[] = [
  0x3b4cc0, 0x6788ee, 0x9abbff, 0xc9d8ef,
  0xdddddd, 0xf5c4ad, 0xf7a889, 0xe8735a,
  0xce2826,
];

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bv;
}

function coolwarmColor(t: number): number {
  t = Math.max(0, Math.min(1, t));
  const idx = t * (COOLWARM.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COOLWARM.length - 1);
  return lerpColor(COOLWARM[lo]!, COOLWARM[hi]!, idx - lo);
}

export class ColorMapper {
  private _color = new THREE.Color();

  /** Return a hex color for a cell given the current mode and optional sim range. */
  forCell(
    cell: CellRecord,
    mode: ColorMode,
    simMin = 0,
    simMax = 1,
    simFieldIndex = 0,
  ): THREE.Color {
    let hex: number;

    switch (mode) {
      case 'level':
        hex = TURBO_16[cell.level % 16]!;
        break;

      case 'local':
        hex = (cell.flags & CELL_FLAG_IS_LOCAL) ? 0x4a9eff : 0xcc4444;
        break;

      case 'enclave':
        if (cell.flags & CELL_FLAG_HAS_BEEN_ENCLAVE) hex = 0xff9900;
        else if (cell.flags & CELL_FLAG_WILL_BE_ENCLAVE) hex = 0xffcc44;
        else hex = 0x666666;
        break;

      case 'refinement':
        if (cell.flags & CELL_FLAG_WILL_BE_REFINED) hex = 0x44ff88;
        else if (cell.flags & CELL_FLAG_HAS_BEEN_REFINED) hex = 0x228844;
        else hex = 0x444444;
        break;

      case 'sim': {
        const val = cell.simData?.[simFieldIndex] ?? 0;
        const t = simMax !== simMin ? (val - simMin) / (simMax - simMin) : 0.5;
        hex = coolwarmColor(t);
        break;
      }

      default:
        hex = 0x888888;
    }

    return this._color.set(hex);
  }

  /** Compute min/max of a sim field across all cells. */
  static simRange(cells: CellRecord[], fieldIndex: number): [number, number] {
    let min = Infinity, max = -Infinity;
    for (const c of cells) {
      const v = c.simData?.[fieldIndex];
      if (v !== undefined) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min === max) max = min + 1;
    return [min, max];
  }
}
