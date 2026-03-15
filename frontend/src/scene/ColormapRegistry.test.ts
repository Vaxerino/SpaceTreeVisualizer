import { describe, expect, it } from 'vitest';
import { interpolateTurbo } from 'd3-scale-chromatic';
import { COLORMAP_NAMES, sample } from './ColormapRegistry';

function parseRgb(rgb: string): number {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return 0x888888;
  return (parseInt(m[1]!, 10) << 16) | (parseInt(m[2]!, 10) << 8) | parseInt(m[3]!, 10);
}

describe('ColormapRegistry.sample', () => {
  it('keeps all sampled colors in 0x000000..0xFFFFFF LUT bounds', () => {
    for (const name of COLORMAP_NAMES) {
      const values = [sample(name, 0), sample(name, 0.5), sample(name, 1)];
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(0x000000);
        expect(value).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('clamps sample values outside [0, 1]', () => {
    expect(sample('turbo', -5)).toBe(sample('turbo', 0));
    expect(sample('turbo', 5)).toBe(sample('turbo', 1));
  });

  it('parses rgb(...) interpolator output into packed hex correctly', () => {
    const lutIndex = 128;
    const t = lutIndex / 255;
    const expected = parseRgb(interpolateTurbo(t));
    expect(sample('turbo', 0.5)).toBe(expected);
  });
});
