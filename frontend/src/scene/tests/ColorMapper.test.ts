import { describe, expect, it } from 'vitest';
import type { CellRecord } from '../../viewTypes';
import { ColorMapper } from '../ColorMapper';
import { sample } from '../ColormapRegistry';

function makeCell(overrides: Partial<CellRecord> = {}): CellRecord {
  return {
    cx: 0,
    cy: 0,
    cz: 0,
    hx: 0.5,
    hy: 0.5,
    hz: 0.5,
    level: 0,
    flags: 0,
    relPosX: 0,
    relPosY: 0,
    relPosZ: 0,
    rank: 0,
    treeId: 0,
    simData: [],
    ...overrides,
  };
}

describe('ColorMapper.forCell', () => {
  it('hashes treeId to hue deterministically and supports negative treeId', () => {
    const mapper = new ColorMapper();
    const cell = makeCell({ treeId: -2 });

    const color = mapper.forCell(cell, 'treeId', 'turbo', 0, 1, 0, 10);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);

    const expectedHue = (((cell.treeId * 137.508) % 360) + 360) % 360 / 360;
    expect(hsl.h).toBeCloseTo(expectedHue, 6);
    expect(hsl.s).toBeCloseTo(0.65, 6);
    expect(hsl.l).toBeCloseTo(0.55, 6);
  });

  it('uses t=0.5 fallback in sim mode when simMin equals simMax', () => {
    const mapper = new ColorMapper();
    const cell = makeCell({ simData: [42] });

    const color = mapper.forCell(cell, 'sim', 'viridis', 7, 7, 0, 10);
    expect(color.getHex()).toBe(sample('viridis', 0.5));
  });

  it('normalizes level mode by maxLevel and falls back to level 0 when maxLevel is 0', () => {
    const mapper = new ColorMapper();

    const levelCell = makeCell({ level: 3 });
    const levelColor = mapper.forCell(levelCell, 'level', 'plasma', 0, 1, 0, 6);
    expect(levelColor.getHex()).toBe(sample('plasma', 0.5));

    const zeroMaxCell = makeCell({ level: 9 });
    const zeroMaxColor = mapper.forCell(zeroMaxCell, 'level', 'plasma', 0, 1, 0, 0);
    expect(zeroMaxColor.getHex()).toBe(sample('plasma', 0));
  });
});
