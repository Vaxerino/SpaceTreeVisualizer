import type { CellRecord, ColorMode, ColormapName, SimMeta } from '../types';
import {
  CELL_FLAG_IS_LOCAL,
  CELL_FLAG_HAS_BEEN_ENCLAVE, CELL_FLAG_WILL_BE_ENCLAVE,
  CELL_FLAG_HAS_BEEN_REFINED, CELL_FLAG_WILL_BE_REFINED,
} from '../types';
import { sample } from './ColormapRegistry';
import * as THREE from 'three';

export class ColorMapper {
  private _color = new THREE.Color();

  /**
   * Return a Three.js Color for a cell given the current mode and options.
   *
   * @param colormap  Which LUT to use for continuous modes (ignored for treeId).
   * @param simMin    Min value for sim normalization.
   * @param simMax    Max value for sim normalization.
   * @param _simFieldIndex  Retained for API stability; simData already holds the selected field.
   * @param maxLevel  Max AMR level in current snapshot (for level mode normalization).
   */
  forCell(
    cell: CellRecord,
    mode: ColorMode,
    colormap: ColormapName,
    simMin: number,
    simMax: number,
    _simFieldIndex: number,
    maxLevel: number,
  ): THREE.Color {
    let hex: number;

    switch (mode) {
      case 'level': {
        const t = maxLevel > 0 ? cell.level / maxLevel : 0;
        hex = sample(colormap, t);
        break;
      }

      case 'local':
        hex = sample(colormap, (cell.flags & CELL_FLAG_IS_LOCAL) ? 1.0 : 0.0);
        break;

      case 'enclave': {
        let t = 0.5; // neither
        if (cell.flags & CELL_FLAG_HAS_BEEN_ENCLAVE) t = 1.0;
        else if (cell.flags & CELL_FLAG_WILL_BE_ENCLAVE) t = 0.75;
        hex = sample(colormap, t);
        break;
      }

      case 'refinement': {
        let t = 0.0; // neither refined
        if (cell.flags & CELL_FLAG_WILL_BE_REFINED) t = 1.0;
        else if (cell.flags & CELL_FLAG_HAS_BEEN_REFINED) t = 0.5;
        hex = sample(colormap, t);
        break;
      }

      case 'sim': {
        const val = ColorMapper.meanSimValue(cell);
        const t = simMax !== simMin ? (val - simMin) / (simMax - simMin) : 0.5;
        hex = sample(colormap, t);
        break;
      }

      case 'treeId': {
        // Golden-angle hue hashing — gives well-separated hues for any set of integers.
        // Ignores the colormap parameter by design.
        // Use (n % 360 + 360) % 360 to guard against negative treeId values:
        // JavaScript's % returns negative results for negative operands.
        const hue = ((cell.treeId * 137.508) % 360 + 360) % 360;
        return this._color.setHSL(hue / 360, 0.65, 0.55);
      }

      default:
        hex = 0x888888;
    }

    return this._color.set(hex);
  }

  /**
   * Compute min/max across the selected field payload for all cells.
   */
  static simRange(cells: CellRecord[], _fieldIndex: number, _simMeta: SimMeta | null): [number, number] {
    let min = Infinity, max = -Infinity;

    for (const c of cells) {
      if (!c.simData) continue;
      for (const v of c.simData) {
        if (isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }

    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min === max) max = min + 1;
    return [min, max];
  }

  static meanSimValue(cell: CellRecord): number {
    if (!cell.simData || cell.simData.length === 0) return 0;
    let sum = 0;
    let count = 0;
    for (const value of cell.simData) {
      if (isFinite(value)) {
        sum += value;
        count++;
      }
    }
    return count === 0 ? 0 : sum / count;
  }
}
