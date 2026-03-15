import {
  interpolateTurbo,
  interpolateViridis,
  interpolatePlasma,
  interpolateMagma,
  interpolateInferno,
  interpolateGreys,
  interpolateRdBu,
} from 'd3-scale-chromatic';
import type { ColormapName } from '../types';

/**
 * Parse a d3 color string → 0xRRGGBB integer.
 * d3 interpolators use two formats: "rgb(r,g,b)" (turbo, greys, rdbu)
 * and "#RRGGBB" hex (viridis, plasma, magma, inferno).
 * Called only at module load time (256 × 7 times), never at render time.
 */
function parseRgb(rgb: string): number {
  if (rgb.startsWith('#')) {
    // #RRGGBB (6-digit) — the common case from d3 sequential interpolators
    return parseInt(rgb.slice(1), 16) & 0xffffff;
  }
  // "rgb(123, 45, 67)" with optional spaces
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return 0x888888;
  return (parseInt(m[1]!, 10) << 16) | (parseInt(m[2]!, 10) << 8) | parseInt(m[3]!, 10);
}

/**
 * Build a 256-entry LUT from a d3 interpolator.
 * Index i maps to the color at t = i/255.
 */
function buildLUT(fn: (t: number) => string): number[] {
  return Array.from({ length: 256 }, (_, i) => parseRgb(fn(i / 255)));
}

const LUTS: Record<ColormapName, number[]> = {
  turbo:     buildLUT(interpolateTurbo),
  viridis:   buildLUT(interpolateViridis),
  plasma:    buildLUT(interpolatePlasma),
  magma:     buildLUT(interpolateMagma),
  inferno:   buildLUT(interpolateInferno),
  rdbu:      buildLUT(interpolateRdBu),
  grayscale: buildLUT(interpolateGreys),
};

/**
 * Sample a colormap at t ∈ [0,1]. Returns 0xRRGGBB.
 * t is clamped — safe to call with any number.
 */
export function sample(name: ColormapName, t: number): number {
  // Math.floor(t * 256) gives uniform 1/256-width bins; clamped to [0,255].
  const idx = Math.min(255, Math.floor(Math.max(0, Math.min(1, t)) * 256));
  return (LUTS[name] ?? LUTS['turbo'])[idx]!;
}

export const COLORMAP_NAMES: ColormapName[] = [
  'turbo', 'viridis', 'plasma', 'magma', 'inferno', 'rdbu', 'grayscale',
];

export const COLORMAP_LABELS: Record<ColormapName, string> = {
  turbo:     'Turbo',
  viridis:   'Viridis',
  plasma:    'Plasma',
  magma:     'Magma',
  inferno:   'Inferno',
  rdbu:      'RdBu',
  grayscale: 'Grayscale',
};
